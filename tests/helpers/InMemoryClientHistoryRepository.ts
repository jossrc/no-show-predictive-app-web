import type { ClientHistoryAsOfSummary } from '../../src/modules/ClientHistory/Shared/models/ClientHistoryAsOfSummary.js';
import type { ClientHistoryRepository } from '../../src/modules/ClientHistory/Shared/persistence/ClientHistoryRepository.js';

export interface SyntheticHistoryEvent {
  readonly clientId: string;
  readonly appointmentId: string;
  readonly knownAt: Date;
  /** 0 = asistencia completada, 1 = no-show candidato (cancelaciones no existen aquí). */
  readonly kind: 0 | 1;
}

/** Misma semántica que SequelizeClientHistoryRepository: solo known_at < corte, por cliente. */
export class InMemoryClientHistoryRepository implements ClientHistoryRepository {
  readonly events: SyntheticHistoryEvent[] = [];
  readonly cutoffsRequested: Date[] = [];

  add(...events: SyntheticHistoryEvent[]): void {
    this.events.push(...events);
  }

  async summarizeAsOf(clientId: string, cutoffExclusive: Date): Promise<ClientHistoryAsOfSummary> {
    this.cutoffsRequested.push(cutoffExclusive);
    const known = this.events.filter(
      (e) => e.clientId === clientId && e.knownAt.getTime() < cutoffExclusive.getTime(),
    );
    const latest = (kind?: 0 | 1) =>
      known
        .filter((e) => kind === undefined || e.kind === kind)
        .reduce<Date | null>((max, e) => (max === null || e.knownAt > max ? e.knownAt : max), null);

    return {
      clientId,
      cutoffAt: cutoffExclusive,
      previousAttended: known.filter((e) => e.kind === 0).length,
      previousNoShow: known.filter((e) => e.kind === 1).length,
      lastAttendedAt: latest(0),
      lastNoShowAt: latest(1),
      latestKnownAt: latest(),
    };
  }
}
