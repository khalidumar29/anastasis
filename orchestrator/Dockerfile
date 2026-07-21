# Build context is the REPO ROOT, not orchestrator/ — the orchestrator's own
# build.ts assumes `template/` and `Agents.md` are siblings one level up
# (REPO_ROOT = path.resolve(process.cwd(), "..")), so that layout has to be
# preserved inside the image too.
#   docker build -f orchestrator/Dockerfile -t <tag> .
FROM node:20-slim
RUN apt-get update && apt-get install -y --no-install-recommends \
    ffmpeg ca-certificates curl python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g @openai/codex

WORKDIR /app
COPY Agents.md ./Agents.md
COPY template ./template
COPY orchestrator ./orchestrator

WORKDIR /app/template
RUN npm ci

WORKDIR /app/orchestrator
RUN npm ci
RUN npm run build

ENV NODE_ENV=production
EXPOSE 3000

COPY orchestrator/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh \
  && mkdir -p /app/orchestrator/.data /app/.codex-home \
  && chown -R node:node /app

USER node
ENV CODEX_HOME=/app/.codex-home
ENTRYPOINT ["/app/docker-entrypoint.sh"]
CMD ["npm", "run", "start"]
