const ValidationErrorSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['field', 'code', 'message', 'source'],
  properties: {
    field: { type: 'string' },
    code: { type: 'string' },
    message: { type: 'string' },
    source: {
      type: 'string',
      enum: ['body', 'params', 'querystring', 'headers', 'application'],
    },
  },
} as const;

export const ErrorResponseSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['error', 'requestId'],
  properties: {
    error: {
      type: 'object',
      additionalProperties: false,
      required: ['code', 'message'],
      properties: {
        code: { type: 'string' },
        message: { type: 'string' },
        errors: { type: 'array', items: ValidationErrorSchema },
        details: { type: 'object', additionalProperties: true },
      },
    },
    requestId: { type: 'string' },
  },
} as const;
