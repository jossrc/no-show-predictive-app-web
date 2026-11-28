import { QueryTypes } from 'sequelize';
import type { Sequelize } from 'sequelize-typescript';
import { SourceDataUnavailableException } from '../../../../../infrastructure/database/errors/SourceDataUnavailableException.js';
import { runInReadOnlySnapshot } from '../../../../../infrastructure/database/sequelize/postgres/RunInReadOnlySnapshot.js';
import type { DecimalId } from '../../../../../shared/identifiers/DecimalId.js';
import type {
  ClientReference,
  ImportReferenceReader,
  ProductReference,
} from '../ImportReferenceReader.js';

/**
 * Cualquier fila de agenda con ese DiaryGID (también copias, borradores o bloqueos) colisiona:
 * un identificador de la fuente nunca se reutiliza para una reserva incorporada.
 */
const EXISTING_RESERVATIONS_SQL = `
SELECT d."DiaryGID"::text AS id FROM raw_flow.diary_gen d WHERE d."DiaryGID" = ANY($1::bigint[])
UNION
SELECT o.appointment_id::text AS id FROM analytics.appointment_outcomes o
WHERE o.appointment_id = ANY($1::bigint[])`;

const EXISTING_CLIENTS_SQL = `
SELECT c."ClientID"::text AS id FROM raw_flow.clients c WHERE c."ClientID" = ANY($1::bigint[])`;

const EXISTING_CLINICS_SQL = `
SELECT k."ClinicID" AS id FROM raw_flow.x_config_clinics k WHERE k."ClinicID" = ANY($1::integer[])`;

/** Mismas columnas y resolución que la evidencia de la réplica (SERVICES_SQL). */
const PRODUCTS_SQL = `
SELECT p."ProductID"::text AS product_id,
       p."ProductType" AS product_type,
       p."ProductEvaluation" <> 0 AS is_medical_evaluation,
       r.product_id IS NOT NULL AS catalog_resolved,
       r.body_area_product_id::text AS body_area_product_id
FROM raw_flow.x_config_products_det p
LEFT JOIN analytics.product_catalog_resolution r ON r.product_id = p."ProductID"
WHERE p."ProductID" = ANY($1::bigint[])`;

/** Solo atributos predictores y su marca de modificación: sin nombres ni datos de contacto. */
const CLIENT_SQL = `
SELECT c."ClientBirthDate"::text AS birth_date,
       c."ClientSex" AS sex,
       c."ClientStamp" AT TIME ZONE 'America/Lima' AS last_modified_at
FROM raw_flow.clients c WHERE c."ClientID" = $1::bigint`;

/**
 * Cota inferior de la cobertura del historial as-of: el ETL inserta/actualiza con
 * updated_at = instante de ejecución, de modo que todo evento con known_at anterior a ese
 * instante ya estaba incorporado.
 */
const HISTORY_COVERAGE_SQL = `
SELECT max(h.updated_at) AS covered_until FROM analytics.ml_history_cumulative_v1 h`;

interface ProductRow {
  product_id: string;
  product_type: number | null;
  is_medical_evaluation: boolean | null;
  catalog_resolved: boolean;
  body_area_product_id: string | null;
}

/** Referencias en la réplica raw_flow/analytics: REPEATABLE READ READ ONLY con timeout. */
export class SequelizeImportReferenceReader implements ImportReferenceReader {
  readonly evidenceTables = [
    'ml.app_imported_reservations',
    'raw_flow.clients',
    'raw_flow.x_config_products_det',
    'analytics.product_catalog_resolution',
    'analytics.ml_history_cumulative_v1',
  ] as const;

  constructor(
    private readonly sequelize: Sequelize,
    private readonly statementTimeoutMs: number,
  ) {}

  async existingReservationIds(ids: readonly DecimalId[]): Promise<ReadonlySet<DecimalId>> {
    if (ids.length === 0) return new Set();
    const rows = await this.select<{ id: string }>(
      'ImportExistingReservations',
      EXISTING_RESERVATIONS_SQL,
      [[...ids]],
    );
    return new Set(rows.map((row) => row.id));
  }

  async existingClientIds(ids: readonly DecimalId[]): Promise<ReadonlySet<DecimalId>> {
    if (ids.length === 0) return new Set();
    const rows = await this.select<{ id: string }>('ImportExistingClients', EXISTING_CLIENTS_SQL, [
      [...ids],
    ]);
    return new Set(rows.map((row) => row.id));
  }

  async existingClinicIds(ids: readonly number[]): Promise<ReadonlySet<number>> {
    if (ids.length === 0) return new Set();
    const rows = await this.select<{ id: number }>('ImportExistingClinics', EXISTING_CLINICS_SQL, [
      [...ids],
    ]);
    return new Set(rows.map((row) => Number(row.id)));
  }

  async products(ids: readonly DecimalId[]): Promise<ReadonlyMap<DecimalId, ProductReference>> {
    if (ids.length === 0) return new Map();
    const rows = await this.select<ProductRow>('ImportProducts', PRODUCTS_SQL, [[...ids]]);
    return new Map(
      rows.map((row) => [
        row.product_id,
        {
          productId: row.product_id,
          productType: row.product_type === null ? null : Number(row.product_type),
          isMedicalEvaluation: row.is_medical_evaluation,
          bodyAreaProductId: row.body_area_product_id,
          catalogResolved: row.catalog_resolved === true,
        },
      ]),
    );
  }

  async client(clientId: DecimalId): Promise<ClientReference | null> {
    const [row] = await this.select<{
      birth_date: string | null;
      sex: string | null;
      last_modified_at: Date | null;
    }>('ImportClient', CLIENT_SQL, [clientId]);
    return row
      ? { birthDate: row.birth_date, sex: row.sex, lastModifiedAt: row.last_modified_at }
      : null;
  }

  async historyCoveredUntil(): Promise<Date | null> {
    const [row] = await this.select<{ covered_until: Date | null }>(
      'ImportHistoryCoverage',
      HISTORY_COVERAGE_SQL,
      [],
    );
    return row?.covered_until ?? null;
  }

  private async select<Row extends object>(
    operation: string,
    sql: string,
    bind: unknown[],
  ): Promise<Row[]> {
    try {
      return await runInReadOnlySnapshot(
        this.sequelize,
        { statementTimeoutMs: this.statementTimeoutMs },
        (transaction) =>
          this.sequelize.query<Row>(sql, { bind, type: QueryTypes.SELECT, transaction }),
      );
    } catch (error) {
      throw new SourceDataUnavailableException({ operation, cause: error });
    }
  }
}
