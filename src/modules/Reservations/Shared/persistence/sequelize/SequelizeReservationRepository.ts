import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { SourceDataUnavailableException } from '../../../../../infrastructure/database/errors/SourceDataUnavailableException.js';
import { runInReadOnlySnapshot } from '../../../../../infrastructure/database/sequelize/postgres/RunInReadOnlySnapshot.js';
import type { Reservation } from '../../models/Reservation.js';
import type {
  ReservationSource,
  ReservationSourceCriteria,
  ReservationSourcePage,
} from '../ReservationSource.js';
import { mapReservationRow, type ReservationRow } from './ReservationRowMapper.js';
import {
  buildReservationByIdQuery,
  buildReservationListQuery,
  CLINIC_EXISTS_SQL,
  type BuiltQuery,
} from './ReservationSql.js';

/**
 * Fuente de reservas sobre PostgreSQL raw_flow/analytics: toda lectura en REPEATABLE READ READ
 * ONLY con statement_timeout. No lee ni escribe el schema ml (funciona aunque no esté migrado).
 */
export class SequelizeReservationRepository implements ReservationSource {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly statementTimeoutMs: number,
  ) {}

  async list(criteria: ReservationSourceCriteria): Promise<ReservationSourcePage> {
    if (criteria.onlyIds !== null && criteria.onlyIds.length === 0) {
      return { rows: [], hasMore: false };
    }
    return this.guard('ListScheduledReservations', async () => {
      const rows = await this.select(buildReservationListQuery(criteria));
      const mapped = rows.flatMap((row) => {
        const reservation = mapReservationRow(row);
        return reservation ? [reservation] : [];
      });
      return { rows: mapped.slice(0, criteria.limit), hasMore: rows.length > criteria.limit };
    });
  }

  async findById(reservationId: string): Promise<Reservation | null> {
    return this.guard('FindReservation', async () => {
      const [first] = await this.select(buildReservationByIdQuery(reservationId));
      return first ? mapReservationRow(first) : null;
    });
  }

  async clinicExists(clinicId: number): Promise<boolean> {
    return this.guard('ClinicExists', async () => {
      const rows = await this.select({ sql: CLINIC_EXISTS_SQL, bind: [clinicId] });
      return rows.length > 0;
    });
  }

  private select(query: BuiltQuery): Promise<ReservationRow[]> {
    return runInReadOnlySnapshot(
      this.sequelize,
      { statementTimeoutMs: this.statementTimeoutMs },
      (transaction) =>
        this.sequelize.query<ReservationRow>(query.sql, {
          bind: query.bind,
          type: QueryTypes.SELECT,
          transaction,
        }),
    );
  }

  private async guard<T>(operation: string, work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      throw new SourceDataUnavailableException({ operation, cause: error });
    }
  }
}
