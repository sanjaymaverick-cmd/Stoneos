FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json* ./
COPY apps/api/package.json apps/api/
COPY packages/contracts/package.json packages/contracts/
COPY packages/domain/package.json packages/domain/
COPY packages/auth/package.json packages/auth/
COPY packages/storage/package.json packages/storage/
COPY packages/sync-client/package.json packages/sync-client/
RUN npm install --workspaces --if-present

FROM node:24-alpine AS runner
WORKDIR /app
RUN addgroup -S stoneos && adduser -S stoneos -G stoneos
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/apps/api/node_modules ./apps/api/node_modules
COPY package.json ./
COPY packages ./packages
COPY apps/api ./apps/api
WORKDIR /app/apps/api
RUN npx prisma generate --schema prisma/schema.prisma
USER stoneos
EXPOSE 4000
CMD ["npx", "tsx", "src/main.ts"]
