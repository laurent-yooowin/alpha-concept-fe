# Build stage
FROM node:22-alpine AS builder

ENV PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Production stage
FROM node:22-alpine

WORKDIR /app

# Chromium and fonts are required by the server-side PDF renderer.
RUN apk add --no-cache \
    ca-certificates \
    chromium \
    dumb-init \
    font-noto-emoji \
    freetype \
    harfbuzz \
    netcat-openbsd \
    nss \
    ttf-freefont

ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true

# Create non-root user
RUN addgroup -g 1001 -S nodejs && \
    adduser -S nodejs -u 1001

# Copy files as root first
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --chown=nodejs:nodejs package*.json ./

# Create logs folder with correct permissions
RUN mkdir -p /app/logs && chown -R nodejs:nodejs /app

# Switch to non-root user
USER nodejs

EXPOSE 8089

ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
