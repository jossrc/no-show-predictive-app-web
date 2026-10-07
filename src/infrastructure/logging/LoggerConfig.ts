import pino, { type LoggerOptions } from 'pino';
import { sanitizeSensitiveData } from '../../shared/security/SanitizeSensitiveData.js';

interface LoggableRequest {
  method?: string;
  url?: string;
  host?: string;
  ip?: string;
  socket?: { remotePort?: number };
}

function serializeRequest(request: LoggableRequest): Record<string, unknown> {
  return {
    method: request.method,
    url: request.url?.split('?', 1)[0],
    host: request.host,
    remoteAddress: request.ip,
    remotePort: request.socket?.remotePort,
  };
}

function serializeError(error: unknown): unknown {
  try {
    return sanitizeSensitiveData(pino.stdSerializers.errWithCause(error as Error));
  } catch {
    return {
      type: 'UnserializableError',
      message: 'The error could not be safely serialized',
    };
  }
}

export function createLoggerConfig(environment: string, logLevel: string): LoggerOptions {
  const isDevelopment = environment.toLowerCase() === 'development';
  const isTest = environment.toLowerCase() === 'test';

  return {
    level: isTest ? 'silent' : logLevel,
    serializers: {
      req: serializeRequest,
      err: serializeError,
    },
    redact: {
      paths: [
        'req.headers.authorization',
        'req.headers.cookie',
        'req.headers["x-api-key"]',
        'authorization',
        'password',
        'token',
        'accessToken',
        'refreshToken',
        'apiKey',
        'apiSecret',
      ],
      censor: '[REDACTED]',
    },
    ...(isDevelopment && {
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      },
    }),
  };
}
