FROM node:24-alpine AS build
WORKDIR /app/dashboard

COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-alpine AS runtime
ENV NODE_ENV=production HOST=0.0.0.0 PORT=3000
WORKDIR /app/dashboard

COPY --from=build --chown=node:node /app/dashboard/package.json ./
COPY --from=build --chown=node:node /app/dashboard/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dashboard/dist ./dist
COPY --from=build --chown=node:node /app/dashboard/server ./server
COPY --from=build --chown=node:node /app/dashboard/src/finance.js /app/dashboard/src/categories.js ./src/

RUN mkdir -p /app/import /app/dashboard/data && chown node:node /app/import /app/dashboard/data
USER node
VOLUME ["/app/import", "/app/dashboard/data"]
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node --input-type=module -e "const response = await fetch('http://127.0.0.1:3000/'); if (!response.ok) process.exit(1)"
CMD ["node", "server/index.js"]