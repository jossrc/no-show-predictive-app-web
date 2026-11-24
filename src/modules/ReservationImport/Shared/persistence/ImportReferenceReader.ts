import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type { ReservationIdLookup } from '../../../Reservations/Shared/persistence/CompositeReservationSource.js';

/** Catálogo vigente del producto (mismo origen que la evidencia de la réplica). */
export interface ProductReference {
  readonly productId: DecimalId;
  readonly productType: number | null;
  readonly isMedicalEvaluation: boolean | null;
  readonly bodyAreaProductId: DecimalId | null;
  /** Existe resolución de catálogo (analytics.product_catalog_resolution). */
  readonly catalogResolved: boolean;
}

/** Atributos predictores del cliente y su última modificación (sin nombres ni contacto). */
export interface ClientReference {
  readonly birthDate: string | null;
  readonly sex: string | null;
  readonly lastModifiedAt: Date | null;
}

/**
 * Lecturas de referencia en la FUENTE del modo activo (réplica de solo lectura o dataset
 * sintético), siempre por lote. Nunca escribe y nunca devuelve datos personales de contacto.
 */
export interface ImportReferenceReader extends ReservationIdLookup {
  existingClientIds(ids: readonly DecimalId[]): Promise<ReadonlySet<DecimalId>>;
  existingClinicIds(ids: readonly number[]): Promise<ReadonlySet<number>>;
  products(ids: readonly DecimalId[]): Promise<ReadonlyMap<DecimalId, ProductReference>>;
  client(clientId: DecimalId): Promise<ClientReference | null>;
  /** Instante hasta el que el historial as-of de la fuente está completo (null = desconocido). */
  historyCoveredUntil(): Promise<Date | null>;
  /** Tablas consultadas por estas lecturas (procedencia de la evidencia). */
  readonly evidenceTables: readonly string[];
}
