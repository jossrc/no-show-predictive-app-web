import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { assessBookingEvidence } from '../../../../../../src/modules/ReservationRisk/Shared/validation/AssessBookingEvidence.js';
import { makeBookingEvidence } from '../../../../../helpers/MakeSyntheticReservation.js';

function codes(evidence: Parameters<typeof makeBookingEvidence>[0]): string[] {
  const result = assessBookingEvidence(makeBookingEvidence(evidence));
  return result.kind === 'NOT_SCORABLE' ? result.reasons.map((reason) => reason.code) : [];
}

describe('AssessBookingEvidence (¿la réplica demuestra la foto al reservar?)', () => {
  it('evidencia completa y anterior a la reserva ⇒ VERIFIED_BOOKING_SNAPSHOT', () => {
    const result = assessBookingEvidence(makeBookingEvidence());
    assert.equal(result.kind, 'VERIFIED');
    assert.equal(
      result.kind === 'VERIFIED' && result.snapshot.evidenceSource,
      'VERIFIED_BOOKING_SNAPSHOT',
    );
  });

  it('réplica sin verificación individual de modificaciones ⇒ NOT_SCORABLE', () => {
    assert.deepEqual(codes({ servicesTemporalEvidence: 'NONE_CURRENT_REPLICA' }), [
      'SCHEDULED_SERVICES_NOT_POINT_IN_TIME',
    ]);
  });

  it('FLOWww sin copias ni eventos ⇒ VERIFIED con procedencia derivada explícita', () => {
    const result = assessBookingEvidence(
      makeBookingEvidence({
        servicesTemporalEvidence: 'FLOWWW_UNCHANGED_BOOKING',
      }),
    );
    assert.equal(result.kind, 'VERIFIED');
    if (result.kind === 'VERIFIED') {
      assert.equal(result.snapshot.servicesTemporalEvidence, 'FLOWWW_UNCHANGED_BOOKING');
      assert.equal(result.snapshot.evidenceSource, 'VERIFIED_BOOKING_SNAPSHOT');
    }
  });

  it('FLOWww con evento contradictorio no acepta la etiqueta de ausencia de cambios', () => {
    assert.deepEqual(
      codes({
        servicesTemporalEvidence: 'FLOWWW_UNCHANGED_BOOKING',
        hasRescheduleEvent: true,
      }),
      ['RESCHEDULED_WITHOUT_ORIGINAL_SNAPSHOT', 'SCHEDULED_SERVICES_NOT_POINT_IN_TIME'],
    );
  });

  it('FLOWww con copias de servicios no usa servicios actuales como originales', () => {
    assert.deepEqual(
      codes({
        servicesTemporalEvidence: 'FLOWWW_UNCHANGED_BOOKING',
        historicalVersions: [
          {
            reservationId: '900000000001099',
            originalReservationId: '900000000001001',
            appointmentAt: new Date('2026-11-12T20:00:00Z'),
            appointmentEndAt: null,
            scheduleChanged: false,
            servicesChanged: true,
            services: [],
          },
        ],
      }),
      ['SCHEDULED_SERVICES_NOT_POINT_IN_TIME'],
    );
  });

  it('DiaryGCreated faltante ⇒ NOT_SCORABLE_MISSING_BOOKING_TIME (sin inventar corte)', () => {
    assert.deepEqual(codes({ bookingCreatedAt: null }), ['MISSING_BOOKING_TIME']);
  });

  it('acumula todos los motivos (reprogramada, cancelada, creación posterior)', () => {
    const result = codes({
      reservationStatus: 'CANCELLED',
      hasRescheduleEvent: true,
      bookingCreatedAt: new Date('2026-11-13T00:00:00Z'),
    });
    assert.deepEqual(result, [
      'RESERVATION_NOT_SCHEDULED',
      'BOOKING_NOT_BEFORE_APPOINTMENT',
      'RESCHEDULED_WITHOUT_ORIGINAL_SNAPSHOT',
    ]);
  });

  it('cliente modificado en/después de la reserva o sin marca ⇒ atributos no verificables', () => {
    const atBooking = makeBookingEvidence().bookingCreatedAt;
    assert.deepEqual(
      codes({ client: { birthDate: '1990-01-01', sex: 'F', lastModifiedAt: atBooking } }),
      ['CLIENT_ATTRIBUTES_NOT_POINT_IN_TIME'],
    );
    assert.deepEqual(
      codes({ client: { birthDate: '1990-01-01', sex: 'F', lastModifiedAt: null } }),
      ['CLIENT_ATTRIBUTES_NOT_POINT_IN_TIME'],
    );
    assert.deepEqual(codes({ client: null }), ['CLIENT_NOT_FOUND']);
  });

  it('producto inexistente o sin resolución de catálogo ⇒ CATALOG_UNRESOLVED', () => {
    const line = makeBookingEvidence().services[0]!;
    assert.deepEqual(codes({ services: [{ ...line, productFound: false }] }), [
      'CATALOG_UNRESOLVED',
    ]);
    assert.deepEqual(codes({ services: [{ ...line, catalogResolved: false }] }), [
      'CATALOG_UNRESOLVED',
    ]);
  });
});
