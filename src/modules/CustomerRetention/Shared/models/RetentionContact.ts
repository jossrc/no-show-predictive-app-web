import type { MlModelKey } from '../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';

/**
 * Acción de retención REGISTRADA (no enviada por el sistema) para UNA reserva. Granularidad: la
 * reserva/cita, no el cliente: contactar por una cita no marca sus otras reservas futuras.
 * Autoría honesta: la compuerta x-api-key identifica un servicio interno, no a una persona.
 */
export interface RetentionContact {
  readonly contactId: DecimalId;
  readonly reservationId: DecimalId;
  readonly clientId: DecimalId;
  readonly clinicId: number;
  readonly appointmentAt: Date;
  readonly retentionStatus: 'CAMPAIGN_SENT';
  /** Hora del servidor (Clock), nunca enviada por el cliente HTTP. */
  readonly contactedAt: Date;
  readonly requestId: string;
  readonly actorKind: 'INTERNAL_SERVICE';
  readonly actorUserId: null;
  readonly predictionRunId: string;
  readonly predictionResultId: DecimalId;
  readonly modelKey: MlModelKey;
  readonly modelVersion: string;
  readonly researchPolicyHash: string;
  readonly researchPolicyVersion: string;
  readonly riskBandAtContact: 'HIGH';
  readonly probabilityNoShowAtContact: number;
  readonly scoredAt: Date;
  readonly eligibilityRuleVersion: string;
}

export type NewRetentionContact = Omit<RetentionContact, 'contactId'>;

/** Resumen para el listado (lectura por lote). */
export interface RetentionContactSummary {
  readonly contactId: DecimalId;
  readonly contactedAt: Date;
  readonly modelKey: MlModelKey;
  readonly predictionRunId: string;
}
