# Stage 1: Build
FROM node:20-alpine AS build
RUN apk add --no-cache vips-dev build-base gcc autoconf automake libtool make nasm zlib-dev
WORKDIR /opt/app
COPY package.json package-lock.json ./
RUN npm install --production=false
COPY . .
RUN npm run build

# Stage 2: Runtime
FROM node:20-alpine
RUN apk add --no-cache vips-dev
WORKDIR /opt/app
COPY --from=build /opt/app ./
# Ensure the uploads folder exists for the volume mount
RUN mkdir -p /opt/app/public/uploads

EXPOSE 1337
CMD ["npm","run", "start"]