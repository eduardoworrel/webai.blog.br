#!/usr/bin/env python3
"""Gerador do webai.blog.br.

    python build.py          valida os posts e gera public/
    python build.py check    valida os posts, gera public/ e confere os links internos

Só usa a biblioteca padrão do Python e o pacote `markdown-it-py` (versão fixada em requirements.txt).
"""
from __future__ import annotations

import html
import posixpath
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
DEMOS = ROOT / "demos"
OUT = ROOT / "public"

FILENAME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})-([a-z0-9]+(?:-[a-z0-9]+)*)\.md$")
REQUIRED = ("title", "date", "description")
OPTIONAL = ("lang", "cover", "translation", "authors", "category")  # translation: slug(s) do mesmo post em outras línguas, separados por vírgula
I18N: dict[str, dict] = {}        # código -> dicionário de i18n/<código>.toml
LANGS: list[str] = []             # idiomas do site, na ordem do site.toml; o primeiro é o padrão
DEFAULT_LANG = ""
LANG_PREFIX: dict[str, str] = {}  # padrão na raiz (URLs antigas intactas); os outros em /<idioma>/, ex. en/, es/


def load_i18n() -> dict:
    """Lê site.toml e i18n/<idioma>.toml; devolve a configuração do site e preenche as tabelas de idiomas."""
    global DEFAULT_LANG
    site = tomllib.loads((ROOT / "site.toml").read_text(encoding="utf-8"))
    site["url"] = site["url"].rstrip("/")
    langs = site.get("languages") or ["pt-BR"]
    LANGS[:] = langs
    DEFAULT_LANG = langs[0]
    I18N.clear()
    LANG_PREFIX.clear()
    for code in langs:
        f = ROOT / "i18n" / f"{code}.toml"
        if not f.is_file():
            raise BuildError(f"site.toml: falta o dicionário i18n/{code}.toml")
        d = tomllib.loads(f.read_text(encoding="utf-8"))
        ref = I18N.get(langs[0]) or d
        for sec in ("ui", "labels"):
            miss = set(ref[sec]) - set(d.get(sec, {}))
            if miss:
                raise BuildError(f"i18n/{code}.toml: faltam em [{sec}]: {', '.join(sorted(miss))}")
        I18N[code] = d
        LANG_PREFIX[code] = "" if code == DEFAULT_LANG else code.split("-")[0].lower() + "/"
        if not (PAGES / f"{d['about_page']}.md").is_file():
            raise BuildError(f"i18n/{code}.toml: falta pages/{d['about_page']}.md")
    if len(set(LANG_PREFIX.values())) != len(langs):
        raise BuildError("site.toml: dois idiomas com o mesmo prefixo de URL")
    return site


def UI(lang: str) -> dict:
    return I18N[lang]["ui"]


def labels(lang: str) -> dict:
    return I18N[lang]["labels"]


IMAGE_EXT = {".png", ".jpg", ".jpeg", ".webp", ".gif"}
MAX_IMAGE_BYTES = 400 * 1024
MAX_POST_IMAGES_BYTES = 3 * 1024 * 1024
MAX_DESCRIPTION = 200


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
    translations: list[str] = field(default_factory=list)  # slugs das outras versões do mesmo post
    versions: dict = field(default_factory=dict)  # idioma -> Post, com todas as versões do post (inclusive esta)
    authors: str = ""
    category: str = ""
    toc: list = field(default_factory=list)
    minutes: int = 1
    body_html: str = ""
    images: list[str] = field(default_factory=list)

    @property
    def path(self) -> str:
        """Caminho do HTML a partir da raiz do site: PT em /slug.html, EN em /en/slug.html."""
        return f"{LANG_PREFIX[self.lang]}{self.slug}.html"

    @property
    def href(self) -> str:
        return self.path


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
    lang = meta.get("lang") or DEFAULT_LANG
    if lang not in LANGS:
        raise BuildError(f"{where}: lang precisa ser um de {', '.join(LANGS)}")

    # Um título "# ..." igual ao do front matter no começo do texto não é repetido na página.
    first, _, rest = body.partition("\n")
    if first.startswith("# ") and first[2:].strip() == meta["title"]:
        body = rest.lstrip("\n")

    return Post(source=path, slug=slug, title=meta["title"], date=post_date,
                description=meta["description"], lang=lang, cover=meta.get("cover") or None,
                body_md=body,
                translations=[t.strip() for t in meta.get("translation", "").split(",") if t.strip()],
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
        if p.lang not in LANGS:
            errors.append(f"{p.source.name}: lang '{p.lang}' não está em languages do site.toml ({', '.join(LANGS)})")
            continue
        group = {p.slug, *p.translations}
        members = [slugs.get(sl) for sl in sorted(group)]
        if None in members:
            missing = sorted(sl for sl in group if sl not in slugs)
            errors.append(f"{p.source.name}: translation aponta para slug que não existe: {', '.join(missing)}")
            continue
        if len({m.lang for m in members}) != len(members):
            errors.append(f"{p.source.name}: duas versões do post na mesma língua ({', '.join(m.slug for m in members)})")
            continue
        for m in members:
            if {m.slug, *m.translations} != group:
                errors.append(f"{p.source.name}: as traduções precisam ser recíprocas: {m.source.name} deve ter "
                              f"'translation: {', '.join(sorted(group - {m.slug}))}'")
        p.versions = {m.lang: m for m in members}
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


def data_post(post: Post) -> str:
    d, I = post.date, I18N[post.lang]
    return I["date"].format(day=d.day, month=I["months"][d.month - 1], year=d.year)


GH_ICON = ('<svg viewBox="0 0 16 16" width="18" height="18" aria-hidden="true" fill="currentColor"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>')


def file_of(path: str) -> str:
    """Caminho canônico ("", "en/", "x.html") -> arquivo gerado em public/."""
    return path + "index.html" if path == "" or path.endswith("/") else path


def hreflang_pairs(alts: dict[str, str]) -> list[tuple[str, str]]:
    """[(hreflang, caminho)] na ordem do site.toml, mais o x-default (versão no idioma padrão, ou a primeira que existir)."""
    pairs = [(hl, alts[hl]) for hl in LANGS if hl in alts]
    return pairs + [("x-default", alts.get(DEFAULT_LANG) or pairs[0][1])]


@dataclass
class Ctx:
    """Onde a página está: serve para escrever links relativos (o site abre direto do disco) ou absolutos (404)."""
    lang: str
    absolute: bool = False

    @property
    def dir(self) -> str:
        return LANG_PREFIX[self.lang].rstrip("/")

    @property
    def root(self) -> str:
        return "/" if self.absolute else ("../" if self.dir else "")

    def link(self, path: str) -> str:
        path = file_of(path)
        return "/" + path if self.absolute else posixpath.relpath(path, self.dir or ".")


class Theme:
    def __init__(self, site: dict):
        self.site = site
        self.base = Template((THEME / "base.html").read_text(encoding="utf-8"))

    def page(self, *, title: str, description: str, content: str, path: str, lang: str,
             og_type: str = "website", image: str | None = None, absolute: bool = False,
             alternates: dict[str, str] | None = None, switch: list[tuple[str, str]] | None = None) -> str:
        """path: caminho canônico (""; "en/"; "slug.html").
        alternates: {idioma: caminho} das versões existentes, incluindo a própria página (hreflang recíproco).
        switch: [(idioma, caminho)] do seletor de idioma: só idiomas com a página equivalente ou a home."""
        site, ui, ctx = self.site, UI(lang), Ctx(lang, absolute)
        full_title = site["title"] if title == site["title"] else f"{title} · {site['title']}"
        canonical = f"{site['url']}/{path}"
        og_image = f'\n<meta property="og:image" content="{html.escape(site["url"] + "/" + image)}">' if image else ""
        hreflang, og_alt = "", ""
        if alternates and len(alternates) > 1:
            hreflang = "\n" + "\n".join(
                f'<link rel="alternate" hreflang="{hl}" href="{html.escape(site["url"] + "/" + pth)}">'
                for hl, pth in hreflang_pairs(alternates))
            og_alt = "".join(f'\n<meta property="og:locale:alternate" content="{I18N[hl]["og_locale"]}">'
                             for hl in LANGS if hl in alternates and hl != lang)
        feed = ctx.link(f"{LANG_PREFIX[lang]}feed.xml")
        pick = "".join(f'<a class="idioma" href="{ctx.link(pth)}" hreflang="{hl}" lang="{hl}" '
                       f'aria-label="{html.escape(UI(hl)["switch_aria"])}">{html.escape(I18N[hl]["name"])}</a>'
                       for hl, pth in (switch or []))
        nav = (f'<a href="{ctx.link(LANG_PREFIX[lang])}">{ui["posts"]}</a>'
               f'<a href="https://webai.blog.br/state-of-the-art/">State of the Art</a>'
               f'<a href="https://webai.blog.br/observatorio/">Observatório</a>'
               f'<a href="{ctx.link(LANG_PREFIX[lang] + I18N[lang]["about_page"] + ".html")}">{ui["about"]}</a>'
               f'<a href="{feed}">RSS</a>{pick}'
               f'<a class="gh" href="https://github.com/eduardoworrel/state-of-the-art-webai" '
               f'aria-label="{ui["gh_aria"]}" title="{ui["gh_aria"]}">{GH_ICON}</a>')
        footer = (f'<a href="{feed}">RSS</a> · <a href="https://github.com/eduardoworrel/webai.blog.br/blob/main/CONTRIBUTING.md">'
                  f'{ui["write"]}</a> · <a href="https://github.com/eduardoworrel/state-of-the-art-webai">{ui["map"]}</a>')
        return self.base.substitute(
            lang=lang, title=html.escape(full_title), og_title=html.escape(title),
            description=html.escape(description), canonical=html.escape(canonical), og_type=og_type,
            og_locale=I18N[lang]["og_locale"], og_alt=og_alt, hreflang=hreflang, og_image=og_image,
            site_title=html.escape(site["title"]), home=ctx.link(LANG_PREFIX[lang]), nav=nav, footer=footer,
            feed=feed, root=ctx.root, content=content)


def render_index(posts: list[Post], lang: str, ctx: Ctx, site: dict, elsewhere: dict[str, int] | None = None) -> str:
    """elsewhere: {idioma: nº de posts que existem só naquele idioma e não neste}."""
    ui = UI(lang)
    L = labels(lang)
    note = ""
    n = sum((elsewhere or {}).values())
    if n:
        links = " · ".join(f'<a href="{ctx.link(LANG_PREFIX[o])}" hreflang="{o}" lang="{o}">{html.escape(I18N[o]["name"])}</a>'
                           for o in LANGS if (elsewhere or {}).get(o))
        note = f'<p class="nota-idioma">{ui["only_other"][n > 1].format(n=n)} {links}</p>\n'
    hero = f'<section class="capa"><h1>{html.escape(site["title"])}</h1><p>{ui["tagline"]}</p></section>\n'
    if not posts:
        return hero + note + f'<p class="vazio">{ui["empty"]}</p>'
    cards = []
    for p in posts:
        cat = f'<span class="tag">{html.escape(p.category)}</span>' if p.category else ""
        cover = (f'<img src="{ctx.link(LANG_PREFIX[p.lang] + p.slug + "/" + p.cover)}" alt="" loading="lazy">' if p.cover else "")
        outras = [I18N[o]["name"] for o in LANGS if o in p.versions and o != lang]
        also = f'<span class="tambem">{html.escape(ui["also"].format(langs=", ".join(outras)))}</span>' if outras else ""
        cards.append(
            f'<a class="cartao" href="{ctx.link(p.path)}">{cover}<div class="corpo">{cat}'
            f'<h2>{html.escape(p.title)}</h2><p>{html.escape(p.description)}</p>'
            f'<p class="meta">{data_post(p)} · {p.minutes} {L["read"]}{also}</p></div></a>')
    return hero + note + '<div class="cartoes">\n' + "\n".join(cards) + "\n</div>"


def share_links(post: Post, site: dict) -> str:
    L = labels(post.lang)
    url = quote(f"{site['url']}/{post.path}", safe="")
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


def render_post(post: Post, site: dict | None = None, posts: list[Post] | None = None, ctx: Ctx | None = None) -> str:
    ctx = ctx or Ctx(post.lang)
    L = labels(post.lang)
    trad = " ".join(f'<a href="{ctx.link(o.path)}" hreflang="{o.lang}" lang="{o.lang}">{UI(o.lang)["translation_link"]}</a>'
                    for lang_, o in sorted(post.versions.items(), key=lambda kv: LANGS.index(kv[0])) if o is not post)
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
        outros = [p for p in posts if p.slug != post.slug and p.lang == post.lang]
        if outros:
            li = "".join(f'<li><a href="{ctx.link(p.path)}"><span class="tag">{html.escape(p.category)}</span>'
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


def rss(site: dict, posts: list[Post], lang: str) -> str:
    def cdata(s: str) -> str:
        return "<![CDATA[" + s.replace("]]>", "]]]]><![CDATA[>") + "]]>"

    items = []
    for p in posts:
        link = f"{site['url']}/{p.path}"
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
    desc = I18N[lang].get("description") or site["description"]
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n<channel>\n'
        f"  <title>{html.escape(site['title'])}</title>\n"
        f"  <link>{html.escape(site['url'])}/{LANG_PREFIX[lang]}</link>\n"
        f"  <description>{html.escape(desc)}</description>\n"
        f"  <language>{lang.lower()}</language>\n"
        f'  <atom:link href="{html.escape(site["url"])}/{LANG_PREFIX[lang]}feed.xml" rel="self" type="application/rss+xml"/>\n'
        + (f"  <lastBuildDate>{last}</lastBuildDate>\n" if last else "")
        + "\n".join(items)
        + ("\n" if items else "")
        + "</channel>\n</rss>\n"
    )


def sitemap(site: dict, entries: list[tuple[str, date | None, dict[str, str]]]) -> str:
    """entries: (caminho canônico, lastmod, {idioma: caminho}); com traduções, cada <url> lista todas as versões, inclusive a própria."""
    urls = []
    for path, lastmod, alts in entries:
        mod = f"<lastmod>{lastmod.isoformat()}</lastmod>" if lastmod else ""
        links = ""
        if len(alts) > 1:
            links = "".join(f'<xhtml:link rel="alternate" hreflang="{hl}" href="{html.escape(site["url"] + "/" + pth)}"/>'
                            for hl, pth in hreflang_pairs(alts))
        urls.append(f"  <url><loc>{html.escape(site['url'] + '/' + path)}</loc>{mod}{links}</url>")
    return (
        '<?xml version="1.0" encoding="utf-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9" xmlns:xhtml="http://www.w3.org/1999/xhtml">\n'
        + "\n".join(urls)
        + "\n</urlset>\n"
    )


def load_page(name: str) -> tuple[dict[str, str], str]:
    path = PAGES / f"{name}.md"
    return split_front_matter(path.read_text(encoding="utf-8"), str(path.relative_to(ROOT)))


def build() -> list[Post]:
    site = load_i18n()
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
    for lang in LANGS:
        (OUT / LANG_PREFIX[lang]).mkdir(exist_ok=True)
    shutil.copy2(THEME / "style.css", OUT / "style.css")
    if (THEME / "fonts").is_dir():
        shutil.copytree(THEME / "fonts", OUT / "fonts")
    for name in ("favicon.svg", "logo.svg"):
        if (THEME / name).exists():
            shutil.copy2(THEME / name, OUT / name)

    def write(name: str, text: str) -> None:
        (OUT / name).write_text(text, encoding="utf-8")

    sm: list[tuple[str, date | None, dict[str, str]]] = []
    homes = {lang: LANG_PREFIX[lang] for lang in LANGS}
    abouts = {lang: f"{LANG_PREFIX[lang]}{I18N[lang]['about_page']}.html" for lang in LANGS}
    with_posts = {lang for lang in LANGS if any(p.lang == lang for p in posts)}

    def switch_for(lang: str, equivalent: dict[str, str], fallback: dict[str, str]) -> list[tuple[str, str]]:
        """Seletor: cada outro idioma com a página equivalente; sem ela, a home do idioma se ele tiver posts."""
        out = []
        for o in LANGS:
            if o == lang:
                continue
            if o in equivalent:
                out.append((o, equivalent[o]))
            elif o in with_posts:
                out.append((o, fallback[o]))
        return out

    for lang in LANGS:
        ctx = Ctx(lang)
        mine = [p for p in posts if p.lang == lang]
        elsewhere = {o: sum(1 for p in posts if p.lang == o and lang not in p.versions) for o in LANGS if o != lang}
        desc = I18N[lang].get("description") or site["description"]
        write(file_of(homes[lang]), theme.page(title=site["title"], description=desc, lang=lang, path=homes[lang],
                                               content=render_index(mine, lang, ctx, site, elsewhere), alternates=homes,
                                               switch=switch_for(lang, homes, homes)))
        sm.append((homes[lang], mine[0].date if mine else None, homes))
        write(f"{LANG_PREFIX[lang]}feed.xml", rss(site, mine, lang))

        for p in mine:
            alts = {l: v.path for l, v in p.versions.items()}
            write(p.path, theme.page(title=p.title, description=p.description, lang=lang, path=p.path,
                                     content=render_post(p, site, posts, ctx), og_type="article",
                                     image=f"{LANG_PREFIX[lang]}{p.slug}/{p.cover}" if p.cover else None,
                                     alternates=alts, switch=switch_for(lang, alts, homes)))
            write(f"{LANG_PREFIX[lang]}{p.slug}.md", p.source.read_text(encoding="utf-8"))
            folder = POSTS / p.slug
            if folder.is_dir():
                shutil.copytree(folder, OUT / LANG_PREFIX[lang] / p.slug, ignore=shutil.ignore_patterns(".DS_Store"))
            sm.append((p.path, p.date, alts))

        ui = UI(lang)
        meta, body = load_page(I18N[lang]["about_page"])
        title = meta.get("title", ui["about"])
        write(abouts[lang], theme.page(title=title, description=meta.get("description", ""), lang=lang, path=abouts[lang],
                                       alternates=abouts, switch=switch_for(lang, abouts, abouts),
                                       content=f"<article>\n<h1>{html.escape(title)}</h1>\n{md_to_html(body)}\n</article>"))
        sm.append((abouts[lang], None, abouts))
        write(f"{LANG_PREFIX[lang]}404.html", theme.page(
            title=ui["nf_title"], description=ui["nf_title"], lang=lang, path=f"{LANG_PREFIX[lang]}404.html", absolute=True,
            switch=switch_for(lang, homes, homes),
            content=f'<article>\n<h1>{ui["nf_title"]}</h1>\n<p>{ui["nf_text"]} '
                    f'<a href="{"/" + LANG_PREFIX[lang]}">{ui["nf_back"]}</a>.</p>\n</article>'))
    # Demos: pastas estáticas de demos/<slug>/ vão, sem mudança, para public/demos/<slug>/. Cada pasta com index.html
    # (a própria ou uma subpasta, como demos/s1s2/<nome>/) é uma página e entra no sitemap.
    for demo in sorted(p for p in DEMOS.iterdir() if p.is_dir()) if DEMOS.is_dir() else []:
        pages = sorted(i.parent.relative_to(DEMOS) for i in demo.rglob("index.html"))
        if not pages:
            raise BuildError(f"demos/{demo.name}: falta index.html")
        shutil.copytree(demo, OUT / "demos" / demo.name, ignore=shutil.ignore_patterns(".DS_Store"))
        for idx in sorted(demo.rglob("index.html")):   # inclui subpastas (demos/s1s2/<nome>/); redirecionamentos noindex ficam fora
            if '<meta name="robots" content="noindex">' in idx.read_text(encoding="utf-8"):
                continue
            rel = idx.parent.relative_to(DEMOS).as_posix()
            sm.append((f"demos/{rel}/", None, {}))
    write("sitemap.xml", sitemap(site, sm))
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
