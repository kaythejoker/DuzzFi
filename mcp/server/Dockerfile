FROM node:24-slim

ENV NODE_ENV=production
WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev --no-audit --no-fund

COPY tsconfig.json ./
COPY src ./src

USER node
EXPOSE 8787
CMD ["node", "--import", "tsx", "src/server.ts"]
