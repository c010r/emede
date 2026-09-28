# Multi-stage build: build frontend + server in one stage
FROM node:24-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies (CI: npm ci)
RUN npm install

# Copy source code
COPY . .

# Build the application
RUN npm run build

# Production stage: only static files + Node server
FROM node:24-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init wget

# Copy built files from builder
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./
COPY --from=builder /app/tsconfig*.json ./

# Copy server sources (TypeScript que se ejecuta como ES modules)
COPY --from=builder /app/server ./server
COPY --from=builder /app/src ./src
COPY --from=builder /app/scripts ./scripts

# Create directory for EMEDE_DATA_DIR
RUN mkdir -p /data/.emede

# Expose port 5178
EXPOSE 5178

# Set environment variables
ENV HOST=0.0.0.0 \
    PORT=5178 \
    EMEDE_DATA_DIR=/data/.emede

# Use dumb-init to handle signals properly
ENTRYPOINT ["dumb-init", "--"]

# Start the server
CMD ["node", "server/index.ts"]
