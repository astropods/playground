# syntax=docker/dockerfile:1

# Stage 1: Build
FROM oven/bun:1 AS builder
WORKDIR /app

# Copy package files and install dependencies
COPY package.json ./
RUN bun install

# Copy source files and build
COPY . ./
RUN bun run build

# Stage 2: Serve
FROM nginx:alpine

# Copy built files
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy env-config template and entrypoint script
COPY env-config.template.js /usr/share/nginx/html/env-config.template.js
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh && \
    chown -R nginx:nginx /usr/share/nginx/html && \
    chown -R nginx:nginx /etc/nginx/conf.d && \
    chown -R nginx:nginx /var/cache/nginx && \
    chown -R nginx:nginx /var/log/nginx && \
    touch /var/run/nginx.pid && chown nginx:nginx /var/run/nginx.pid

USER nginx

EXPOSE 80

ENTRYPOINT ["/docker-entrypoint.sh"]
CMD ["nginx", "-g", "daemon off;"]
