FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json yarn.lock* package-lock.json* ./
RUN npm install --production --ignore-scripts

COPY . .

ENV NODE_ENV=production
ENV API_PORT=8080

EXPOSE 8080

CMD ["node", "api.js"]
