# Production-style image for Task-router-x402 (API + static UI on one port).
FROM node:22-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
# npm 10 in the base image treats some optional peer trees as lockfile errors; align with dev (npm 11+).
RUN npm install -g npm@11.6.1 && npm ci --omit=dev

COPY src ./src
COPY public ./public
COPY config ./config

ENV NODE_ENV=production
EXPOSE 3000

CMD ["node", "./src/index.js"]
