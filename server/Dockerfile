FROM alpine:3.20 AS build

WORKDIR /app
RUN apk add --no-cache nodejs npm
COPY package*.json ./
RUN npm ci

COPY prisma ./prisma
COPY prisma.config.ts tsconfig.json ./
RUN DATABASE_URL=file:/tmp/dev.db npx prisma generate

COPY src ./src
RUN npm run build

FROM alpine:3.20

WORKDIR /app
RUN apk add --no-cache nodejs npm
ENV NODE_ENV=production
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/prisma.config.ts ./

RUN mkdir -p /app/data

EXPOSE 3001
CMD ["sh", "-c", "npx prisma migrate deploy && node dist/index.js"]
