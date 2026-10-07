import type { FastifyRequest } from 'fastify';
import type { NormalizedException } from '../NormalizedException.js';
import type { ExceptionReport } from './ExceptionReport.js';
import { sanitizeExceptionMetadata } from './SanitizeExceptionMetadata.js';

function getSafeRequestUrl(request: FastifyRequest): string {
  const routeUrl = request.routeOptions.url;
  if (routeUrl) return routeUrl;

  return request.url.split('?', 1)[0] ?? request.url;
}

export function buildExceptionReport(
  exception: NormalizedException,
  request: FastifyRequest,
): ExceptionReport {
  const metadata = sanitizeExceptionMetadata(exception.metadata);

  return {
    timestamp: new Date().toISOString(),
    requestId: request.id,
    method: request.method,
    url: getSafeRequestUrl(request),
    exception: {
      name: exception.name,
      code: exception.code,
      category: exception.category,
      kind: exception.kind,
      message: exception.message,
      ...(metadata ? { metadata } : {}),
      ...(exception.stack ? { stack: exception.stack } : {}),
    },
  };
}
