import { Pipe, PipeTransform } from '@angular/core';
import { environment } from '../../../environments/environment';

// Resuelve url_imagen: deja intactas las data: / http(s) y antepone el host
// del backend a las rutas relativas (/uploads/productos/...).
@Pipe({ name: 'imagenUrl', standalone: true })
export class ImagenUrlPipe implements PipeTransform {
  transform(url: string | null | undefined): string {
    if (!url) return '';
    if (url.startsWith('data:') || url.startsWith('http')) return url;
    return `${environment.apiUrl.replace('/api', '')}${url}`;
  }
}
