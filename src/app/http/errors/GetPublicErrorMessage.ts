import type { NormalizedException } from './NormalizedException.js';

export function getPublicErrorMessage(exception: NormalizedException): string {
  if (exception.kind === 'INFRASTRUCTURE') {
    return 'Servicio temporalmente no disponible';
  }

  if (exception.kind === 'UNKNOWN') {
    return 'Error interno del servidor';
  }

  if (exception.kind === 'HTTP_CLIENT') {
    const messages: Readonly<Record<number, string>> = {
      400: 'La solicitud no pudo ser procesada',
      401: 'Autenticación requerida',
      403: 'No tiene permisos para realizar esta operación',
      404: 'Ruta no encontrada',
      405: 'Método no permitido',
      408: 'La solicitud excedió el tiempo permitido',
      413: 'El contenido de la solicitud es demasiado grande',
      415: 'Tipo de contenido no soportado',
      429: 'Se realizaron demasiadas solicitudes',
    };

    return messages[exception.httpStatus ?? 400] ?? 'La solicitud no pudo ser procesada';
  }

  return exception.message;
}
