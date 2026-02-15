# syntax=docker/dockerfile:1.7

FROM node:20-alpine AS base
ENV PNPM_HOME=/pnpm
ENV PATH=$PNPM_HOME:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json turbo.json tsconfig.base.json ./
COPY apps/ponder/package.json apps/ponder/package.json
RUN pnpm install --frozen-lockfile

FROM deps AS build
COPY apps/ponder ./apps/ponder
RUN pnpm --filter @tickasting/ponder typecheck

FROM base AS runner
ENV NODE_ENV=production
WORKDIR /app

COPY --from=build /app/package.json ./package.json
COPY --from=build /app/pnpm-workspace.yaml ./pnpm-workspace.yaml
COPY --from=build /app/apps/ponder ./apps/ponder
COPY --from=build /app/node_modules ./node_modules

EXPOSE 42069
CMD ["pnpm", "--filter", "@tickasting/ponder", "start"]
