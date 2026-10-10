# syntax=docker/dockerfile:1
FROM node:22-alpine AS build
WORKDIR /app

# Keep dependency installation cached independently of application changes.
COPY package.json package-lock.json ./
RUN npm ci --include=dev

COPY . .
RUN npm run build

FROM node:22-alpine AS production
ENV NODE_ENV=production PORT=3000 UPLOAD_DIR=/app/uploads
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && mkdir uploads && chown node:node uploads
COPY --from=build /app/dist ./dist
COPY server ./server
COPY supabase/migrations ./supabase/migrations
USER node

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/index.mjs"]
