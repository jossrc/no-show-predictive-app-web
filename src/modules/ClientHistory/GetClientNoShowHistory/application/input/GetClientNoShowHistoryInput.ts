import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type { ClinicAccessScope } from '../../../../../shared/security/RequestPrincipal.js';
import type { HistoricalAsOf } from '../../../Shared/models/HistoricalAsOf.js';

export interface GetClientNoShowHistoryInput {
  /** El cliente se resuelve internamente desde la reserva: el consumidor no elige clientId. */
  readonly reservationId: DecimalId;
  readonly historicalAsOf: HistoricalAsOf;
  readonly clinicScope: ClinicAccessScope;
}
