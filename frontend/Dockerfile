# Stage 1 : Build
FROM node:18-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install

COPY . .
RUN npm run build

# Stage 2 : Serveur Nginx pour production
FROM nginx:alpine

COPY --from=builder /app/dist /usr/share/nginx/html

COPY nginx/conf.d/frontend.conf /etc/nginx/conf.d/default.conf
COPY nginx/conf.d/backend.conf /etc/nginx/conf.d/backend.conf
COPY nginx/ssl /etc/nginx/ssl

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]