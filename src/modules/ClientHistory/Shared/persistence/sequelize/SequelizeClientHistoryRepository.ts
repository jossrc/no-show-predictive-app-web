import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { SourceDataUnavailableException } from '../../../../../infrastructure/database/errors/SourceDataUnavailableException.js';
import { runInReadOnlySnapshot } from '../../../../../infrastructure/database/sequelize/postgres/RunInReadOnlySnapshot.js';
import {
  emptyClientHistory,
  type ClientHistoryAsOfSummary,
} from '../../models/ClientHistoryAsOfSummary.js';
import type { ClientHistoryRepository } from '../ClientHistoryRepository.js';

/**
 * Último registro acumulado anterior al corte (ORDER BY known_at DESC, appointment_id DESC
 * LIMIT 1) sobre idx_ml_history_client_known_at: una sola búsqueda indexada, sin traer eventos
 * a Node. Equivale a la LATERAL del ETL 14 (paridad con el entrenamiento).
 * Nunca usa analytics.client_history_current (agregado posterior, no apto as-of).
 */
const HISTORY_AS_OF_SQL = `
SELECT h.prior_including_event_attended AS previous_attended,
       h.prior_including_event_no_show AS previous_no_show,
       h.last_attended_at AS last_attended_at,
       h.last_no_show_at AS last_no_show_at,
       h.known_at AS latest_known_at
FROM analytics.ml_history_cumulative_v1 h
WHERE h.client_id = $1::bigint
  AND h.known_at < $2::timestamptz
ORDER BY h.known_at DESC, h.appointment_id DESC
LIMIT 1`;

interface HistoryRow {
  previous_attended: number;
  previous_no_show: number;
  last_attended_at: Date | null;
  last_no_show_at: Date | null;
  latest_known_at: Date;
}

export class SequelizeClientHistoryRepository implements ClientHistoryRepository {
  constructor(
    private readonly sequelize: Sequelize,
    private readonly statementTimeoutMs: number,
  ) {}

  async summarizeAsOf(clientId: string, cutoffExclusive: Date): Promise<ClientHistoryAsOfSummary> {
    let rows: HistoryRow[];
    try {
      rows = await runInReadOnlySnapshot(
        this.sequelize,
        { statementTimeoutMs: this.statementTimeoutMs },
        (transaction) =>
          this.sequelize.query<HistoryRow>(HISTORY_AS_OF_SQL, {
            bind: [clientId, cutoffExclusive],
            type: QueryTypes.SELECT,
            transaction,
          }),
      );
    } catch (error) {
      throw new SourceDataUnavailableException({
        operation: 'SummarizeClientHistory',
        cause: error,
      });
    }

    const row = rows[0];
    if (!row) return emptyClientHistory(clientId, cutoffExclusive);

    return {
      clientId,
      cutoffAt: cutoffExclusive,
      previousAttended: Number(row.previous_attended),
      previousNoShow: Number(row.previous_no_show),
      lastAttendedAt: row.last_attended_at,
      lastNoShowAt: row.last_no_show_at,
      latestKnownAt: row.latest_known_at,
    };
  }
}
