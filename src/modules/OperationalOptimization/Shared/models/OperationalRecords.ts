import type { MlModelKey } from '../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type { ExperimentalRiskLevel } from '../../../Reservations/Shared/models/ReservationScoreSummary.js';
import type { AttendanceStatus } from '../../../Reservations/Shared/models/ReservationOperationalStatus.js';

export type { AttendanceStatus } from '../../../Reservations/Shared/models/ReservationOperationalStatus.js';

/**
 * Autoría honesta mientras no exista login (HU-21/HU-22): la compuerta x-api-key identifica un
 * servicio interno, no a la persona (supervisor/recepción). Nunca se aceptan nombres del cliente.
 */
export interface RecordAuthorship {
  readonly requestId: string;
  readonly actorKind: 'INTERNAL_SERVICE';
  readonly actorUserId: null;
}

/** Datos de la reserva FUENTE copiados al registrar (para listados sin reconsultar la réplica). */
export interface ReservationSlot {
  readonly reservationId: DecimalId;
  readonly clinicId: number;
  readonly appointmentAt: Date;
}

/** HU-06: marca manual «Habilitado para sobreasignación» justificada por UNA predicción HIGH. */
export interface OverbookingAuthorization extends ReservationSlot, RecordAuthorship {
  readonly authorizationId: DecimalId;
  readonly status: 'ENABLED';
  readonly enabledAt: Date;
  readonly predictionRunId: string;
  readonly predictionResultId: DecimalId;
  readonly modelKey: MlModelKey;
  readonly modelVersion: string;
  readonly researchPolicyHash: string;
  readonly researchPolicyVersion: string;
  readonly riskBandAtAuthorization: 'HIGH';
  readonly probabilityNoShowAtAuthorization: number;
  readonly scoredAt: Date;
  readonly eligibilityRuleVersion: string;
}

export type NewOverbookingAuthorization = Omit<OverbookingAuthorization, 'authorizationId'>;

/** HU-07: contraste descriptivo de UN modelo del run con la asistencia observada. */
export interface AttendanceComparison {
  readonly predictionResultId: DecimalId;
  readonly modelKey: MlModelKey;
  readonly modelVersion: string;
  readonly probabilityNoShow: number;
  readonly scoredAt: Date;
  readonly experimentalRiskLevel: ExperimentalRiskLevel | null;
  readonly researchPolicyHash: string | null;
  readonly comparisonRuleVersion: string;
  readonly threshold: number;
  readonly predictedNoShow: boolean;
  readonly observedNoShow: boolean;
  readonly matchesPrediction: boolean;
}

/** HU-07: asistencia REAL registrada explícitamente (no inferida del score ni de la banda). */
export interface AttendanceOutcome extends ReservationSlot, RecordAuthorship {
  readonly attendanceOutcomeId: DecimalId;
  readonly appointmentEndAt: Date | null;
  /** Estado de la reserva fuente con el que se acreditó que la cita terminó. */
  readonly sourceReservationStatus: 'SCHEDULED' | 'PAST';
  readonly attendanceStatus: AttendanceStatus;
  readonly observedNoShow: boolean;
  readonly recordedAt: Date;
  readonly predictionRunId: string;
  readonly finishedRuleVersion: string;
  readonly comparisons: readonly AttendanceComparison[];
}

export type NewAttendanceOutcome = Omit<AttendanceOutcome, 'attendanceOutcomeId'>;

/** HU-08: resultado operativo explícito de la gestión preventiva HU-06 (true/false). */
export interface SpaceRecoveryOutcome extends ReservationSlot, RecordAuthorship {
  readonly recoveryOutcomeId: DecimalId;
  readonly authorizationId: DecimalId;
  readonly spaceRecovered: boolean;
  readonly recordedAt: Date;
}

export type NewSpaceRecoveryOutcome = Omit<SpaceRecoveryOutcome, 'recoveryOutcomeId'>;
