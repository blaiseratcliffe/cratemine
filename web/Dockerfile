# --- Build stage ---
FROM node:20-alpine AS builder

WORKDIR /app

# Railway injects env vars as build args
ARG DATABASE_URL
ARG AUTH_SECRET
ARG SESSION_SECRET

COPY package.json package-lock.json* ./
RUN npm ci --ignore-scripts

COPY . .
RUN npx prisma generate && npx prisma db push --skip-generate && npm run build

# --- Production stage ---
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000

# Install yt-dlp and its dependencies
RUN apk add --no-cache python3 ffmpeg curl \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp

# Create tmp dir for downloads
RUN mkdir -p /tmp/downloads && chmod 777 /tmp/downloads

# Copy standalone build
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

EXPOSE 3000

CMD ["node", "server.js"]
