import type { MlModelKey } from '../../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type { ClinicAccessScope } from '../../../../../shared/security/RequestPrincipal.js';

export interface GetRiskFactorsInput {
  readonly reservationId: DecimalId;
  readonly modelKey: MlModelKey;
  /** 1..10 (contrato Python). */
  readonly topK: number;
  readonly requestId: string;
  readonly clinicScope: ClinicAccessScope;
}
