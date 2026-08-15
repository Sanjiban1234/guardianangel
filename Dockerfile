# Railway deployment Dockerfile for monorepo structure
FROM node:20-alpine AS builder

WORKDIR /app

# Copy contracts first (needed by backend)
COPY contracts/ ./contracts/

# Copy backend files
COPY backend/package*.json ./backend/
COPY backend/tsconfig.json ./backend/

# Install dependencies from backend directory
WORKDIR /app/backend
RUN npm ci

# Copy backend source and build
COPY backend/src ./src
RUN npm run build

# Production stage
FROM node:20-alpine

WORKDIR /app

# Copy contracts
COPY contracts/ ./contracts/

# Copy backend package files
COPY backend/package*.json ./backend/

WORKDIR /app/backend

# Install production dependencies only
RUN npm ci --only=production

# Copy built application from builder
COPY --from=builder /app/backend/dist ./dist

# Expose port
EXPOSE 3000

# Start application
CMD ["node", "dist/src/index.js"]
