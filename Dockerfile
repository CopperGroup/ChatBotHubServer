# Use official Node.js image
FROM node:20-alpine

# Create app directory
WORKDIR /app

# Copy package.json and package-lock.json first (for efficient caching)
COPY package*.json ./

# Install dependencies
RUN npm install

# Copy the rest of the app source code
COPY . .

# Expose the port your app runs on
EXPOSE 3001

# Start the server
CMD ["npm", "start"]
