import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type { AttendanceOutcome } from '../../../Shared/models/OperationalRecords.js';
import type { AppointmentNotFinishedCode } from '../../../Shared/rules/AppointmentFinished.js';

export type AttendanceRegistrationBlocker =
  AppointmentNotFinishedCode | 'ALREADY_RECORDED' | 'PREDICTION_REQUIRED';

export interface AttendanceRegistration {
  readonly ruleVersion: string;
  /** true ⇒ el FE puede ofrecer el formulario ATTENDED/NO_SHOW. */
  readonly registrable: boolean;
  readonly blocker: AttendanceRegistrationBlocker | null;
  /** Runs con el último score de cada modelo (para enviar en el POST). */
  readonly availablePredictionRunIds: readonly string[];
}

export interface GetAttendanceOutcomeResult {
  readonly reservationId: DecimalId;
  /** null ⇒ aún no registrado (recorded=false), nunca un valor inferido. */
  readonly outcome: AttendanceOutcome | null;
  readonly registration: AttendanceRegistration;
}
