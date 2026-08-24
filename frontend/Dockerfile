# Frontend Dockerfile for Sundry
# Multi-stage build: Build React app and serve with nginx

# Stage 1: Build the React application
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Stage 2: Serve with nginx
FROM nginx:alpine

# Copy built files from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration. The security headers are a separate snippet because
# nginx's add_header does not merge across contexts, so each location that sets
# a header of its own has to include them again — see security-headers.conf.
# Kept out of conf.d/ so nginx's own `include conf.d/*.conf` does not also load
# it as a top-level config.
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf

# Where nginx sends /api. The default is the Compose service name, so
# `docker compose up --build` is unaffected and nginx.conf stays readable with a
# real host in it rather than a placeholder.
#
# It is a build arg rather than an env var because nginx resolves a literal
# proxy_pass upstream once, at config load, and substituting at build time keeps
# that property. Platforms that do not put the backend on a host called
# `backend` override it: the Fly demo passes its private Flycast name, which is
# what lets the API Machine autostop and be woken by the next request — an
# `.internal` address would not be, since it bypasses the Fly proxy.
ARG API_UPSTREAM=backend:5000
RUN sed -i "s|proxy_pass http://backend:5000;|proxy_pass http://${API_UPSTREAM};|" \
      /etc/nginx/conf.d/default.conf \
 && grep -q "proxy_pass http://${API_UPSTREAM};" /etc/nginx/conf.d/default.conf

# Expose port
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
