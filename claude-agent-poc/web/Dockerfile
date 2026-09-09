FROM node:24-bookworm-slim AS builder
WORKDIR /app
COPY package.json package-lock.json ./
COPY agent/package.json agent/package.json
COPY web/package.json web/package.json
RUN npm ci --workspace web --include-workspace-root
COPY web web
RUN npm run build -w web
FROM node:24-bookworm-slim
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/web/build ./build
COPY web/package.json ./package.json
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
USER node
EXPOSE 3000
CMD ["node","build/index.js"]
