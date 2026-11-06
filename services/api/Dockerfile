# saoi-api. The build context is the REPOSITORY ROOT, because the service bundles the shared
# server code from supabase/functions/_shared:
#
#   docker build -f services/api/Dockerfile -t saoi-api .
#
FROM node:24-alpine AS build
WORKDIR /repo/services/api

COPY services/api/package.json services/api/package-lock.json ./
RUN npm ci

COPY services/api/ ./
COPY supabase/functions/_shared /repo/supabase/functions/_shared
RUN npm run typecheck && npm run build && npm prune --omit=dev

FROM node:24-alpine
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build --chown=node:node /repo/services/api/package.json ./
COPY --from=build --chown=node:node /repo/services/api/node_modules ./node_modules
COPY --from=build --chown=node:node /repo/services/api/dist ./dist

ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION \
    PORT=3000

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null "http://127.0.0.1:${PORT}/health" || exit 1

CMD ["node", "dist/server.js"]
