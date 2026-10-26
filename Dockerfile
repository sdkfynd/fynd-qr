FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN npm install --global pnpm@11.19.0
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile
COPY tsconfig.json tsconfig.server.json ./
COPY server ./server
COPY src ./src
RUN pnpm typecheck:server && pnpm prune --prod

FROM node:24-bookworm-slim
ENV NODE_ENV=production API_HOST=0.0.0.0 PORT=4301
WORKDIR /app
COPY --from=build --chown=node:node /app /app
USER node
EXPOSE 4301
HEALTHCHECK --interval=30s --timeout=6s --start-period=20s CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/health').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["node", "--import", "tsx", "server/start.ts"]
