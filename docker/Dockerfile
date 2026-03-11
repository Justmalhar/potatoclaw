# =============================================================================
# Stage 1: deps — install production node_modules
# =============================================================================
FROM node:20-slim AS deps

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

# =============================================================================
# Stage 2: final image
# =============================================================================
FROM node:20-slim AS final

WORKDIR /app

# System dependencies
# - git: required by Claude Code agent tools
# - curl: health checks and CLI installs
# - ca-certificates: HTTPS trust
# - python3: required by some native module build steps (signal-cli deps)
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    curl \
    git \
    python3 \
    && rm -rf /var/lib/apt/lists/*

# Install Claude Code CLI globally
# Using npm install -g avoids the OOM-prone native binary installer
RUN npm install -g @anthropic-ai/claude-code

# Create non-root user — Claude Code refuses bypassPermissions when running as root
RUN useradd -m -u 1001 -s /bin/bash claw

# Create data volume mount point owned by claw
RUN mkdir -p /data && chown claw:claw /data

# Copy production node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source files
COPY bin/ ./bin/
COPY config/ ./config/
COPY src/ ./src/
COPY ui/ ./ui/
COPY docker/ ./docker/
COPY package*.json ./

# Pre-create Claude config so the agent doesn't prompt on first run
RUN mkdir -p /home/claw/.claude && \
    echo '{}' > /home/claw/.claude/statsig_metadata.json && \
    echo '{"hasCompletedOnboarding":true}' > /home/claw/.claude/settings.json

# Fix ownership so claw can write to the app directory and home
RUN chown -R claw:claw /app /home/claw

# Make the CLI entry point executable
RUN chmod +x /app/bin/potatoclaw && \
    chmod +x /app/docker/entrypoint.sh

# Switch to non-root user
USER claw

ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV HOME=/home/claw
ENV PATH="/home/claw/.local/bin:${PATH}"

# Gateway HTTP  : health check + WhatsApp QR
# Mission Control UI + REST API + SSE
EXPOSE 4096 4200

VOLUME /data

ENTRYPOINT ["/bin/sh", "docker/entrypoint.sh"]
