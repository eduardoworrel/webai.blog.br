# Como propor um post

Os posts entram por pull request. Não precisa instalar nada: dá para fazer tudo pelo site do GitHub.

## 1. Crie o arquivo do post

Nome: `posts/AAAA-MM-DD-slug.md`

- `AAAA-MM-DD` é a data de publicação.
- `slug` vira o endereço do post (`webai.blog.br/slug.html`; em inglês, `webai.blog.br/en/slug.html`; em espanhol, `webai.blog.br/es/slug.html`): só letras minúsculas sem acento, números e
  hífen. Exemplo: `posts/2026-12-01-whisper-no-navegador.md`.

Modelo:

```markdown
---
title: Whisper rodando no navegador
date: 2026-12-01
description: Uma frase que resume o post (até 200 caracteres). Aparece no RSS e nos buscadores.
---
Primeiro parágrafo do texto.

![O que a imagem mostra, para quem não consegue vê-la](grafico.png)

## Uma seção

Mais texto, [links](https://exemplo.com), listas, tabelas e blocos de código.
```

Campos do front matter:

| Campo         | Obrigatório | Formato                                              |
|---------------|-------------|------------------------------------------------------|
| `title`       | sim         | texto                                                |
| `date`        | sim         | `AAAA-MM-DD`, igual à data do nome do arquivo         |
| `description` | sim         | texto, até 200 caracteres                            |
| `lang`        | não         | um idioma de `languages` no `site.toml`: `pt-BR` (padrão), `en` ou `es` |
| `translation` | não         | slug(s) das outras versões do mesmo post, separados por vírgula (veja "Post com tradução") |
| `authors`     | não         | quem escreveu, em texto (ex.: `Ana Souza, Bia Lima`); aparece no cabeçalho |
| `category`    | não         | uma palavra (ex.: `Pesquisa`, `Tutorial`); vira a etiqueta do post |
| `cover`       | não         | imagem da pasta do post: aparece no topo do artigo, no cartão do índice e na prévia ao compartilhar |

O título vem do front matter. Se o texto começar com `# ` e o mesmo título, essa linha não é repetida.
HTML cru dentro do Markdown não é exibido.

## 2. Coloque as imagens na pasta do post

As imagens ficam em `posts/slug/`, ao lado do arquivo. No texto, use só o nome do arquivo
(`![...](grafico.png)`) ou `slug/grafico.png` (assim a imagem também aparece na prévia do GitHub).

Limites:

- formatos: PNG, JPG, WebP ou GIF (SVG não é aceito);
- até **400 KB** por imagem e até **3 MB** somando todas as imagens do post;
- largura recomendada: até 1600 px (a coluna de texto tem cerca de 670 px; 1200 px fica nítido em telas retina);
- toda imagem precisa de texto alternativo entre os colchetes.

Para reduzir uma imagem no Mac: `sips -Z 1600 imagem.png`. Em qualquer sistema, [Squoosh](https://squoosh.app)
converte para WebP no navegador.

## Post com tradução (português, inglês e espanhol)

Um post em vários idiomas é **um post com várias versões**, não posts independentes. Cada versão é um arquivo,
e todos apontam para as outras pelo campo `translation`, com os **slugs** delas (o slug de cada versão deve ser diferente):

```
posts/2026-12-01-whisper-no-navegador.md    lang: pt-BR  translation: whisper-in-the-browser, whisper-en-el-navegador
posts/2026-12-01-whisper-in-the-browser.md  lang: en     translation: whisper-no-navegador, whisper-en-el-navegador
posts/2026-12-01-whisper-en-el-navegador.md lang: es     translation: whisper-no-navegador, whisper-in-the-browser
posts/<slug>/                               imagens de cada versão (podem ser as mesmas, copiadas)
```

Com duas versões, basta um slug em cada. Regras (o `build.py check` confere todas):

- o grupo é recíproco: cada versão lista todas as outras;
- cada versão está em um idioma diferente;
- cada versão tem seu próprio `title`, `description`, texto e imagens (traduza também o texto alternativo e as legendas).

O que o site faz: o idioma padrão fica na raiz (`/slug.html`) e os outros em `/en/`, `/es/`. A página inicial e o feed RSS
de cada idioma mostram **uma** entrada por post, na língua daquela página, com o selo "Também em English, Español".
O seletor de idioma do cabeçalho leva à tradução do mesmo post (ou à página inicial do idioma, se não houver tradução)
e só lista idiomas que têm a página equivalente ou posts. O gerador escreve sozinho o `canonical` de cada versão
(apontando para ela mesma), as tags `hreflang` recíprocas entre todas as versões existentes (mais `x-default`),
o `<html lang>`, o `og:locale` e o sitemap com `xhtml:link`.

Post sem tradução: omita `translation`. Ele aparece só no idioma em que foi escrito; a página inicial dos outros
idiomas mostra uma nota avisando. Para traduzir depois, crie a nova versão e acrescente `translation` em todas.

## Como adicionar um idioma novo (ex.: francês)

1. Copie `i18n/pt-BR.toml` para `i18n/fr.toml` e traduza os valores (nome do idioma, `og_locale`, meses, formato de data,
   `[ui]` e `[labels]`; as chaves e os `{marcadores}` ficam iguais). `about_page` é o nome do arquivo da página Sobre.
2. Crie `pages/<about_page>.md` (copie `pages/about.md` e traduza).
3. Inclua o código em `languages` no `site.toml` (`["pt-BR", "en", "es", "fr"]`; o primeiro é o padrão, na raiz).
   O idioma passa a viver em `/fr/` (home, feed, Sobre, 404) e entra no seletor e nos `hreflang`.
4. Em `nginx.conf`, copie o bloco `location ^~ /es/` trocando `es` por `fr` (é o 404 desse idioma).
5. Rode `python build.py check`: ele avisa de qualquer chave de dicionário que faltar.

## 3. Abra o pull request

Pelo GitHub: faça um fork, adicione os arquivos (botão "Add file" → "Upload files") e abra o PR para a `main`.

A verificação automática do PR confere o front matter, as imagens e os links internos. Se algo falhar,
a mensagem de erro diz o arquivo e o motivo. Para rodar a mesma verificação na sua máquina:

```sh
python3 -m venv .venv && .venv/bin/pip install -r requirements.txt
.venv/bin/python build.py check
python3 -m http.server -d public 8000   # abra http://localhost:8000
```

Depois do merge, o post entra no site.

## Regras

- O texto precisa ser seu ou você precisa ter direito de publicá-lo, e as imagens também.
- Cite as fontes dos números com links.
- O responsável pelo blog pode pedir ajustes ou recusar um post.
