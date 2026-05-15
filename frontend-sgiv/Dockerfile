# ══════════════════════════════════
# ETAPA 1: Compilar Angular
# ══════════════════════════════════
FROM node:20-alpine AS builder

WORKDIR /app

# Copiar dependencias
COPY package*.json ./
RUN npm install

# Copiar código fuente
COPY . .

# Compilar para producción
RUN npm run build

# ══════════════════════════════════
# ETAPA 2: Servir con Nginx
# ══════════════════════════════════
FROM nginx:1.25-alpine

# Copiar el resultado del build
COPY --from=builder /app/dist/frontend-sgiv/browser /usr/share/nginx/html

# Copiar configuración de Nginx
COPY nginx.conf /etc/nginx/conf.d/default.conf

EXPOSE 80

CMD ["nginx", "-g", "daemon off;"]