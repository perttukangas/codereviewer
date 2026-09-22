FROM node:24-bookworm-slim AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json biome.json ./
COPY src ./src
RUN npm run build

FROM node:24-bookworm-slim AS runtime

RUN apt-get update \
	&& apt-get install -y --no-install-recommends \
		ca-certificates \
		fd-find \
		ripgrep \
	&& rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production

COPY --chown=node:node package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build --chown=node:node /app/dist ./dist

USER node

ENTRYPOINT ["node", "dist/index.js"]
