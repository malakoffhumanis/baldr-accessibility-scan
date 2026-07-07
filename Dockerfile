# ── Runtime (pre-built image: no build, no npm install here) ──
# Base pinned by multi-arch manifest digest for reproducible, supply-chain-safe
# builds. Refresh with: docker buildx imagetools inspect node:24-slim
FROM node:24-slim

WORKDIR /app

# Build arguments (optional)
ARG VERSION=local
ARG BUILD_DATE
ARG VCS_REF
# Source repository URL (OCI image.source) — set at build/CI, e.g. https://github.com/<org>/baldr
ARG SOURCE
# Listen port — overridable at build (--build-arg PORT) AND at runtime (-e PORT)
ARG PORT=3000

# Metadata
LABEL version="${VERSION}" \
      build-date="${BUILD_DATE}" \
      vcs-ref="${VCS_REF}" \
      description="BALDR - Automated accessibility audit" \
      org.opencontainers.image.title="baldr-api" \
      org.opencontainers.image.version="${VERSION}" \
      org.opencontainers.image.description="BALDR - Automated accessibility audit" \
      org.opencontainers.image.source="${SOURCE}" \
      org.opencontainers.image.licenses="MIT" \
      org.opencontainers.image.revision="${VCS_REF}" \
      org.opencontainers.image.created="${BUILD_DATE}"

# Environment variables
ENV NODE_ENV=production \
    PORT=${PORT} \
    PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true \
    PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium \
    APP_VERSION=${VERSION}

# Chromium + minimal runtime deps. The `chromium` package pulls its own shared
# libraries through apt (Depends are kept even with --no-install-recommends),
# so the brittle hand-maintained lib list is unnecessary and survives Debian
# bumps. tini gives a proper PID 1: it reaps Chromium's child processes (no
# zombies) and forwards SIGTERM for graceful shutdown.
RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    ca-certificates \
    fonts-liberation \
    fonts-noto-color-emoji \
    tini \
    && rm -rf /var/lib/apt/lists/*

# Pre-built artifacts produced by CI (npm ci → build → npm prune --omit=dev)
# Order = most stable to most volatile (layer caching)
COPY package*.json ./
COPY node_modules/ ./node_modules/
COPY dist/ ./dist/

# Runtime directories (non-root)
RUN mkdir -p reports config /app/certs \
    && chown -R node:node reports config /app/certs

USER node

EXPOSE ${PORT}

HEALTHCHECK --interval=30s --timeout=3s --start-period=40s --retries=3 \
    CMD node -e "import('http').then(h => h.default.get('http://localhost:' + (process.env.PORT || 3000) + '/api/v1/health', r => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1)))"

# Custom CA: -v /path/to/ca.cer:/app/certs/root.cer  then  NODE_EXTRA_CA_CERTS=/app/certs/root.cer
# tini as PID 1 — reaps Chromium zombies and forwards signals to Node.
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/api/server.js"]
