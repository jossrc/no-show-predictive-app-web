import type { BookingEvidence } from '../models/BookingEvidence.js';
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

/**
 * Decide si la réplica actual demuestra la foto de la reserva en `prediction_at`.
 * Acumula TODOS los motivos (no solo el primero) para documentar el bloqueo. Nunca rellena
 * huecos: si falta evidencia, la reserva es NOT_SCORABLE.
 */
export function assessBookingEvidence(evidence: BookingEvidence): BookingEvidenceAssessment {
  const codes = new Set<NotScorableReasonCode>();
  const predictionAt = evidence.bookingCreatedAt;

  if (evidence.reservationStatus !== 'SCHEDULED') codes.add('RESERVATION_NOT_SCHEDULED');
  if (predictionAt === null) codes.add('MISSING_BOOKING_TIME');
  if (predictionAt !== null && predictionAt.getTime() >= evidence.appointmentAt.getTime()) {
    codes.add('BOOKING_NOT_BEFORE_APPOINTMENT');
  }
  if (evidence.hasRescheduleEvent) codes.add('RESCHEDULED_WITHOUT_ORIGINAL_SNAPSHOT');
  if (evidence.servicesTemporalEvidence !== 'CAPTURED_AT_BOOKING') {
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

  if (predictionAt !== null) {
    const catalogVerifiable = evidence.services.every(
      (line) =>
        line.productFound &&
        line.catalogResolved &&
        line.catalogLastModifiedAt.every((stamp) => modifiedBeforeBooking(stamp, predictionAt)),
    );
    if (!catalogVerifiable) codes.add('CATALOG_NOT_POINT_IN_TIME');
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
      appointmentAt: evidence.appointmentAt,
      appointmentEndAt: evidence.appointmentEndAt,
      fwaFlag: evidence.fwaFlag,
      clientBirthDate: evidence.client.birthDate,
      clientSex: evidence.client.sex,
      scheduledServices: evidence.services.map((line) => ({
        sourceDetailId: line.sourceDetailId,
        productId: line.productId,
        productType: line.productType,
        bodyAreaProductId: line.bodyAreaProductId,
        isMedicalEvaluation: line.isMedicalEvaluation,
      })),
      evidenceSource: evidence.evidenceSource,
    },
  };
}
