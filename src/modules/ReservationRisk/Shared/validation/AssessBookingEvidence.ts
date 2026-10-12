import type {
  BookingEvidence,
  EvidenceServiceLine,
  ReconstructedOriginalBooking,
} from '../models/BookingEvidence.js';
import {
  notScorableReason,
  type NotScorableReason,
  type NotScorableReasonCode,
} from '../models/NotScorableReason.js';
import type { VerifiedBookingSnapshot } from '../models/VerifiedBookingSnapshot.js';

export type BookingEvidenceAssessment =
  | { readonly kind: 'VERIFIED'; readonly snapshot: VerifiedBookingSnapshot }
  | { readonly kind: 'NOT_SCORABLE'; readonly reasons: readonly NotScorableReason[] };

/** Un dato modificado en o después de la reserva no prueba su valor al reservar. */
function modifiedBeforeBooking(lastModifiedAt: Date | null, predictionAt: Date): boolean {
  return lastModifiedAt !== null && lastModifiedAt.getTime() < predictionAt.getTime();
}

export function reconstructedOriginalBooking(
  evidence: BookingEvidence,
): ReconstructedOriginalBooking | null {
  return evidence.servicesTemporalEvidence === 'FLOWWW_RECONSTRUCTED_BOOKING'
    ? evidence.reconstructedOriginal
    : null;
}

/** Horario y servicios de la foto de reserva: originales reconstruidos, nunca el slot vigente. */
export function scoringSchedule(evidence: BookingEvidence): {
  readonly appointmentAt: Date;
  readonly appointmentEndAt: Date | null;
  readonly services: readonly EvidenceServiceLine[];
} {
  const original = reconstructedOriginalBooking(evidence);
  if (original !== null) {
    return {
      appointmentAt: original.appointmentAt,
      appointmentEndAt: original.appointmentEndAt,
      services: original.services,
    };
  }
  return {
    appointmentAt: evidence.appointmentAt,
    appointmentEndAt: evidence.appointmentEndAt,
    services: evidence.services,
  };
}

/**
 * Decide si la réplica actual demuestra la foto de la reserva en `prediction_at`.
 * Acumula TODOS los motivos (no solo el primero) para documentar el bloqueo. Nunca rellena
 * huecos: si falta evidencia, la reserva es NOT_SCORABLE.
 */
export function assessBookingEvidence(evidence: BookingEvidence): BookingEvidenceAssessment {
  const codes = new Set<NotScorableReasonCode>();
  const predictionAt = evidence.bookingCreatedAt;
  const original = reconstructedOriginalBooking(evidence);
  const schedule = scoringSchedule(evidence);

  if (evidence.reservationStatus !== 'SCHEDULED') codes.add('RESERVATION_NOT_SCHEDULED');
  if (predictionAt === null) codes.add('MISSING_BOOKING_TIME');
  if (predictionAt !== null && predictionAt.getTime() >= schedule.appointmentAt.getTime()) {
    codes.add('BOOKING_NOT_BEFORE_APPOINTMENT');
  }
  const rescheduled =
    evidence.hasRescheduleEvent || evidence.historicalVersions.some((v) => v.scheduleChanged);
  if (rescheduled && original === null) {
    codes.add('RESCHEDULED_WITHOUT_ORIGINAL_SNAPSHOT');
  }
  const unchangedBooking =
    evidence.servicesTemporalEvidence === 'FLOWWW_UNCHANGED_BOOKING' &&
    evidence.historicalVersions.length === 0 &&
    !evidence.hasRescheduleEvent;
  if (
    evidence.servicesTemporalEvidence !== 'CAPTURED_AT_BOOKING' &&
    !unchangedBooking &&
    original === null
  ) {
    codes.add('SCHEDULED_SERVICES_NOT_POINT_IN_TIME');
  }

  if (evidence.client === null) {
    codes.add('CLIENT_NOT_FOUND');
  } else if (
    predictionAt !== null &&
    !modifiedBeforeBooking(evidence.client.lastModifiedAt, predictionAt)
  ) {
    codes.add('CLIENT_ATTRIBUTES_NOT_POINT_IN_TIME');
  }

  const catalogUnresolved = schedule.services.some(
    (line) => !line.productFound || !line.catalogResolved,
  );
  if (catalogUnresolved) {
    codes.add('CATALOG_UNRESOLVED');
  }

  if (codes.size > 0 || predictionAt === null || evidence.client === null) {
    return { kind: 'NOT_SCORABLE', reasons: [...codes].map(notScorableReason) };
  }

  return {
    kind: 'VERIFIED',
    snapshot: {
      reservationId: evidence.reservationId,
      clientId: evidence.clientId,
      clinicId: evidence.clinicId,
      predictionAt,
      appointmentAt: schedule.appointmentAt,
      appointmentEndAt: schedule.appointmentEndAt,
      fwaFlag: evidence.fwaFlag,
      clientBirthDate: evidence.client.birthDate,
      clientSex: evidence.client.sex,
      scheduledServices: schedule.services.map((line) => ({
        sourceDetailId: line.sourceDetailId,
        productId: line.productId,
        productType: line.productType,
        bodyAreaProductId: line.bodyAreaProductId,
        isMedicalEvaluation: line.isMedicalEvaluation,
      })),
      evidenceSource: evidence.evidenceSource,
      servicesTemporalEvidence: evidence.servicesTemporalEvidence,
    },
  };
}
