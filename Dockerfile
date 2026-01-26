# Marketero Development Environment
FROM node:22-slim

# Install system dependencies
RUN apt-get update && apt-get install -y \
    git \
    curl \
    chromium \
    chromium-driver \
    && rm -rf /var/lib/apt/lists/*

# Set Chrome/Chromium environment variables for Puppeteer
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

# Create app directory
WORKDIR /marketero

# Install clawdbot globally
RUN npm install -g clawdbot

# Create directories for persistent data
RUN mkdir -p /data/memory /data/projects /data/skills

# Expose port for dashboard
EXPOSE 3000

# Default command
CMD ["bash"]
