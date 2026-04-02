FROM node:22-slim AS development-dependencies-env
COPY ./package.json package-lock.json /app/
WORKDIR /app
RUN npm ci

FROM node:22-slim AS production-dependencies-env
COPY ./package.json package-lock.json /app/
WORKDIR /app
# isolated-vm requires build tools for native compilation
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN npm ci --omit=dev

FROM node:22-slim AS build-env
COPY . /app/
COPY --from=development-dependencies-env /app/node_modules /app/node_modules
WORKDIR /app
RUN npm run build

FROM node:22-slim
COPY ./package.json package-lock.json /app/
COPY --from=production-dependencies-env /app/node_modules /app/node_modules
COPY --from=build-env /app/build /app/build
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=8080
EXPOSE 8080
CMD ["npm", "run", "start"]
