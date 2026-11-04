FROM node:24-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build
USER node
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ["node", "--env-file-if-exists=.env", "--import", "tsx", "server/index.ts"]
