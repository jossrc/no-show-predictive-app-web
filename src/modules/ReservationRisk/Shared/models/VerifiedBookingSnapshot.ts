import type { SnapshotEvidenceSource } from '../../../../shared/data/DataSourceMode.js';
import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';

export interface ScheduledServiceLine {
  readonly sourceDetailId: DecimalId;
  readonly productId: DecimalId | null;
  /** ProductType del catálogo; null si el producto no se resolvió. */
  readonly productType: number | null;
  /** Área corporal resuelta (analytics.product_catalog_resolution); null si no aplica. */
  readonly bodyAreaProductId: DecimalId | null;
  readonly isMedicalEvaluation: boolean | null;
}

/**
 * Foto lógica de la reserva en `predictionAt` (= DiaryGCreated) con evidencia temporal.
 * Es la ÚNICA entrada válida de RiskFeaturesBuilder junto con el historial as-of.
 */
export interface VerifiedBookingSnapshot {
  readonly reservationId: DecimalId;
  readonly clientId: DecimalId;
  readonly clinicId: number;
  readonly predictionAt: Date;
  readonly appointmentAt: Date;
  readonly appointmentEndAt: Date | null;
  /** DiaryGFWA crudo (-1/0 en la fuente); null si se desconoce. */
  readonly fwaFlag: number | null;
  /** `YYYY-MM-DD` según la fuente; null si se desconoce. */
  readonly clientBirthDate: string | null;
  /** Valor crudo; solo M/F/X se transmiten. */
  readonly clientSex: string | null;
  readonly scheduledServices: readonly ScheduledServiceLine[];
  readonly evidenceSource: SnapshotEvidenceSource;
}
