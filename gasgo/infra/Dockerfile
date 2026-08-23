# Imagen única para la API y para el proceso de ingesta.
FROM node:22-alpine AS build
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY services/api/package.json services/api/
# Solo los workspaces del servidor: la app móvil no entra en la imagen.
RUN npm ci --workspace @gasgo/core --workspace @gasgo/api --include-workspace-root

COPY packages/core packages/core
COPY services/api services/api
RUN npm run build -w @gasgo/core && npm run build -w @gasgo/api

FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production

COPY package.json package-lock.json ./
COPY packages/core/package.json packages/core/
COPY services/api/package.json services/api/
RUN npm ci --omit=dev --workspace @gasgo/core --workspace @gasgo/api --include-workspace-root \
  && npm cache clean --force

COPY --from=build /app/packages/core/dist packages/core/dist
COPY --from=build /app/services/api/dist services/api/dist
COPY services/api/migrations services/api/migrations

# Nunca como root.
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "services/api/dist/server.js"]
