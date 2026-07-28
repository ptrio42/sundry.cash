# Backend Dockerfile for Sundry
FROM node:22-alpine

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

# Create data directory for SQLite database
RUN mkdir -p /app/data

# Expose port
EXPOSE 5000

# Set environment variables
ENV NODE_ENV=production

# Start the application
CMD ["node", "dist/server.js"]
