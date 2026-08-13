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

# Install ALL dependencies (including devDependencies for build).
#
# The cache is cleaned in the SAME layer, which is the only place it can be
# done: `npm ci` writes ~/.npm inside this layer, and a later `RUN rm -rf` would
# mask those bytes without reclaiming them — the same reason the
# `npm prune --production` below does not shrink the image either.
RUN npm ci && npm cache clean --force

# Copy source code
COPY . .

# Build TypeScript to JavaScript (using production tsconfig)
RUN npx tsc --project tsconfig.prod.json

# Copy the OCR language data out of the @tesseract.js-data packages while they
# are still installed — the prune below deletes them. ~5.6 MB in the image, and
# the difference between a first receipt scan that works on a fresh install and
# one that has to reach a CDN from inside a worker thread. See
# scripts/stage-tessdata.js.
RUN npm run tessdata

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
