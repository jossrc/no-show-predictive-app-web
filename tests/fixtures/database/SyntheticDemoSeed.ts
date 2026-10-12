import type { Sequelize } from 'sequelize-typescript';
import { SequelizeClientHistoryRepository } from '../../../src/modules/ClientHistory/Shared/persistence/sequelize/SequelizeClientHistoryRepository.js';
import { RiskFeaturesBuilder } from '../../../src/modules/ReservationRisk/Shared/calculation/RiskFeaturesBuilder.js';
import { computeSnapshotHash } from '../../../src/modules/ReservationRisk/Shared/calculation/SnapshotHash.js';
import type { BookingFeatureSnapshot } from '../../../src/modules/ReservationRisk/Shared/models/BookingFeatureSnapshot.js';
import { SequelizeBookingEvidenceSource } from '../../../src/modules/ReservationRisk/Shared/persistence/sequelize/SequelizeBookingEvidenceSource.js';
import type { BookingSnapshotRepository } from '../../../src/modules/ReservationRisk/Shared/persistence/BookingSnapshotRepository.js';
import { SequelizeBookingSnapshotRepository } from '../../../src/modules/ReservationRisk/Shared/persistence/sequelize/SequelizeBookingSnapshotRepository.js';

/**
 * Captura snapshots SYNTHETIC_DEMO_ONLY a partir de la réplica SINTÉTICA de la BD de prueba,
 * usando el builder y el historial as-of reales, en el almacén indicado (SQLite local en las
 * pruebas; el adaptador PostgreSQL `ml` de la BD de prueba en el script de demo heredado). Representa lo que haría una captura en el
 * instante de reserva; nunca se ejecuta contra datos comerciales (TestDatabase lo impide).
 */
export async function captureSyntheticSnapshots(
  sequelize: Sequelize,
  reservationIds: readonly string[],
  snapshots: BookingSnapshotRepository = new SequelizeBookingSnapshotRepository(sequelize),
): Promise<BookingFeatureSnapshot[]> {
  const evidenceSource = new SequelizeBookingEvidenceSource(sequelize, 5000);
  const history = new SequelizeClientHistoryRepository(sequelize, 5000);
  const builder = new RiskFeaturesBuilder();
  const captured: BookingFeatureSnapshot[] = [];

  for (const reservationId of reservationIds) {
    const evidence = await evidenceSource.load(reservationId);
    if (!evidence?.bookingCreatedAt || !evidence.client)
      throw new Error(`Fixture ${reservationId} incompleta`);

    const predictionAt = evidence.bookingCreatedAt;
    const built = builder.build(
      {
        reservationId,
        clientId: evidence.clientId,
        clinicId: evidence.clinicId,
        predictionAt,
        appointmentAt: evidence.appointmentAt,
        appointmentEndAt: evidence.appointmentEndAt,
        fwaFlag: evidence.fwaFlag,
        clientBirthDate: evidence.client.birthDate,
        clientSex: evidence.client.sex,
        scheduledServices: evidence.services,
        evidenceSource: 'SYNTHETIC_DEMO_ONLY',
      },
      await history.summarizeAsOf(evidence.clientId, predictionAt),
    );
    if (built.kind !== 'BUILT') throw new Error(`Fixture ${reservationId} no evaluable`);

    captured.push(
      await snapshots.saveIfAbsent({
        reservationId,
        clientId: evidence.clientId,
        snapshotType: 'booking_creation',
        predictionAt,
        appointmentAt: evidence.appointmentAt,
        featureVersion: built.value.featureVersion,
        builderVersion: built.value.featureContext.builder_version,
        snapshotHash: computeSnapshotHash({
          reservationId,
          predictionAt,
          featureVersion: built.value.featureVersion,
          builderVersion: built.value.featureContext.builder_version,
          features: built.value.features,
        }),
        features: built.value.features,
        evidenceSource: 'SYNTHETIC_DEMO_ONLY',
        evidence: { capture: 'SYNTHETIC_DEMO_ONLY_FIXTURE' },
        sourceIngestionBatchId: null,
      }),
    );
  }
  return captured;
}
