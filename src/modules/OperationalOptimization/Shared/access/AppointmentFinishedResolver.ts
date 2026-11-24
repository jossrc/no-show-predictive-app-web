import type { Clock } from '../../../../shared/time/Clock.js';
import type { Reservation } from '../../../Reservations/Shared/models/Reservation.js';
import type { BookingEvidenceSource } from '../../../ReservationRisk/Shared/persistence/BookingEvidenceSource.js';
import {
  assessAppointmentFinished,
  type AppointmentFinishedAssessment,
} from '../rules/AppointmentFinished.js';

export interface AppointmentFinishedResolution {
  readonly assessment: AppointmentFinishedAssessment;
  /** Fin programado según la fuente (solo se consulta cuando hace falta; null si no se leyó). */
  readonly appointmentEndAt: Date | null;
}

/**
 * Aplica appointment_finished_rule_v1 leyendo el fin programado de la cita desde la fuente de
 * SOLO LECTURA (o el dataset sintético), nunca desde datos del cliente HTTP.
 */
export class AppointmentFinishedResolver {
  constructor(
    private readonly evidence: Pick<BookingEvidenceSource, 'load'>,
    private readonly clock: Clock,
  ) {}

  async resolve(reservation: Reservation): Promise<AppointmentFinishedResolution> {
    let appointmentEndAt: Date | null = null;
    const assessment = await assessAppointmentFinished(reservation, this.clock.now(), async () => {
      appointmentEndAt =
        (await this.evidence.load(reservation.reservationId))?.appointmentEndAt ?? null;
      return appointmentEndAt;
    });
    return { assessment, appointmentEndAt };
  }
}
