import type { ReservationRepository } from '../../../Reservations/Shared/persistence/ReservationRepository.js';
import {
  resolveRecordListQuery,
  toRecordListPage,
} from '../../Shared/pagination/RecordListQuery.js';
import type { AttendanceOutcomeRepository } from '../../Shared/persistence/AttendanceOutcomeRepository.js';
import type { ListAttendanceOutcomesInput } from './input/ListAttendanceOutcomesInput.js';
import type { ListAttendanceOutcomesResult } from './result/ListAttendanceOutcomesResult.js';

export interface ListAttendanceOutcomesDependencies {
  readonly reservations: Pick<ReservationRepository, 'clinicExists'>;
  readonly outcomes: Pick<AttendanceOutcomeRepository, 'list'>;
}

/** HU-07 (lista): observaciones y comparaciones persistidas, disponibles para HU-12. Lectura pura del almacén de la app. */
export class ListAttendanceOutcomes {
  constructor(private readonly deps: ListAttendanceOutcomesDependencies) {}

  async execute(input: ListAttendanceOutcomesInput): Promise<ListAttendanceOutcomesResult> {
    const query = await resolveRecordListQuery(
      'attendance-outcomes',
      input,
      this.deps.reservations,
    );
    return toRecordListPage(query, await this.deps.outcomes.list(query.criteria));
  }
}
