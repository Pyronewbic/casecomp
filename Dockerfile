FROM node:lts-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

RUN groupadd --system appuser && useradd --system --gid appuser appuser

WORKDIR /app

COPY package.json yarn.lock* package-lock.json* ./
RUN npm install --production --ignore-scripts

RUN npx playwright install --with-deps chromium

COPY . .
RUN chown -R appuser:appuser /app

ENV NODE_ENV=production
ENV API_PORT=3000
ENV PLAYWRIGHT_BROWSERS_PATH=/app/.cache/ms-playwright

USER appuser
EXPOSE 3000

CMD ["node", "api.js"]
