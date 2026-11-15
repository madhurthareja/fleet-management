FROM node:22-slim
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY src ./src
ENV GATEWAY_PORT=3000 DB_FILE=/data/fleet.db
EXPOSE 3000
CMD ["node", "src/start.js"]
