#!/bin/sh
# Pastikan sertifikat TLS tersedia agar blok `listen 443 ssl` tidak menggagalkan
# start container. Bila ./certs belum diisi (mis. clone baru tanpa mkcert),
# buat self-signed certificate. Untuk kamera di HP, sertifikat self-signed tetap
# memicu peringatan browser; mkcert lebih disarankan (lihat README).
set -e

CERT_DIR=/etc/nginx/certs
CRT="$CERT_DIR/pos.crt"
KEY="$CERT_DIR/pos.key"

mkdir -p "$CERT_DIR"

if [ -f "$CRT" ] && [ -f "$KEY" ]; then
  echo "Sertifikat TLS ditemukan di $CERT_DIR"
  exit 0
fi

echo "Sertifikat TLS tidak ditemukan; membuat self-signed di $CERT_DIR"
openssl req -x509 -nodes -newkey rsa:2048 -days 825 \
  -keyout "$KEY" -out "$CRT" \
  -subj "/CN=pos-minimarket" \
  -addext "subjectAltName=DNS:localhost,IP:127.0.0.1" 2>/dev/null

chmod 600 "$KEY"
echo "Self-signed certificate dibuat. Ganti dengan mkcert untuk kamera HP."
