FROM node:22-slim

# Instala ffmpeg (sem dependências GUI) e Python para o yt-dlp
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg \
    python3 \
    python3-pip \
    && rm -rf /var/lib/apt/lists/*

# Instala yt-dlp via pip (método oficial)
RUN pip3 install --break-system-packages yt-dlp

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

# Cria diretório temporário para downloads
RUN mkdir -p /tmp/canais-dark

EXPOSE 3000

CMD ["node", "src/index.js"]
