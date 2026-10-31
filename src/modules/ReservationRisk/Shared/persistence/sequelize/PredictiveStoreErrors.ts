import { PersistenceUnavailableException } from '../../../../../infrastructure/database/errors/PersistenceUnavailableException.js';
import { isUndefinedTableError } from '../../../../../infrastructure/database/sequelize/postgres/PredictiveStoreProbe.js';

/** Traduce fallos del schema ml a una excepción segura (sin SQL, stack ni datos). */
export function toPersistenceException(
  operation: string,
  error: unknown,
): PersistenceUnavailableException {
  if (error instanceof PersistenceUnavailableException) return error;

  return new PersistenceUnavailableException({
    operation,
    reason: isUndefinedTableError(error) ? 'PREDICTIVE_SCHEMA_NOT_MIGRATED' : 'QUERY_FAILED',
    cause: error,
  });
}
