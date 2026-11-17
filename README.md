# webai.blog.br

Blog simples e estático. Cada post é um arquivo Markdown em `posts/`, proposto por pull request.
Sem JavaScript, um único CSS de ~3 KB, tema claro e escuro automático.

## Estrutura

```
posts/AAAA-MM-DD-slug.md   um post (front matter + Markdown)
posts/slug/                imagens do post
pages/sobre.md             página "Sobre"
theme/base.html            molde HTML de todas as páginas
theme/style.css            o único CSS
site.toml                  título, URL e descrição do site
build.py                   gerador (valida, gera public/ e confere links)
CONTRIBUTING.md            como propor um post
```

## Gerar localmente

```sh
python3 -m venv .venv
.venv/bin/pip install -r requirements.txt
.venv/bin/python build.py check     # valida, gera public/ e confere os links internos
python3 -m http.server -d public 8000
```

O site também abre direto do disco (`public/index.html`): todos os links são relativos (exceto em `404.html`, que usa caminhos absolutos para funcionar em qualquer URL).

Saída em `public/`: `index.html` (posts do mais novo ao mais antigo), `<slug>.html` para cada post
(as imagens vão para `<slug>/`), `sobre.html`, `404.html`, `feed.xml` (RSS 2.0), `sitemap.xml`, `robots.txt`,
`style.css` e `favicon.svg`.

## Por que Python + markdown-it-py

- O Python já vem no runner do GitHub Actions e em qualquer Mac ou Linux; o gerador inteiro é um arquivo
  (`build.py`) que só usa a biblioteca padrão mais um pacote.
- `markdown-it-py` segue o CommonMark, a mesma base do Markdown que o GitHub mostra na aba "Files changed"
  do PR. O que o autor vê no PR é o que vai para o site. Ele é puro Python, sem extensões em C, e tem uma
  única dependência (`mdurl`). As duas versões estão fixadas em `requirements.txt`.
- HTML cru dentro do Markdown é desligado: um post não consegue injetar `<script>`.
- O front matter é lido à mão (linhas `chave: valor`), sem precisar de um pacote YAML.

## Do PR ao site

1. Alguém abre um PR com `posts/AAAA-MM-DD-slug.md` e `posts/slug/`.
2. O workflow `.github/workflows/site.yml` roda `python build.py check`: front matter, imagens (tipo e
   tamanho) e links internos. Se falhar, o PR mostra o erro.
3. Depois do merge na `main`, o site é gerado de novo e publicado.
