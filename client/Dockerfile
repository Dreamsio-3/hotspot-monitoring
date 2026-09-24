FROM alpine:3.20 AS build

WORKDIR /app
RUN apk add --no-cache nodejs npm
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM alpine:3.20
RUN apk add --no-cache nginx
COPY nginx.conf /etc/nginx/http.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
