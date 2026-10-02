# Stage 1: Build
FROM node:20-alpine AS build
WORKDIR /app
COPY package*.json ./
RUN npm install --frozen-lockfile || npm install
COPY . .
RUN npm run build

# Stage 2: Production
FROM nginx:stable-alpine
# Template diproses otomatis oleh entrypoint nginx ke /etc/nginx/conf.d/default.conf,
# sehingga ${HTTPS_HOST_PORT} disubstitusi dari environment saat container start.
COPY nginx/templates/default.conf.template /etc/nginx/templates/default.conf.template
# Entrypoint: pastikan sertifikat TLS ada; bila ./certs kosong, buat self-signed
# agar container tetap start (HTTPS wajib untuk kamera/getUserMedia di HP).
COPY nginx/docker-entrypoint.d/10-generate-cert.sh /docker-entrypoint.d/10-generate-cert.sh
RUN chmod +x /docker-entrypoint.d/10-generate-cert.sh
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80 443
CMD ["nginx", "-g", "daemon off;"]
