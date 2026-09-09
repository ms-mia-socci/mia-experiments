FROM node:24-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:24-bookworm-slim
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends chromium ca-certificates curl && rm -rf /var/lib/apt/lists/*
RUN curl -fsSL https://truststore.pki.rds.amazonaws.com/us-east-1/us-east-1-bundle.pem -o /app/rds-ca.pem
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/build ./build
COPY package.json ./
COPY scripts/cloud-start.mjs ./scripts/cloud-start.mjs
ENV NODE_ENV=production HOST=0.0.0.0 PORT=8080 FIELDWORK_BROWSER_EXECUTABLE=/usr/bin/chromium FIELDWORK_DATABASE_CA=/app/rds-ca.pem BODY_SIZE_LIMIT=30M
USER node
EXPOSE 8080
CMD ["node", "scripts/cloud-start.mjs"]
