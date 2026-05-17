const getBackendUrl = (): string => {
  if (typeof window === 'undefined') return 'http://localhost:3000/api';

  const hostname = window.location.hostname;
  const protocol = window.location.protocol;

  // En producción (dominio real), usar el mismo origen o variable de entorno
  if (hostname !== 'localhost' && hostname !== '127.0.0.1') {
    // Si estás en tu dominio, el backend debe estar en el mismo dominio o un subdominio
    // Para Railway/Render: reemplaza con tu URL real de backend
    return `${protocol}//${hostname}:3000/api`;
  }

  return 'http://localhost:3000/api';
};

export const environment = {
  production:    false,
  apiUrl:        getBackendUrl(),
  // URL del frontend para los QR (se usa en la generación del QR)
  frontendUrl:   typeof window !== 'undefined'
                   ? `${window.location.protocol}//${window.location.hostname}:${window.location.port || '4200'}`
                   : 'http://localhost:4200'
};