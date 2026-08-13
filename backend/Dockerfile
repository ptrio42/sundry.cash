# Backend Dockerfile for Sundry
FROM node:24-alpine

# su-exec lets the entrypoint drop from root to `node` after fixing ownership of
# the bind-mounted data directory. See docker-entrypoint.sh.
RUN apk add --no-cache su-exec

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY tsconfig.json ./
COPY tsconfig.prod.json ./

# Install ALL dependencies (including devDependencies for build)
RUN npm ci

# Copy source code
COPY . .

# Build TypeScript to JavaScript (using production tsconfig)
RUN npx tsc --project tsconfig.prod.json

# Remove devDependencies
RUN npm prune --production

# Create the data directory and hand the whole app tree to the unprivileged user
# the entrypoint will switch to.
RUN mkdir -p /app/data && chown -R node:node /app

# Expose port
EXPOSE 5000

# Set environment variables
ENV NODE_ENV=production

# The entrypoint starts as root only long enough to chown the bind-mounted
# volume, then execs the server as `node` — so the application process itself
# never runs privileged.
COPY --chmod=0755 docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
ENTRYPOINT ["docker-entrypoint.sh"]

# Start the application
CMD ["node", "dist/server.js"]
