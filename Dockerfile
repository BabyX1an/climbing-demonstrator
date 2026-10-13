FROM mcr.microsoft.com/playwright:v1.58.2-noble AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg && rm -rf /var/lib/apt/lists/*
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build
EXPOSE 3001
ENV NODE_ENV=production PORT=3001
CMD ["npm", "start"]
