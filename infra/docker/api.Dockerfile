FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/desktop/package.json apps/desktop/
COPY apps/android/package.json apps/android/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
COPY packages/auth/package.json packages/auth/
COPY packages/storage/package.json packages/storage/
COPY packages/sync-client/package.json packages/sync-client/
RUN npm ci --ignore-scripts --workspace=@stoneos/api --workspace=@stoneos/contracts --workspace=@stoneos/domain --workspace=@stoneos/auth --workspace=@stoneos/storage --include-workspace-root

FROM node:24-alpine AS runner
WORKDIR /app
ENV TZ=Asia/Kolkata
RUN addgroup -S stoneos && adduser -S stoneos -G stoneos
RUN apk add --no-cache wget openssl libc6-compat tzdata
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json tsconfig.base.json ./
COPY packages ./packages
COPY apps/api ./apps/api
WORKDIR /app/apps/api
RUN npx prisma generate --schema prisma/schema.prisma
ENV STORAGE_LOCAL_DIR=/app/apps/api/data/storage
RUN mkdir -p /app/apps/api/data/storage && chown -R stoneos:stoneos /app/apps/api/data
USER stoneos
EXPOSE 4000
CMD ["npx", "tsx", "--tsconfig", "tsconfig.json", "src/main.ts"]
