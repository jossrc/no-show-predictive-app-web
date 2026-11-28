import {
  SYNTHETIC_DEMO_CLASSIFICATION_CUTOFF,
  SYNTHETIC_DEMO_CLIENT_STAMP,
  SYNTHETIC_DEMO_CLINICS,
  SYNTHETIC_DEMO_DATASET_VERSION,
  SYNTHETIC_DEMO_PRODUCT,
  SYNTHETIC_DEMO_RESERVATIONS,
  type SyntheticReservationFixture,
} from '../../../../../shared/data/synthetic/SyntheticDemoDataset.js';
import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type {
  ClientReference,
  ImportReferenceReader,
  ProductReference,
} from '../ImportReferenceReader.js';

/**
 * Referencias SYNTHETIC_DEMO_ONLY desde el dataset versionado (sin PostgreSQL fuente). El
 * historial sintético es completo hasta su corte de clasificación: una reserva incorporada
 * creada después se evalúa con HISTORY_COVERAGE_INCOMPLETE, igual que en el modo real.
 */
export class SyntheticImportReferenceReader implements ImportReferenceReader {
  readonly evidenceTables = ['ml.app_imported_reservations', SYNTHETIC_DEMO_DATASET_VERSION];

  constructor(
    private readonly fixtures: readonly SyntheticReservationFixture[] = SYNTHETIC_DEMO_RESERVATIONS,
  ) {}

  async existingReservationIds(ids: readonly DecimalId[]): Promise<ReadonlySet<DecimalId>> {
    const known = new Set(this.fixtures.map((fixture) => fixture.reservationId));
    return new Set(ids.filter((id) => known.has(id)));
  }

  async existingClientIds(ids: readonly DecimalId[]): Promise<ReadonlySet<DecimalId>> {
    const known = new Set(this.fixtures.map((fixture) => fixture.clientId));
    return new Set(ids.filter((id) => known.has(id)));
  }

  async existingClinicIds(ids: readonly number[]): Promise<ReadonlySet<number>> {
    return new Set(ids.filter((id) => SYNTHETIC_DEMO_CLINICS.includes(id)));
  }

  async products(ids: readonly DecimalId[]): Promise<ReadonlyMap<DecimalId, ProductReference>> {
    return new Map(
      ids
        .filter((id) => id === SYNTHETIC_DEMO_PRODUCT.productId)
        .map((id) => [id, { ...SYNTHETIC_DEMO_PRODUCT, catalogResolved: true }]),
    );
  }

  async client(clientId: DecimalId): Promise<ClientReference | null> {
    const fixture = this.fixtures.find((candidate) => candidate.clientId === clientId);
    return fixture
      ? { ...fixture.client, lastModifiedAt: new Date(SYNTHETIC_DEMO_CLIENT_STAMP) }
      : null;
  }

  async historyCoveredUntil(): Promise<Date | null> {
    return new Date(SYNTHETIC_DEMO_CLASSIFICATION_CUTOFF);
  }
}
