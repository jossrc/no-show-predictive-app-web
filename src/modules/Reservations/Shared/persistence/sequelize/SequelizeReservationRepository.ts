import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { SourceDataUnavailableException } from '../../../../../infrastructure/database/errors/SourceDataUnavailableException.js';
import type { PredictiveStoreProbe } from '../../../../../infrastructure/database/sequelize/postgres/PredictiveStoreProbe.js';
import { runInReadOnlySnapshot } from '../../../../../infrastructure/database/sequelize/postgres/RunInReadOnlySnapshot.js';
import type { SnapshotEvidenceSource } from '../../../../../shared/data/DataSourceMode.js';
import type { Reservation } from '../../models/Reservation.js';
import type { ReservationWithScores } from '../../models/ReservationScoreSummary.js';
import type {
  ReservationListCriteria,
  ReservationListPage,
  ReservationRepository,
} from '../ReservationRepository.js';
import { mapReservationRow, type ReservationRow } from './ReservationRowMapper.js';
import {
  buildReservationByIdQuery,
  buildReservationListQuery,
  CLINIC_EXISTS_SQL,
  type BuiltQuery,
} from './ReservationSql.js';

export class SequelizeReservationRepository implements ReservationRepository {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly predictiveStore: PredictiveStoreProbe,
    private readonly statementTimeoutMs: number,
  ) {}

  async list(criteria: ReservationListCriteria): Promise<ReservationListPage> {
    return this.guard('ListScheduledReservations', async () => {
      const predictiveStoreAvailable = await this.predictiveStore.isReady();
      const rows = await this.select(buildReservationListQuery(criteria, predictiveStoreAvailable));
      const mapped = rows.flatMap((row) => {
        const item = mapReservationRow(row);
        return item ? [item] : [];
      });

      return {
        rows: mapped.slice(0, criteria.limit),
        hasMore: rows.length > criteria.limit,
        predictiveStoreAvailable,
      };
    });
  }

  async findById(reservationId: string): Promise<Reservation | null> {
    return this.guard('FindReservation', async () => {
      const rows = await this.select(
        buildReservationByIdQuery(reservationId, { includeScores: false }),
      );
      const first = rows[0];
      return first ? (mapReservationRow(first)?.reservation ?? null) : null;
    });
  }

  async findWithScores(
    reservationId: string,
    snapshotEvidence: SnapshotEvidenceSource,
  ): Promise<ReservationWithScores | null> {
    return this.guard('FindReservationWithScores', async () => {
      const includeScores = await this.predictiveStore.isReady();
      const rows = await this.select(
        buildReservationByIdQuery(reservationId, { includeScores, evidence: snapshotEvidence }),
      );
      const first = rows[0];
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
