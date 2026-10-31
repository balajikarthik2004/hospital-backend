# Built from the repository root, because the server reads the clinical rule
# tables from agents/rules at runtime (one source of truth for both engines).
#   docker build -f server/Dockerfile .
FROM node:20-alpine

WORKDIR /app

COPY server/package*.json ./server/
RUN cd server && npm ci --omit=optional

COPY server/tsconfig.json ./server/
COPY server/src ./server/src
COPY server/seed ./server/seed
COPY agents/rules ./agents/rules

WORKDIR /app/server
ENV NODE_ENV=production
EXPOSE 5000
CMD ["npx", "tsx", "src/index.ts"]
