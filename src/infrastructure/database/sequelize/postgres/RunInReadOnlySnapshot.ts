import { QueryTypes, Transaction } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';

export interface ReadOnlySnapshotOptions {
  readonly statementTimeoutMs: number;
}

/**
 * Ejecuta lecturas sobre raw_flow/analytics en una transacción REPEATABLE READ READ ONLY con
 * statement_timeout local. Garantiza coherencia entre sentencias de la misma consulta y que
 * ninguna escritura accidental llegue a los esquemas fuente. NO prueba que la foto corresponda
 * al instante original de la reserva: solo al estado replicado actual.
 */
export async function runInReadOnlySnapshot<T>(
  sequelize: Sequelize,
  options: ReadOnlySnapshotOptions,
  work: (transaction: Transaction) => Promise<T>,
): Promise<T> {
  const timeoutMs = Math.trunc(options.statementTimeoutMs);
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) {
    throw new RangeError('statementTimeoutMs debe ser un entero positivo');
  }

  return sequelize.transaction(
    { isolationLevel: Transaction.ISOLATION_LEVELS.REPEATABLE_READ },
    async (transaction) => {
      await sequelize.query('SET TRANSACTION READ ONLY', { transaction, type: QueryTypes.RAW });
      await sequelize.query(`SET LOCAL statement_timeout = ${timeoutMs}`, {
        transaction,
        type: QueryTypes.RAW,
      });
      // Consultas OLTP cortas: el JIT costaba 70–120 ms por petición en el benchmark
      // (docs/sprint-01/performance.md). Solo afecta a esta transacción.
      await sequelize.query('SET LOCAL jit = off', { transaction, type: QueryTypes.RAW });
      return work(transaction);
    },
  );
}
