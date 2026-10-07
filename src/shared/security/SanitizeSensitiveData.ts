const REDACTED = '[REDACTED]';
const MAX_DEPTH = 8;

const sensitiveKeyParts = [
  'password',
  'authorization',
  'cookie',
  'token',
  'apikey',
  'apisecret',
  'secret',
  'privatekey',
  'creditcard',
  'cardnumber',
  'cvv',
  'credential',
  'connectionstring',
  'databaseurl',
] as const;

function isSensitiveKey(key: string): boolean {
  const normalizedKey = key.toLowerCase().replaceAll(/[-_.]/g, '');
  return sensitiveKeyParts.some((part) => normalizedKey.includes(part));
}

function sanitizeValue(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (depth > MAX_DEPTH) return '[MAX_DEPTH]';
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value;
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'undefined') return '[UNDEFINED]';
  if (typeof value === 'function' || typeof value === 'symbol') return '[UNSERIALIZABLE]';

  if (value instanceof Date) return value.toISOString();
  if (seen.has(value)) return '[CIRCULAR]';

  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeValue(item, depth + 1, seen));
  }

  const sanitized: Record<string, unknown> = {};

  for (const [key, nestedValue] of Object.entries(value)) {
    sanitized[key] = isSensitiveKey(key) ? REDACTED : sanitizeValue(nestedValue, depth + 1, seen);
  }

  return sanitized;
}

export function sanitizeSensitiveData(value: unknown): unknown {
  return sanitizeValue(value, 0, new WeakSet<object>());
}
