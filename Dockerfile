# Gera o site a partir da main e serve os arquivos estáticos.
# O build.py check falha a imagem se algum post estiver quebrado, então nada errado vai ao ar.
FROM python:3.13-alpine AS build
WORKDIR /src
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
RUN python build.py check && python build.py

FROM nginx:1.30-alpine-slim
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /src/public/ /usr/share/nginx/html/
EXPOSE 8080
