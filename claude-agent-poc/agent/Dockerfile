FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
COPY agent/package.json agent/package.json
COPY web/package.json web/package.json
RUN npm ci --workspace agent --include-workspace-root
COPY agent agent
COPY sample sample
RUN npm run build -w agent && mkdir -p /tmp/poc-workspaces && chown -R node:node /app /tmp/poc-workspaces
ENV NODE_ENV=production SAMPLE_DIR=/app/sample
USER node
EXPOSE 8080
CMD ["node", "agent/dist/server.js"]
