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
RUN npm ci --ignore-scripts --workspace=@stoneos/web --workspace=@stoneos/contracts --workspace=@stoneos/sync-client --include-workspace-root

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json package-lock.json ./
COPY packages ./packages
COPY apps/web ./apps/web
ARG NEXT_PUBLIC_API_URL=http://localhost:4000
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
WORKDIR /app/apps/web
RUN npm run build

FROM node:24-alpine AS runner
WORKDIR /app
RUN addgroup -S stoneos && adduser -S stoneos -G stoneos
ENV NODE_ENV=production
COPY --from=build /app/apps/web/.next/standalone ./
COPY --from=build /app/apps/web/.next/static ./apps/web/.next/static
COPY --from=build /app/apps/web/public ./apps/web/public
USER stoneos
EXPOSE 3000
CMD ["node", "apps/web/server.js"]
