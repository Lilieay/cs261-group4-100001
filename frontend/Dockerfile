FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY src ./src
COPY tests ./tests
COPY public ./public

ENV HOST=0.0.0.0

EXPOSE 5000

USER node

CMD ["npm", "start"]