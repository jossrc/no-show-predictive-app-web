import type { ReservationRepository } from '../../../Reservations/Shared/persistence/ReservationRepository.js';
import {
  resolveRecordListQuery,
  toRecordListPage,
} from '../../Shared/pagination/RecordListQuery.js';
import type { SpaceRecoveryOutcomeRepository } from '../../Shared/persistence/SpaceRecoveryOutcomeRepository.js';
import type { ListSpaceRecoveryOutcomesInput } from './input/ListSpaceRecoveryOutcomesInput.js';
import type { ListSpaceRecoveryOutcomesResult } from './result/ListSpaceRecoveryOutcomesResult.js';

export interface ListSpaceRecoveryOutcomesDependencies {
  readonly reservations: Pick<ReservationRepository, 'clinicExists'>;
  readonly recoveries: Pick<SpaceRecoveryOutcomeRepository, 'list'>;
}

/** HU-08 (lista): resultados de recuperación disponibles para el reporte futuro HU-13. Lectura pura del almacén de la app. */
export class ListSpaceRecoveryOutcomes {
  constructor(private readonly deps: ListSpaceRecoveryOutcomesDependencies) {}

  async execute(input: ListSpaceRecoveryOutcomesInput): Promise<ListSpaceRecoveryOutcomesResult> {
    const query = await resolveRecordListQuery(
      'space-recovery-outcomes',
      input,
      this.deps.reservations,
    );
    return toRecordListPage(query, await this.deps.recoveries.list(query.criteria));
  }
}
