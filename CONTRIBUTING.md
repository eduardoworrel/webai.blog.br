# Como propor um post

Os posts entram por pull request. Não precisa instalar nada: dá para fazer tudo pelo site do GitHub.

## 1. Crie o arquivo do post

Nome: `posts/AAAA-MM-DD-slug.md`

- `AAAA-MM-DD` é a data de publicação.
- `slug` vira o endereço do post (`webai.blog.br/slug.html`; em inglês, `webai.blog.br/en/slug.html`): só letras minúsculas sem acento, números e
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
| `lang`        | não         | `pt-BR` (padrão) ou `en`                              |
| `translation` | não         | slug do mesmo post no outro idioma (veja "Post com tradução") |
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

## Post com tradução (português e inglês)

Um post em dois idiomas é **um post com duas versões**, não dois posts independentes. Cada versão é um arquivo,
e um aponta para o outro pelo campo `translation`, com o **slug** do outro (o slug de cada versão deve ser diferente):

```
posts/2026-12-01-whisper-no-navegador.md    lang: pt-BR   translation: whisper-in-the-browser
posts/2026-12-01-whisper-in-the-browser.md  lang: en      translation: whisper-no-navegador
posts/whisper-no-navegador/                 imagens da versão em português
posts/whisper-in-the-browser/               imagens da versão em inglês (podem ser as mesmas, copiadas)
```

Regras (o `build.py check` confere todas):

- o vínculo é recíproco: se A aponta para B, B precisa apontar para A;
- as duas versões têm idiomas diferentes (`pt-BR` e `en`);
- cada versão tem seu próprio `title`, `description`, texto e imagens (traduza também o texto alternativo e as legendas).

O que o site faz com o par: o português fica na raiz (`/slug.html`) e o inglês em `/en/` (`/en/slug.html`). A página
inicial e o feed RSS de cada idioma mostram **uma** entrada por post, na língua daquela página, com o selo
"Também em English" / "Also in Português". O seletor de idioma do cabeçalho leva à tradução do mesmo post.
O gerador também escreve sozinho o `canonical` de cada versão (apontando para ela mesma), as tags
`hreflang` recíprocas (`pt-BR`, `en`, `x-default`), o `<html lang>`, o `og:locale` e o sitemap com `xhtml:link`.

Post sem tradução: omita `translation`. Ele aparece só no idioma em que foi escrito; a página inicial do outro
idioma mostra uma nota avisando que há posts só no primeiro. Para traduzir depois, basta criar a outra versão
e acrescentar `translation` nas duas.

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
