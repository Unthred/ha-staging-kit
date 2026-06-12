FROM alpine:3.21
RUN apk add --no-cache bash curl jq rsync git openssh-client tzdata
COPY lib /sidecar/lib
COPY sbin /sidecar/sbin
COPY templates /sidecar/templates
COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh /sidecar/sbin/*.sh
ENTRYPOINT ["/entrypoint.sh"]
