const validationCodes: Readonly<Record<string, string>> = {
  required: 'REQUIRED',
  type: 'INVALID_TYPE',
  format: 'INVALID_FORMAT',
  minLength: 'MIN_LENGTH',
  maxLength: 'MAX_LENGTH',
  minimum: 'MIN_VALUE',
  exclusiveMinimum: 'MIN_VALUE',
  maximum: 'MAX_VALUE',
  exclusiveMaximum: 'MAX_VALUE',
  enum: 'INVALID_VALUE',
  const: 'INVALID_VALUE',
  pattern: 'INVALID_FORMAT',
  minItems: 'MIN_ITEMS',
  maxItems: 'MAX_ITEMS',
  uniqueItems: 'DUPLICATED_ITEMS',
  additionalProperties: 'UNEXPECTED_FIELD',
};

export function getValidationErrorCode(keyword: string): string {
  return validationCodes[keyword] ?? 'INVALID_VALUE';
}
