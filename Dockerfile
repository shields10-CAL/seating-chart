FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .

RUN mkdir -p /app/data \
    && chown -R node:node /app

ENV NODE_ENV=production
EXPOSE 3000

USER node

CMD ["node", "server.js"]
