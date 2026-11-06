FROM node:22-alpine
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/frontend/package.json apps/frontend/package.json
RUN pnpm install --filter @institplanit/frontend --no-frozen-lockfile
COPY apps/frontend apps/frontend
WORKDIR /workspace/apps/frontend
EXPOSE 5173
CMD ["pnpm", "dev"]