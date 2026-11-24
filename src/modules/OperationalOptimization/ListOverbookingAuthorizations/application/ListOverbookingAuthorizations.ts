import type { ReservationRepository } from '../../../Reservations/Shared/persistence/ReservationRepository.js';
import {
  resolveRecordListQuery,
  toRecordListPage,
} from '../../Shared/pagination/RecordListQuery.js';
import type { OverbookingAuthorizationRepository } from '../../Shared/persistence/OverbookingAuthorizationRepository.js';
import type { ListOverbookingAuthorizationsInput } from './input/ListOverbookingAuthorizationsInput.js';
import type { ListOverbookingAuthorizationsResult } from './result/ListOverbookingAuthorizationsResult.js';

export interface ListOverbookingAuthorizationsDependencies {
  readonly reservations: Pick<ReservationRepository, 'clinicExists'>;
  readonly authorizations: Pick<OverbookingAuthorizationRepository, 'list'>;
}

/** HU-06 (lista): horarios marcados, consultables por período/sede para el Call Center. Lectura pura del almacén de la app. */
export class ListOverbookingAuthorizations {
  constructor(private readonly deps: ListOverbookingAuthorizationsDependencies) {}

  async execute(
    input: ListOverbookingAuthorizationsInput,
  ): Promise<ListOverbookingAuthorizationsResult> {
    const query = await resolveRecordListQuery(
      'overbooking-authorizations',
      input,
      this.deps.reservations,
    );
    return toRecordListPage(query, await this.deps.authorizations.list(query.criteria));
  }
}
