import type { MlModelKey } from '../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';

/**
 * Registros de GESTIÓN propios de la app (Sprint 02) asociados a una reserva. Son conceptos
 * distintos del estado de la reserva fuente (`reservationStatus`), que nunca se modifica.
 * Un campo null significa «sin registro», no «false».
 */
export interface OverbookingStatusSummary {
  readonly authorizationId: DecimalId;
  readonly enabledAt: Date;
  readonly modelKey: MlModelKey;
  readonly predictionRunId: string;
}

export type AttendanceStatus = 'ATTENDED' | 'NO_SHOW';

export interface AttendanceOutcomeSummary {
  readonly attendanceStatus: AttendanceStatus;
  readonly recordedAt: Date;
  readonly predictionRunId: string;
}

export interface SpaceRecoverySummary {
  readonly authorizationId: DecimalId;
  readonly spaceRecovered: boolean;
  readonly recordedAt: Date;
}

export interface ReservationOperationalStatus {
  /** HU-06: marca «Habilitado para sobreasignación» (null = no habilitado). */
  readonly overbooking: OverbookingStatusSummary | null;
  /** HU-07: asistencia observada (null = aún no registrada). */
  readonly attendanceOutcome: AttendanceOutcomeSummary | null;
  /** HU-08: recuperación del espacio (null = sin registro; false = gestionado sin recuperar). */
  readonly spaceRecoveryOutcome: SpaceRecoverySummary | null;
}

export const NO_OPERATIONAL_RECORDS: ReservationOperationalStatus = {
  overbooking: null,
  attendanceOutcome: null,
  spaceRecoveryOutcome: null,
};
