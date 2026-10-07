FROM node:24.20.0-alpine3.23 AS base
WORKDIR /usr/src/app

COPY package*.json ./
COPY tsconfig*.json ./

RUN npm ci
COPY src ./src
COPY migrations ./migrations

RUN npm run build

EXPOSE 8271

CMD ["npm", "start"]
