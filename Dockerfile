# musestream: the SvelteKit server, plus ffmpeg and uv for the video worker it starts.

FROM node:24-bookworm-slim AS build
WORKDIR /app
RUN apt-get update \
	&& apt-get install -y --no-install-recommends python3 make g++ \
	&& rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build && npm prune --omit=dev

FROM node:24-bookworm-slim
RUN apt-get update \
	&& apt-get install -y --no-install-recommends ffmpeg ca-certificates \
	&& rm -rf /var/lib/apt/lists/*
COPY --from=ghcr.io/astral-sh/uv:0.8 /uv /usr/local/bin/uv
ENV UV_PYTHON_INSTALL_DIR=/opt/uv-python \
	UV_FROZEN=1 \
	NODE_ENV=production \
	PORT=3000 \
	MUSESTREAM_DATA_DIR=/data
WORKDIR /app
COPY --from=build /app /app
RUN cd video-worker && uv sync --python 3.12
VOLUME /data
EXPOSE 3000
CMD ["node", "build"]
