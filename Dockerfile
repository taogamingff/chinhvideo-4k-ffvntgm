FROM node:22-bookworm-slim

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

RUN mkdir -p storage/uploads storage/outputs

ENV NODE_ENV=production
EXPOSE 3000

CMD ["npm", "start"]