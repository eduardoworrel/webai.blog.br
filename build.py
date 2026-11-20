#!/usr/bin/env python3
"""Gerador do webai.blog.br.

    python build.py          valida os posts e gera public/
    python build.py check    valida os posts, gera public/ e confere os links internos

Só usa a biblioteca padrão do Python e o pacote `markdown-it-py` (versão fixada em requirements.txt).
"""
from __future__ import annotations

import html
import re
import shutil
import sys
import tomllib
import unicodedata
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from email.utils import format_datetime
from html.parser import HTMLParser
from pathlib import Path
from string import Template
from urllib.parse import quote, unquote, urlsplit

from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parent
POSTS = ROOT / "posts"
PAGES = ROOT / "pages"
THEME = ROOT / "theme"
OUT = ROOT / "public"

FILENAME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$")
REQUIRED = ("title", "date", "description")
OPTIONAL = ("lang", "cover", "translation", "authors", "category")  # translation: slug do mesmo post em outra língua
LANGS = ("pt-BR", "en", "es")
IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
MAX_IMAGE_BYTES = 400 * 1024
MAX_POST_IMAGES_BYTES = 3 * 1024 * 1024
MAX_DESCRIPTION = 200
MESES = ("janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho",
         "agosto", "setembro", "outubro", "novembro", "dezembro")


class BuildError(Exception):
    pass


@dataclass
class Post:
    source: Path
    slug: str
    title: str
    date: date
    description: str
    lang: str
    cover: str | None
    body_md: str
    translation: str | None = None
    authors: str = ""
    category: str = ""
    toc: list = field(default_factory=list)
    minutes: int = 1
    body_html: str = ""
    images: list[str] = field(default_factory=list)

    @property
    def href(self) -> str:
        return f"{self.slug}.html"


# ---------------------------------------------------------------- front matter

def split_front_matter(text: str, where: str) -> tuple[dict[str, str], str]:
    """Front matter mínimo: linhas `chave: valor` entre duas linhas `---`."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        raise BuildError(f"{where}: o arquivo precisa começar com uma linha '---'")
    try:
        end = next(i for i in range(1, len(lines)) if lines[i].strip() == "---")
    except StopIteration:
        raise BuildError(f"{where}: falta a linha '---' que fecha o front matter") from None
    meta: dict[str, str] = {}
    for n, line in enumerate(lines[1:end], start=2):
        if not line.strip() or line.lstrip().startswith("#"):
            continue
        key, sep, value = line.partition(":")
        key, value = key.strip(), value.strip()
        if not sep or not key:
            raise BuildError(f"{where}:{n}: use o formato 'chave: valor'")
        if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
            value = value[1:-1]
        if key in meta:
            raise BuildError(f"{where}:{n}: chave repetida '{key}'")
        meta[key] = value
    return meta, "\n".join(lines[end + 1:]).lstrip("\n")


def load_post(path: Path) -> Post:
    where = str(path.relative_to(ROOT))
    m = FILENAME_RE.match(path.name)
    if not m:
        raise BuildError(f"{where}: o nome precisa ser AAAA-MM-DD-slug.md (slug só com a-z, 0-9 e hífen)")
    file_date, slug = m.groups()
    meta, body = split_front_matter(path.read_text(encoding="utf-8"), where)

    unknown = set(meta) - set(REQUIRED) - set(OPTIONAL)
    if unknown:
        raise BuildError(f"{where}: chaves desconhecidas no front matter: {', '.join(sorted(unknown))}")
    missing = [k for k in REQUIRED if not meta.get(k)]
    if missing:
        raise BuildError(f"{where}: faltam no front matter: {', '.join(missing)}")
    try:
        post_date = date.fromisoformat(meta["date"])
    except ValueError:
        raise BuildError(f"{where}: date precisa ser AAAA-MM-DD") from None
    if meta["date"] != file_date:
        raise BuildError(f"{where}: date ({meta['date']}) difere da data no nome do arquivo ({file_date})")
    if len(meta["description"]) > MAX_DESCRIPTION:
        raise BuildError(f"{where}: description passa de {MAX_DESCRIPTION} caracteres")
    lang = meta.get("lang") or "pt-BR"
    if lang not in LANGS:
        raise BuildError(f"{where}: lang precisa ser um de {', '.join(LANGS)}")

    # Um título "# ..." igual ao do front matter no começo do texto não é repetido na página.
    first, _, rest = body.partition("\n")
    if first.startswith("# ") and first[2:].strip() == meta["title"]:
        body = rest.lstrip("\n")

    return Post(source=path, slug=slug, title=meta["title"], date=post_date,
                description=meta["description"], lang=lang, cover=meta.get("cover") or None,
                body_md=body, translation=meta.get("translation") or None,
                authors=meta.get("authors", ""), category=meta.get("category", ""))


def load_posts() -> list[Post]:
    errors: list[str] = []
    posts: list[Post] = []
    for path in sorted(POSTS.glob("*.md")):
        try:
            posts.append(load_post(path))
        except BuildError as e:
            errors.append(str(e))
    slugs: dict[str, Post] = {}
    for p in posts:
        if p.slug in slugs:
            errors.append(f"slug repetido '{p.slug}': {slugs[p.slug].source.name} e {p.source.name}")
        slugs[p.slug] = p
    for p in posts:
        if p.translation and p.translation not in slugs:
            errors.append(f"{p.source.name}: translation aponta para um slug que não existe: '{p.translation}'")
    if errors:
        raise BuildError("\n".join(errors))
    posts.sort(key=lambda p: (p.date, p.slug), reverse=True)
    return posts


# ---------------------------------------------------------------- render

# CommonMark (o mesmo Markdown que o GitHub mostra no PR) + tabelas e tachado. HTML cru no texto não passa.
MD = MarkdownIt("commonmark", {"html": False}).enable(["table", "strikethrough"])


# Bloco de nota: citação que começa com "[!NOTA]" vira <blockquote class="nota"> (fundo azul claro no tema).
NOTA_RE = re.compile(r"<blockquote>\n<p>\[!NOTA\]\s*")


def md_to_html(text: str) -> str:
    return NOTA_RE.sub('<blockquote class="nota">\n<p>', MD.render(text))


def is_relative(url: str) -> bool:
    parts = urlsplit(url)
    return not (parts.scheme or parts.netloc or url.startswith(("/", "#")))


IMG_RE = re.compile(r'<img\s+src="([^"]+)"([^>]*?)\s*/?>')


def render_post_body(post: Post) -> None:
    """Converte o Markdown e aponta imagens relativas para a pasta posts/<slug>/ publicada em <slug>/."""
    images: list[str] = []

    def fix(m: re.Match) -> str:
        src, after = m.groups()
        if is_relative(src):
            name = unquote(src)
            if name.startswith(post.slug + "/"):
                name = name[len(post.slug) + 1:]
            images.append(name)
            src = f"{post.slug}/{name}"
        return f'<img src="{src}"{after} loading="lazy">'

    body = IMG_RE.sub(fix, md_to_html(post.body_md))
    body, post.toc = add_heading_ids(body)
    body = figures(body, post)
    post.body_html = body
    words = len(re.findall(r"\w+", re.sub(r"<[^>]+>", " ", body)))
    post.minutes = max(1, round(words / 200))
    if post.cover:
        images.append(post.cover)
    post.images = images


HEAD_RE = re.compile(r"<h([23])>(.*?)</h\1>", re.S)


def slugify(text: str) -> str:
    t = unicodedata.normalize("NFKD", re.sub(r"<[^>]+>", "", html.unescape(text)))
    t = "".join(c for c in t if not unicodedata.combining(c)).lower()
    return re.sub(r"[^a-z0-9]+", "-", t).strip("-") or "secao"


def add_heading_ids(body: str) -> tuple[str, list[tuple[int, str, str]]]:
    toc, used = [], set()

    def sub(m: re.Match) -> str:
        level, inner = int(m.group(1)), m.group(2)
        base = slugify(inner)
        sid, n = base, 2
        while sid in used:
            sid, n = f"{base}-{n}", n + 1
        used.add(sid)
        toc.append((level, sid, re.sub(r"<[^>]+>", "", inner)))
        return f'<h{level} id="{sid}"><a class="ancora" href="#{sid}">{inner}</a></h{level}>'

    return HEAD_RE.sub(sub, body), toc


FIG_RE = re.compile(r'<p>(<img src="[^"]+" alt="([^"]*)"[^>]*>)</p>')


def figures(body: str, post: Post) -> str:
    """Toda imagem sozinha num parágrafo vira <figure> com legenda "FIG A · texto alternativo"; a primeira vira a capa."""
    n = 0

    def sub(m: re.Match) -> str:
        nonlocal n
        img, alt = m.group(1), m.group(2)
        letra = chr(ord("A") + n)
        n += 1
        return (f'<figure id="fig-{letra.lower()}">{img}<figcaption><b>FIG {letra}</b>'
                f'<span>{alt}</span></figcaption></figure>')

    return FIG_RE.sub(sub, body)


def check_post_assets(post: Post) -> list[str]:
    errors = []
    where = str(post.source.relative_to(ROOT))
    folder = POSTS / post.slug
    for name in post.images:
        f = folder / name
        if not f.is_file():
            errors.append(f"{where}: imagem não encontrada: posts/{post.slug}/{name}")
    if folder.is_dir():
        total = 0
        for f in sorted(folder.rglob("*")):
            if not f.is_file() or f.name == ".DS_Store":
                continue
            rel = f.relative_to(ROOT)
            if f.suffix.lower() not in IMAGE_EXT:
                errors.append(f"{rel}: tipo não aceito (use {', '.join(sorted(IMAGE_EXT))})")
            size = f.stat().st_size
            total += size
            if size > MAX_IMAGE_BYTES:
                errors.append(f"{rel}: {size // 1024} KB, limite de {MAX_IMAGE_BYTES // 1024} KB por imagem")
        if total > MAX_POST_IMAGES_BYTES:
            errors.append(f"posts/{post.slug}/: {total // 1024} KB no total, limite de {MAX_POST_IMAGES_BYTES // 1024} KB por post")
    return errors


def data_br(d: date) -> str:
    return f"{d.day} de {MESES[d.month - 1]} de {d.year}"


MONTHS_EN = ("January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
             "November", "December")
LINK_TRADUCAO = {"pt-BR": "Leia em português", "en": "Read in English", "es": "Leer en español"}


def data_post(post: Post) -> str:
    if post.lang == "en":
        return f"{MONTHS_EN[post.date.month - 1]} {post.date.day}, {post.date.year}"
    return data_br(post.date)


class Theme:
    def __init__(self, site: dict):
        self.site = site
        self.base = Template((THEME / "base.html").read_text(encoding="utf-8"))

    def page(self, *, title: str, description: str, content: str, path: str,
             lang: str | None = None, og_type: str = "website", image: str | None = None,
             root: str = "") -> str:
        site = self.site
        full_title = site["title"] if title == site["title"] else f"{title} · {site['title']}"
        canonical = f"{site['url']}/{path}" if path else f"{site['url']}/"
        og_image = f'\n<meta property="og:image" content="{html.escape(site["url"] + "/" + image)}">' if image else ""
        return self.base.substitute(
            lang=lang or site["lang"],
            title=html.escape(full_title),
            og_title=html.escape(title),
            description=html.escape(description),
            canonical=html.escape(canonical),
            og_type=og_type,
            og_image=og_image,
            site_title=html.escape(site["title"]),
            content=content,
            root=root,
        )


LABELS = {
    "pt-BR": dict(read="min de leitura", by="Por", share="Compartilhar", toc="Neste artigo", related="Continue lendo",
                  all="Todos os posts", md="Markdown", mail="E-mail", recent="Posts", copy="Copiar link", copied="Link copiado"),
    "en": dict(read="min read", by="By", share="Share", toc="In this article", related="Keep reading",
               all="All posts", md="Markdown", mail="Email", recent="Posts", copy="Copy link", copied="Link copied"),
}


def labels(lang: str) -> dict:
    return LABELS["en"] if lang == "en" else LABELS["pt-BR"]


def render_index(posts: list[Post]) -> str:
    if not posts:
        return '<p class="vazio">Nenhum post ainda.</p>'
    cards = []
    for p in posts:
        L = labels(p.lang)
        cat = f'<span class="tag">{html.escape(p.category)}</span>' if p.category else ""
        cover = (f'<img src="{p.slug}/{p.cover}" alt="" loading="lazy">' if p.cover else "")
        cards.append(
            f'<a class="cartao" href="{p.href}" lang="{p.lang}">{cover}<div class="corpo">{cat}'
            f'<h2>{html.escape(p.title)}</h2><p>{html.escape(p.description)}</p>'
            f'<p class="meta">{data_post(p)} · {p.minutes} {L["read"]}</p></div></a>')
    return ('<section class="capa"><h1>webai.blog.br</h1><p>Modelos que rodam no navegador: o que foi testado, '
            'como foi medido e o que deu certo ou não.</p></section>\n<div class="cartoes">\n' + "\n".join(cards) + "\n</div>")


def share_links(post: Post, site: dict) -> str:
    L = labels(post.lang)
    url = quote(f"{site['url']}/{post.href}", safe="")
    title = quote(post.title, safe="")
    return (f'<nav class="compartilhar" aria-label="{L["share"]}"><span>{L["share"]}</span>'
            f'<a href="https://www.linkedin.com/sharing/share-offsite/?url={url}" rel="noopener">LinkedIn</a>'
            f'<a href="https://twitter.com/intent/tweet?url={url}&amp;text={title}" rel="noopener">X</a>'
            f'<a href="mailto:?subject={title}&amp;body={url}">{L["mail"]}</a>'
            f'<a href="{post.slug}.md">{L["md"]}</a>'
            f'<button type="button" class="copiar" data-ok="{L["copied"]}">{L["copy"]}</button></nav>')


def render_toc(post: Post) -> str:
    if not post.toc:
        return ""
    L = labels(post.lang)
    items = "".join(f'<li class="n{lvl}"><a href="#{sid}">{html.escape(text)}</a></li>' for lvl, sid, text in post.toc)
    return f'<nav class="toc" aria-label="{L["toc"]}"><p>{L["toc"]}</p><ol>{items}</ol></nav>'


def render_post(post: Post, other: Post | None = None, site: dict | None = None, posts: list[Post] | None = None) -> str:
    L = labels(post.lang)
    trad = (f'<a href="{other.href}" hreflang="{other.lang}" lang="{other.lang}">{LINK_TRADUCAO[other.lang]}</a>'
            if other else "")
    cat = f'<span class="tag">{html.escape(post.category)}</span>' if post.category else ""
    autores = f'<span>{L["by"]} <b>{html.escape(post.authors)}</b></span>' if post.authors else ""
    meta = " ".join(x for x in (autores, f'<time datetime="{post.date.isoformat()}">{data_post(post)}</time>',
                                f'<span>{post.minutes} {L["read"]}</span>', trad) if x)
    cover = ""
    body = post.body_html
    m = re.match(r'\s*<figure id="fig-a">(<img [^>]+>)', body)
    if m and post.cover and post.cover in m.group(1):
        cover = f'<div class="capa-img">{m.group(1)}</div>'
        body = re.sub(r'^\s*<figure id="fig-a">.*?</figure>\s*', "", body, count=1, flags=re.S)
        body = re.sub(r'<b>FIG ([B-Z])</b>', lambda mm: f'<b>FIG {chr(ord(mm.group(1)) - 1)}</b>', body)
        body = re.sub(r'id="fig-([b-z])"', lambda mm: f'id="fig-{chr(ord(mm.group(1)) - 1)}"', body)
    related = ""
    if posts:
        outros = [p for p in posts if p.slug != post.slug and p.lang == post.lang and p.slug != post.translation]
        if outros:
            li = "".join(f'<li><a href="{p.href}"><span class="tag">{html.escape(p.category)}</span>'
                         f'<strong>{html.escape(p.title)}</strong><span class="meta">{data_post(p)} · {p.minutes} {L["read"]}</span></a></li>'
                         for p in outros[:3])
            related = f'<aside class="relacionados"><h2>{L["related"]}</h2><ul>{li}</ul></aside>'
    return (
        f'<div class="progresso" aria-hidden="true"></div>\n<div class="lido" aria-hidden="true"><span class="barra"><i></i></span><b>0%</b></div>\n'
        f'<article class="post">\n<header class="cabeca">\n{cat}'
        f'<h1>{html.escape(post.title)}</h1>\n<p class="lede">{html.escape(post.description)}</p>\n'
        f'<p class="meta">{meta}</p>\n{share_links(post, site) if site else ""}\n</header>\n{cover}\n'
        f'<div class="miolo">{render_toc(post)}<div class="texto">{body}{share_links(post, site) if site else ""}</div></div>\n</article>\n{related}'
    )


def rss(site: dict, posts: list[Post]) -> str:
    def cdata(s: str) -> str:
        return "<![CDATA[" + s.replace("]]>", "]]]]><![CDATA[>") + "]]>"

    items = []
    for p in posts:
        link = f"{site['url']}/{p.href}"
        pub = format_datetime(datetime(p.date.year, p.date.month, p.date.day, 12, tzinfo=timezone.utc))
        items.append(
            "  <item>\n"
            f"    <title>{html.escape(p.title)}</title>\n"
            f"    <link>{html.escape(link)}</link>\n"
            f'    <guid isPermaLink="true">{html.escape(link)}</guid>\n'
            f"    <pubDate>{pub}</pubDate>\n"
            f"    <description>{cdata(p.description)}</description>\n"
            "  </item>"
        )
    last = format_datetime(datetime(posts[0].date.year, posts[0].date.month, posts[0].date.day, 12,
                                    tzinfo=timezone.utc)) if posts else None
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n'
        f"  <title>{html.escape(site['title'])}</title>\n"
        f"  <link>{html.escape(site['url'])}/</link>\n"
        f"  <description>{html.escape(site['description'])}</description>\n"
        f"  <language>{site['lang'].lower()}</language>\n"
        f'  <atom:link href="{html.escape(site["url"])}/feed.xml" rel="self" type="application/rss+xml"/>\n'
        + (f"  <lastBuildDate>{last}</lastBuildDate>\n" if last else "")
        + "\n".join(items)
        + ("\n" if items else "")
        + "</channel>\n</rss>\n"
    )


def sitemap(site: dict, entries: list[tuple[str, date | None]]) -> str:
    urls = []
    for path, lastmod in entries:
        loc = f"{site['url']}/{path}" if path else f"{site['url']}/"
        mod = f"<lastmod>{lastmod.isoformat()}</lastmod>" if lastmod else ""
        urls.append(f"  <url><loc>{html.escape(loc)}</loc>{mod}</url>")
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(urls)
        + "\n</urlset>\n"
    )


def load_page(name: str) -> tuple[dict[str, str], str]:
    path = PAGES / f"{name}.md"
    return split_front_matter(path.read_text(encoding="utf-8"), str(path.relative_to(ROOT)))


def build() -> list[Post]:
    site = tomllib.loads((ROOT / "site.toml").read_text(encoding="utf-8"))
    site["url"] = site["url"].rstrip("/")
    posts = load_posts()
    errors: list[str] = []
    for p in posts:
        render_post_body(p)
        errors += check_post_assets(p)
    if errors:
        raise BuildError("\n".join(errors))

    theme = Theme(site)
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    shutil.copy2(THEME / "style.css", OUT / "style.css")
    if (THEME / "fonts").is_dir():
        shutil.copytree(THEME / "fonts", OUT / "fonts")
    if (THEME / "favicon.svg").exists():
        shutil.copy2(THEME / "favicon.svg", OUT / "favicon.svg")
    if (THEME / "logo.svg").exists():
        shutil.copy2(THEME / "logo.svg", OUT / "logo.svg")

    def write(name: str, text: str) -> None:
        (OUT / name).write_text(text, encoding="utf-8")

    write("index.html", theme.page(title=site["title"], description=site["description"],
                                   content=render_index(posts), path=""))
    by_slug = {p.slug: p for p in posts}
    for p in posts:
        other = by_slug.get(p.translation) if p.translation else None
        write(p.href, theme.page(title=p.title, description=p.description, content=render_post(p, other, site, posts),
                                 path=p.href, lang=p.lang, og_type="article",
                                 image=f"{p.slug}/{p.cover}" if p.cover else None))
        write(f"{p.slug}.md", p.source.read_text(encoding="utf-8"))
        folder = POSTS / p.slug
        if folder.is_dir():
            shutil.copytree(folder, OUT / p.slug, ignore=shutil.ignore_patterns(".DS_Store"))

    meta, body = load_page("sobre")
    write("sobre.html", theme.page(title=meta.get("title", "Sobre"), description=meta.get("description", ""),
                                   content=f"<article>\n<h1>{html.escape(meta.get('title', 'Sobre'))}</h1>\n"
                                           f"{md_to_html(body)}\n</article>", path="sobre.html"))
    write("404.html", theme.page(title="Página não encontrada", description="Página não encontrada.",
                                 content='<article>\n<h1>Página não encontrada</h1>\n'
                                         '<p>O endereço não existe ou mudou. '
                                         '<a href="/">Voltar para o início</a>.</p>\n</article>',
                                 path="404.html", root="/"))
    write("feed.xml", rss(site, posts))
    write("sitemap.xml", sitemap(site, [("", posts[0].date if posts else None)]
                                 + [(p.href, p.date) for p in posts] + [("sobre.html", None)]))
    write("robots.txt", f"User-agent: *\nAllow: /\nSitemap: {site['url']}/sitemap.xml\n")
    return posts


# ---------------------------------------------------------------- link check

class LinkCollector(HTMLParser):
    def __init__(self):
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag, attrs):
        for k, v in attrs:
            if k in ("href", "src") and v:
                self.links.append(v)


def check_links() -> list[str]:
    errors = []
    for page in sorted(OUT.rglob("*.html")):
        parser = LinkCollector()
        parser.feed(page.read_text(encoding="utf-8"))
        for link in parser.links:
            parts = urlsplit(link)
            if parts.scheme or parts.netloc or link.startswith(("#", "mailto:")):
                continue
            path = unquote(parts.path)
            if not path:
                continue
            target = OUT / path.lstrip("/") if path.startswith("/") else page.parent / path
            if target.is_dir():
                target = target / "index.html"
            if not target.is_file():
                errors.append(f"{page.relative_to(OUT)}: link quebrado '{link}'")
    return errors


def main(argv: list[str]) -> int:
    mode = argv[1] if len(argv) > 1 else "build"
    if mode not in ("build", "check"):
        print(__doc__)
        return 2
    try:
        posts = build()
    except BuildError as e:
        print(f"ERRO\n{e}", file=sys.stderr)
        return 1
    print(f"public/ gerado: {len(posts)} post(s)")
    if mode == "check":
        errors = check_links()
        if errors:
            print("ERRO\n" + "\n".join(errors), file=sys.stderr)
            return 1
        print("links internos ok")
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
