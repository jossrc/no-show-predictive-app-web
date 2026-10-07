import type { ExceptionMetadata } from '../../../../shared/errors/ExceptionMetadata.js';
import { sanitizeSensitiveData } from '../../../../shared/security/SanitizeSensitiveData.js';

export function sanitizeExceptionMetadata(
  metadata: ExceptionMetadata | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (!metadata) return undefined;

  try {
    return sanitizeSensitiveData(metadata) as Readonly<Record<string, unknown>>;
  } catch {
    return { sanitizationError: 'Exception metadata could not be sanitized' };
  }
}
