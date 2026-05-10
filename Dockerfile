FROM node:24-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system appuser && useradd --system --gid appuser appuser

WORKDIR /app

# Layer 1: playwright system deps (rarely changes)
RUN npx playwright install --with-deps chromium

# Layer 2: npm dependencies (changes when package.json changes)
COPY package.json yarn.lock* package-lock.json* ./
RUN npm install --production --ignore-scripts

# Layer 3: application code (changes every deploy)
COPY . .
RUN chown -R appuser:appuser /app

ENV NODE_ENV=production
ENV API_PORT=3000
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.cache/ms-playwright

USER appuser
EXPOSE 3000

CMD ["node", "api.js"]
