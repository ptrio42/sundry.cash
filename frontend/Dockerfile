# Frontend Dockerfile for Sundry
# Multi-stage build: Build React app and serve with nginx

# Stage 1: Build the React application
FROM node:22-alpine AS builder

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

# Expose port
EXPOSE 80

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
