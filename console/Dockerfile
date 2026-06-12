FROM node:20-alpine AS web
WORKDIR /web
COPY web/package.json ./
RUN npm install
COPY web/ ./
RUN npm run build

FROM mcr.microsoft.com/dotnet/sdk:8.0 AS dotnet
WORKDIR /src
COPY HaStagingConsole/HaStagingConsole.csproj HaStagingConsole/
RUN dotnet restore HaStagingConsole/HaStagingConsole.csproj
COPY HaStagingConsole/ HaStagingConsole/
COPY --from=web /web/dist/ HaStagingConsole/wwwroot/
RUN dotnet publish HaStagingConsole/HaStagingConsole.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0-bookworm-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends docker.io bash openssh-client curl \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=dotnet /app/publish .
ENV ASPNETCORE_URLS=http://0.0.0.0:8080
EXPOSE 8080
ENTRYPOINT ["dotnet", "HaStagingConsole.dll"]
