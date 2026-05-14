# Node 24 base image (Wolfi + apko)

Minimal Node 24 runtime image built with [apko](https://github.com/chainguard-dev/apko) on [Wolfi](https://wolfi.dev/). No shell, non-root user (uid 65532).

## Build locally

```bash
apko build apko.yaml casecomp-node24:latest casecomp-node24.tar
docker load < casecomp-node24.tar
docker run --rm casecomp-node24:latest-arm64 --version
```

## CI build

Manual trigger only — run "Base Image" workflow from GitHub Actions UI or:
```bash
gh workflow run base-image.yml
```

Pushes to `gcr.io/casecomp-495718/casecomp-node24:latest` and `:$SHA`.

## What's included

- `nodejs-24` + `npm` (Wolfi packages)
- `ca-certificates-bundle` (HTTPS)
- Multi-arch: amd64 + arm64

## Usage in Dockerfile

```dockerfile
FROM gcr.io/casecomp-495718/casecomp-node24:latest AS build
WORKDIR /app
COPY package.json ./
RUN npm install --production
COPY . .

# Same image for runtime — npm exists but isn't used
CMD ["api.js"]
```

## Vendored melange configs

`melange/` contains the Wolfi build configs for the critical packages:
- `nodejs-24.yaml` — Node.js 24.15.0 build from source (from wolfi-dev/os)
- `npm.yaml` — npm 11.14.1 build (from wolfi-dev/os)

These are reference copies — if Wolfi changes their build or you need to rebuild Node from source, the configs are here. Everything else (glibc, openssl, etc.) comes from the Wolfi registry.

To update: pull latest from `https://github.com/wolfi-dev/os` and re-run `apko lock apko.yaml`.

## Why custom instead of distroless or Chainguard free?

- Distroless: maintained by Google, can't control update schedule
- Chainguard free: `:latest` only, no version pinning
- Custom: we control exact package versions, rebuild when we want, vendored build configs for critical packages, same Wolfi supply chain as Chainguard
