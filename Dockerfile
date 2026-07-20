# Build: server (tsc) + web (vite). Runtime: node serving API + static web,
# with migrations applied on boot. The worker service uses this same image
# with start command:  node server/dist/worker.js
FROM node:22-alpine AS build
WORKDIR /app
COPY server/package*.json server/
RUN cd server && npm ci
COPY web/package*.json web/
RUN cd web && npm ci
COPY server server
COPY web web
# Railway passes service variables as build args when declared:
ARG VITE_API_TOKEN
ENV VITE_API_TOKEN=$VITE_API_TOKEN
RUN cd server && npm run build
RUN cd web && npm run build

FROM node:22-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY server/package*.json server/
RUN cd server && npm ci --omit=dev
COPY --from=build /app/server/dist server/dist
COPY --from=build /app/web/dist web/dist
COPY db db
ENV MIGRATIONS_DIR=/app/db
ENV WEB_DIST=/app/web/dist
CMD ["sh", "-c", "node server/dist/migrate.js && node server/dist/index.js"]
