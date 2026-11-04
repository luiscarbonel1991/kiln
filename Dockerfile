# Kiln in one image: the app, its generation worker (it runs in the server's
# process) and the tools its features shell out to: Tesseract reads each
# take's text, ImageMagick flattens line art and upscales scenes, ffmpeg
# renders stills in motion. Debian no longer packages autotrace, so the
# Centerline trace is off here (Outline works).
FROM node:26-trixie-slim

RUN apt-get update \
  && apt-get install -y --no-install-recommends \
    ca-certificates tesseract-ocr imagemagick ffmpeg \
  && rm -rf /var/lib/apt/lists/*
RUN corepack enable && corepack prepare pnpm@10.33.0 --activate

WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1
# Read by `prisma generate` at install; the container's own comes from compose.
ENV DATABASE_URL=postgresql://kiln:kiln@db:5432/kiln

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml prisma.config.ts ./
COPY packages/engine/package.json packages/engine/
COPY packages/cli/package.json packages/cli/
COPY prisma ./prisma
RUN pnpm install --frozen-lockfile

COPY . .
RUN pnpm build

ENV NODE_ENV=production
EXPOSE 3000
CMD ["sh", "scripts/docker-start.sh"]
