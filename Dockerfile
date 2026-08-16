# Stage 1: Build
FROM node:20-alpine AS build
RUN apk add --no-cache vips-dev build-base gcc autoconf automake libtool make nasm zlib-dev
WORKDIR /opt/app
COPY package.json package-lock.json ./
RUN npm install --production=false
COPY . .

# Admin panel inlines PUBLIC_URL at build time. Secrets here are placeholders
# only; production values come from env_file at runtime.
ARG PUBLIC_URL=https://api-hotel.qenenia.com
ENV PUBLIC_URL=$PUBLIC_URL
ENV APP_KEYS=build-key-1,build-key-2,build-key-3,build-key-4
ENV API_TOKEN_SALT=build-token-salt
ENV ADMIN_JWT_SECRET=build-admin-jwt
ENV TRANSFER_TOKEN_SALT=build-transfer-salt
ENV ENCRYPTION_KEY=build-encryption-key
ENV JWT_SECRET=build-jwt-secret

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