import type { FastifySchemaValidationError, SchemaErrorDataVar } from 'fastify/types/schema.js';
import type { ValidationError } from '../../../../shared/errors/validation/ValidationError.js';
import { getValidationErrorCode } from './GetValidationErrorCode.js';
import { getValidationErrorMessage } from './GetValidationErrorMessage.js';
import { getValidationField } from './GetValidationField.js';

export function mapFastifyValidationErrors(
  errors: readonly FastifySchemaValidationError[],
  source: SchemaErrorDataVar,
): readonly ValidationError[] {
  return errors.map((error) => {
    const field = getValidationField(error.instancePath, error.keyword, error.params);
    const code = getValidationErrorCode(error.keyword);

    return {
      field,
      code,
      message: getValidationErrorMessage(code, field),
      source,
    };
  });
}
