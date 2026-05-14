FROM node:24-slim AS build

WORKDIR /app

COPY package.json yarn.lock* package-lock.json* ./
RUN npm install --production

COPY . .
RUN rm -rf .git .env* test/ extension/ terraform/ docs/ public/admin/ *.md .github/

FROM gcr.io/distroless/nodejs24-debian12

WORKDIR /app
COPY --from=build /app /app

ENV NODE_ENV=production
ENV API_PORT=3000

EXPOSE 3000
CMD ["api.js"]
