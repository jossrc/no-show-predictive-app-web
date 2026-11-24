import type { MlModelKey } from '../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type { ClinicAccessScope } from '../../../../../shared/security/RequestPrincipal.js';

/** Identidad de la gestión: fecha, riesgo, sede y autoría las resuelve el servidor. */
export interface RecordRetentionContactInput {
  readonly reservationId: DecimalId;
  readonly clientId: DecimalId;
  readonly modelKey: MlModelKey;
  readonly predictionRunId: string;
  readonly clinicScope: ClinicAccessScope;
  readonly requestId: string;
}
