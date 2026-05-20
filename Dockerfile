FROM node:24-slim AS build

WORKDIR /app

COPY package.json yarn.lock* package-lock.json* ./
RUN npm install --production

COPY . .

FROM us-docker.pkg.dev/casecomp-495718/casecomp-node24/node24:latest

WORKDIR /app
COPY --from=build /app /app

ENV NODE_ENV=production
ENV API_PORT=3000

EXPOSE 3000
CMD ["api.js"]
