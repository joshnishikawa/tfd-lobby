FROM node:20-alpine

WORKDIR /app

# Install dependencies first for efficient layer caching
COPY package*.json ./
RUN npm install

# Copy application code
COPY . .

# Default port used by the lobby server
EXPOSE 4002

CMD ["npm", "start"]
