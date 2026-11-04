import type { MlModelKey } from '../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type { ClinicAccessScope } from '../../../../../shared/security/RequestPrincipal.js';

/** Solo identidad de la predicción elegida: riesgo, sede, fechas y autor los resuelve el servidor. */
export interface EnableOverbookingInput {
  readonly reservationId: DecimalId;
  readonly clinicScope: ClinicAccessScope;
  readonly modelKey: MlModelKey;
  readonly predictionRunId: string;
  readonly requestId: string;
}
