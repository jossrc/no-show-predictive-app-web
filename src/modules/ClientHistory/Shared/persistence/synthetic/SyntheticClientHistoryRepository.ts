import {
  SYNTHETIC_DEMO_RESERVATIONS,
  type SyntheticReservationFixture,
} from '../../../../../shared/data/synthetic/SyntheticDemoDataset.js';
import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type { ClientHistoryAsOfSummary } from '../../models/ClientHistoryAsOfSummary.js';
import type { ClientHistoryRepository } from '../ClientHistoryRepository.js';

/**
 * Historial as-of SYNTHETIC_DEMO_ONLY con la misma semántica que el SQL real: solo eventos del
 * cliente con `known_at < corte` (exclusivo); las cancelaciones no son eventos.
 */
export class SyntheticClientHistoryRepository implements ClientHistoryRepository {
  constructor(
    private readonly fixtures: readonly SyntheticReservationFixture[] = SYNTHETIC_DEMO_RESERVATIONS,
  ) {}

  async summarizeAsOf(
    clientId: DecimalId,
    cutoffExclusive: Date,
  ): Promise<ClientHistoryAsOfSummary> {
    const known = this.fixtures
      .filter((fixture) => fixture.clientId === clientId)
      .flatMap((fixture) => fixture.history)
      .map((event) => ({ knownAt: new Date(event.knownAt), kind: event.kind }))
      .filter((event) => event.knownAt.getTime() < cutoffExclusive.getTime());
    const latest = (kind?: 0 | 1): Date | null =>
      known
        .filter((event) => kind === undefined || event.kind === kind)
        .reduce<Date | null>(
          (max, event) => (max === null || event.knownAt > max ? event.knownAt : max),
          null,
        );

    return {
      clientId,
      cutoffAt: cutoffExclusive,
      previousAttended: known.filter((event) => event.kind === 0).length,
      previousNoShow: known.filter((event) => event.kind === 1).length,
      lastAttendedAt: latest(0),
      lastNoShowAt: latest(1),
      latestKnownAt: latest(),
    };
  }
}
