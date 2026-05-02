FROM node:20-alpine

ENV NODE_ENV=production

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./
COPY public/ ./public/

RUN addgroup -g 1001 -S unsub && \
    adduser -S unsub -u 1001 -G unsub && \
    chown -R unsub:unsub /app

USER unsub

EXPOSE 4000

HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:4000/health || exit 1

CMD ["node", "server.js"]
