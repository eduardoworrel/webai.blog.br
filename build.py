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
from dataclasses import dataclass, field
from datetime import date, datetime, timezone
from email.utils import format_datetime
from html.parser import HTMLParser
from pathlib import Path
from string import Template
from urllib.parse import unquote, urlsplit

from markdown_it import MarkdownIt

ROOT = Path(__file__).resolve().parent
POSTS = ROOT / "posts"
PAGES = ROOT / "pages"
THEME = ROOT / "theme"
OUT = ROOT / "public"

FILENAME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$")
REQUIRED = ("title", "date", "description")
OPTIONAL = ("lang", "cover")
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
                body_md=body)


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
    if errors:
        raise BuildError("\n".join(errors))
    posts.sort(key=lambda p: (p.date, p.slug), reverse=True)
    return posts


# ---------------------------------------------------------------- render

# CommonMark (o mesmo Markdown que o GitHub mostra no PR) + tabelas e tachado. HTML cru no texto não passa.
MD = MarkdownIt("commonmark", {"html": False}).enable(["table", "strikethrough"])


def md_to_html(text: str) -> str:
    return MD.render(text)


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

    post.body_html = IMG_RE.sub(fix, md_to_html(post.body_md))
    if post.cover:
        images.append(post.cover)
    post.images = images


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


def render_index(posts: list[Post]) -> str:
    if not posts:
        return '<p class="vazio">Nenhum post ainda.</p>'
    items = "\n".join(
        f'<li><time datetime="{p.date.isoformat()}">{data_br(p.date)}</time>'
        f'<a href="{p.href}">{html.escape(p.title)}</a></li>'
        for p in posts
    )
    return f'<ul class="posts">\n{items}\n</ul>'


def render_post(post: Post) -> str:
    return (
        f'<article>\n<header>\n<h1>{html.escape(post.title)}</h1>\n'
        f'<p class="meta"><time datetime="{post.date.isoformat()}">{data_br(post.date)}</time></p>\n'
        f'</header>\n{post.body_html}\n</article>\n'
        f'<p class="voltar"><a href="index.html">← Todos os posts</a></p>'
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
    if (THEME / "favicon.svg").exists():
        shutil.copy2(THEME / "favicon.svg", OUT / "favicon.svg")

    def write(name: str, text: str) -> None:
        (OUT / name).write_text(text, encoding="utf-8")

    write("index.html", theme.page(title=site["title"], description=site["description"],
                                   content=render_index(posts), path=""))
    for p in posts:
        write(p.href, theme.page(title=p.title, description=p.description, content=render_post(p),
                                 path=p.href, lang=p.lang, og_type="article",
                                 image=f"{p.slug}/{p.cover}" if p.cover else None))
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
