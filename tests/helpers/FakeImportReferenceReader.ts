import type {
  ClientReference,
  ImportReferenceReader,
  ProductReference,
} from '../../src/modules/ReservationImport/Shared/persistence/ImportReferenceReader.js';

/** Fuente de referencia sintética y configurable (clientes, sedes, catálogo, cobertura). */
export class FakeImportReferenceReader implements ImportReferenceReader {
  readonly evidenceTables = ['ml.app_imported_reservations', 'synthetic_test_references'];
  readonly sourceReservationIds = new Set<string>();
  readonly clinics = new Set<number>([1, 2]);
  readonly clients = new Map<string, ClientReference>();
  readonly catalog = new Map<string, ProductReference>([
    [
      '900101',
      {
        productId: '900101',
        productType: 1,
        isMedicalEvaluation: false,
        bodyAreaProductId: '101',
        catalogResolved: true,
      },
    ],
  ]);
  coveredUntil: Date | null = new Date('2026-11-09T00:00:00.000Z');
  lookups = 0;

  addClient(clientId: string, overrides: Partial<ClientReference> = {}): void {
    this.clients.set(clientId, {
      birthDate: '1990-05-10',
      sex: 'F',
      lastModifiedAt: new Date('2026-01-01T00:00:00.000Z'),
      ...overrides,
    });
  }

  async existingReservationIds(ids: readonly string[]): Promise<ReadonlySet<string>> {
    this.lookups += 1;
    return new Set(ids.filter((id) => this.sourceReservationIds.has(id)));
  }

  async existingClientIds(ids: readonly string[]): Promise<ReadonlySet<string>> {
    return new Set(ids.filter((id) => this.clients.has(id)));
  }

  async existingClinicIds(ids: readonly number[]): Promise<ReadonlySet<number>> {
    return new Set(ids.filter((id) => this.clinics.has(id)));
  }

  async products(ids: readonly string[]): Promise<ReadonlyMap<string, ProductReference>> {
    return new Map(
      ids.flatMap((id) => (this.catalog.has(id) ? [[id, this.catalog.get(id)!]] : [])),
    );
  }

  async client(clientId: string): Promise<ClientReference | null> {
    return this.clients.get(clientId) ?? null;
  }

  async historyCoveredUntil(): Promise<Date | null> {
    return this.coveredUntil;
  }
}
