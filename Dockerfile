# ha-staging-kit — single image: web UI + config sync + optional MQTT mirror
# syntax=docker/dockerfile:1
FROM node:20-alpine AS web
WORKDIR /web
COPY console/web/package.json console/web/package-lock.json* ./
RUN --mount=type=cache,target=/root/.npm \
    npm install
COPY console/web/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS dotnet
WORKDIR /src
COPY console/HaStagingConsole/HaStagingConsole.csproj console/HaStagingConsole/
RUN --mount=type=cache,target=/root/.nuget/packages \
    dotnet restore console/HaStagingConsole/HaStagingConsole.csproj
COPY console/HaStagingConsole/ console/HaStagingConsole/
COPY --from=web /web/dist/ console/HaStagingConsole/wwwroot/
RUN --mount=type=cache,target=/root/.nuget/packages \
    dotnet publish console/HaStagingConsole/HaStagingConsole.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash curl jq rsync git openssh-client tzdata mosquitto procps docker.io \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY --from=dotnet /app/publish .
COPY docker-compose.yml /kit/docker-compose.yml
COPY sidecar/lib /sidecar/lib
COPY sidecar/sbin /sidecar/sbin
COPY sidecar/templates /sidecar/templates
COPY mirror /kit/mirror
COPY scripts /kit/scripts
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /sidecar/sbin/*.sh /kit/scripts/*.sh 2>/dev/null || true \
    && chmod +x /kit/scripts/deploy.sh /kit/scripts/deploy-common.sh /kit/scripts/mirror-control-mode.sh /kit/scripts/deploy-mirror.sh /kit/scripts/init-data-dirs.sh

ENV ASPNETCORE_URLS=http://0.0.0.0:8080
ENV KIT_ROOT=/kit
ENV SIDECAR_CONFIG=/sidecar-data/config.env
ENV REPO_DIR=/repo
ENV HA_CONFIG=/ha-config

EXPOSE 8080 1883
ENTRYPOINT ["/entrypoint.sh"]
