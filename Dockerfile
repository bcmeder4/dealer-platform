FROM node:20-alpine

RUN apk add --no-cache \
    chromium \
    nss \
    freetype \
    harfbuzz \
    ca-certificates \
    ttf-freefont \
    python3 \
    make \
    g++

ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium-browser \
    NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=devRUN npm install --omit=dev

COPY src/ ./src/

RUN mkdir -p /srv/proofs /srv/logs

RUN addgroup -g 1001 -S dealer && \
    adduser -S dealer -u 1001 -G dealer && \
    chown -R dealer:dealer /app /srv/proofs /srv/logs

USER dealer

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
    CMD wget -qO- http://localhost:3000/health || exit 1

CMD ["node", "src/server.js"]
