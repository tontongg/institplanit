FROM node:22-alpine
WORKDIR /workspace
RUN corepack enable
COPY package.json pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/bff/package.json apps/bff/package.json
RUN pnpm install --filter @institplanit/bff --no-frozen-lockfile
COPY apps/bff apps/bff
WORKDIR /workspace/apps/bff
RUN pnpm build
EXPOSE 3000
CMD ["pnpm", "start"]