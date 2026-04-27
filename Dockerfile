# Production-style image for Task-router-x402 (API + static UI on one port).
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY private ./private
COPY config ./config

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "./src/index.js"]
