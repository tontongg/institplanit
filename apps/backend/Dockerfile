FROM node:22-alpine
WORKDIR /workspace
RUN apk add --no-cache openssl
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/backend/package.json apps/backend/package.json
COPY packages/api-contracts/package.json packages/api-contracts/package.json
RUN pnpm install --filter @institplanit/backend... --no-frozen-lockfile
COPY apps/backend apps/backend
COPY packages/api-contracts packages/api-contracts
WORKDIR /workspace/apps/backend
RUN pnpm exec tsc -p ../../packages/api-contracts/tsconfig.json && pnpm db:generate && pnpm build
EXPOSE 3001
CMD ["sh", "-c", "pnpm db:migrate && pnpm start"]