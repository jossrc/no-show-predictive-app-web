import type { MlModelKey } from '../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type { ClinicAccessScope } from '../../../../../shared/security/RequestPrincipal.js';

export type RequestedPrediction =
  { readonly mode: 'compare' } | { readonly mode: 'single'; readonly modelKey: MlModelKey };

export interface RequestReservationPredictionInput {
  readonly reservationId: DecimalId;
  readonly prediction: RequestedPrediction;
  /** Correlación opaca hacia Python; nunca IDs de cliente/reserva. */
  readonly requestId: string;
  readonly clinicScope: ClinicAccessScope;
}
