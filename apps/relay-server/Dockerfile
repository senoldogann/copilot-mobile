FROM node:20-alpine

WORKDIR /app

COPY package.json ./
COPY src ./src

RUN npm install --omit=dev

ENV NODE_ENV=production
ENV RELAY_PORT=8787

EXPOSE 8787

CMD ["node", "src/server.mjs"]
