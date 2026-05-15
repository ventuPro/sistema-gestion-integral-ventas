FROM node:20-alpine

# Directorio de trabajo
WORKDIR /app

# Copiar dependencias primero (mejor cache de Docker)
COPY package*.json ./

# Instalar solo dependencias de producción
RUN npm install --omit=dev

# Copiar el resto del código
COPY . .

# Puerto que expone el backend
EXPOSE 3000

# Comando de inicio
CMD ["node", "src/server.js"]