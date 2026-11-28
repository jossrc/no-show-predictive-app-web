import { createHash } from 'node:crypto';
import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import { canAccessClinic } from '../../../../shared/security/RequestPrincipal.js';
import type { Clock } from '../../../../shared/time/Clock.js';
import {
  IMPORT_COLUMNS,
  RESERVATION_IMPORT_CONTRACT_VERSION,
  type RowRejectionCode,
} from '../../Shared/contract/ReservationImportContract.js';
import type {
  ImportBatch,
  ImportBatchStatus,
  ImportedReservationDraft,
  RowRejection,
  RowRejectionError,
} from '../../Shared/models/ImportedReservation.js';
import type { ImportFileLimits, ImportTable } from '../../Shared/parsing/ImportTable.js';
import { readImportTable } from '../../Shared/parsing/ReadImportTable.js';
import type { ImportReferenceReader } from '../../Shared/persistence/ImportReferenceReader.js';
import type { ImportedReservationRepository } from '../../Shared/persistence/ImportedReservationRepository.js';
import { normalizeImportRows } from '../../Shared/validation/NormalizeImportRows.js';
import type { ImportReservationsInput } from './input/ImportReservationsInput.js';
import type { ImportReservationsResult } from './result/ImportReservationsResult.js';

export interface ImportReservationsDependencies {
  readonly references: ImportReferenceReader;
  readonly imported: ImportedReservationRepository;
  readonly limits: ImportFileLimits;
  readonly clock: Clock;
  readonly newBatchId: () => string;
}

interface ReferenceFacts {
  readonly inSource: ReadonlySet<DecimalId>;
  readonly clients: ReadonlySet<DecimalId>;
  readonly clinics: ReadonlySet<number>;
  readonly products: ReadonlySet<DecimalId>;
  readonly importedHashes: ReadonlyMap<DecimalId, string>;
}

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function statusOf(accepted: number, rejected: number): ImportBatchStatus {
  if (rejected === 0) return 'COMPLETED';
  return accepted === 0 ? 'NO_ROWS_ACCEPTED' : 'COMPLETED_WITH_REJECTIONS';
}

function alreadyImported(draft: ImportedReservationDraft, existingHash: string): RowRejectionCode {
  return existingHash === draft.rowHash
    ? 'ALREADY_IMPORTED'
    : 'ALREADY_IMPORTED_WITH_DIFFERENT_DATA';
}

/**
 * Incorporación masiva de reservas desde CSV/XLSX: valida el archivo y cada fila, contrasta las
 * referencias con la fuente del modo activo (solo lectura, por lote) y persiste en ml.app_* las
 * filas válidas en UNA transacción, con trazabilidad del lote. No escribe en raw_flow/analytics,
 * no genera predicciones y no fabrica datos: una fila sin información indispensable se rechaza.
 */
export class ImportReservations {
  constructor(private readonly deps: ImportReservationsDependencies) {}

  async execute(input: ImportReservationsInput): Promise<ImportReservationsResult> {
    const table = readImportTable(input.file, this.deps.limits);
    const processedAt = this.deps.clock.now();
    const normalized = normalizeImportRows(table, processedAt);
    const facts = await this.loadReferences(normalized.drafts);

    const candidates: ImportedReservationDraft[] = [];
    const rejections: RowRejection[] = [...normalized.rejections];
    for (const draft of normalized.drafts) {
      const errors = this.referenceErrors(draft, facts, input);
      if (errors.length === 0) candidates.push(draft);
      else
        rejections.push({ rowNumber: draft.rowNumber, reservationId: draft.reservationId, errors });
    }

    const batchId = this.deps.newBatchId();
    const saved = await this.deps.imported.saveBatch({
      batchId,
      processedAt,
      candidates,
      finalize: (concurrent) => {
        const raced = candidates.filter((draft) => concurrent.has(draft.reservationId));
        const all = [
          ...rejections,
          ...raced.map((draft) => ({
            rowNumber: draft.rowNumber,
            reservationId: draft.reservationId,
            errors: [
              {
                code: alreadyImported(draft, concurrent.get(draft.reservationId) ?? ''),
                field: IMPORT_COLUMNS.reservationId,
              },
            ],
          })),
        ].sort((left, right) => left.rowNumber - right.rowNumber);
        const accepted = candidates.length - raced.length;
        return {
          batch: this.batchOf(batchId, table, input, processedAt, accepted, all.length),
          rejections: all,
        };
      },
    });

    return {
      batch: saved.batch,
      accepted: saved.accepted.map((draft) => ({
        rowNumber: draft.rowNumber,
        reservationId: draft.reservationId,
      })),
      rejections: saved.rejections,
      ignoredColumns: normalized.ignoredColumns,
    };
  }

  private async loadReferences(
    drafts: readonly ImportedReservationDraft[],
  ): Promise<ReferenceFacts> {
    const ids = drafts.map((draft) => draft.reservationId);
    if (ids.length === 0) {
      return {
        inSource: new Set(),
        clients: new Set(),
        clinics: new Set(),
        products: new Set(),
        importedHashes: new Map(),
      };
    }
    const { references } = this.deps;
    const [inSource, clients, clinics, products, importedHashes] = await Promise.all([
      references.existingReservationIds(ids),
      references.existingClientIds(unique(drafts.map((draft) => draft.clientId))),
      references.existingClinicIds(unique(drafts.map((draft) => draft.clinicId))),
      references.products(unique(drafts.flatMap((draft) => draft.serviceProductIds))),
      this.deps.imported.existingRowHashes(ids),
    ]);
    return { inSource, clients, clinics, products: new Set(products.keys()), importedHashes };
  }

  private referenceErrors(
    draft: ImportedReservationDraft,
    facts: ReferenceFacts,
    input: ImportReservationsInput,
  ): RowRejectionError[] {
    const errors: RowRejectionError[] = [];
    if (facts.inSource.has(draft.reservationId)) {
      errors.push({ code: 'RESERVATION_EXISTS_IN_SOURCE', field: IMPORT_COLUMNS.reservationId });
    }
    const importedHash = facts.importedHashes.get(draft.reservationId);
    if (importedHash !== undefined) {
      errors.push({
        code: alreadyImported(draft, importedHash),
        field: IMPORT_COLUMNS.reservationId,
      });
    }
    if (!facts.clinics.has(draft.clinicId)) {
      errors.push({ code: 'UNKNOWN_CLINIC', field: IMPORT_COLUMNS.clinicId });
    } else if (!canAccessClinic(input.clinicScope, draft.clinicId)) {
      errors.push({ code: 'CLINIC_OUT_OF_SCOPE', field: IMPORT_COLUMNS.clinicId });
    }
    if (!facts.clients.has(draft.clientId)) {
      errors.push({ code: 'CLIENT_NOT_FOUND', field: IMPORT_COLUMNS.clientId });
    }
    if (draft.serviceProductIds.some((productId) => !facts.products.has(productId))) {
      errors.push({ code: 'PRODUCT_NOT_FOUND', field: IMPORT_COLUMNS.serviceProductIds });
    }
    return errors;
  }

  private batchOf(
    batchId: string,
    table: ImportTable,
    input: ImportReservationsInput,
    processedAt: Date,
    accepted: number,
    rejected: number,
  ): ImportBatch {
    return {
      batchId,
      contractVersion: RESERVATION_IMPORT_CONTRACT_VERSION,
      fileFormat: table.format,
      fileSha256: createHash('sha256').update(input.file.data).digest('hex'),
      fileSizeBytes: input.file.data.byteLength,
      status: statusOf(accepted, rejected),
      processedAt,
      totalRows: accepted + rejected,
      acceptedRows: accepted,
      rejectedRows: rejected,
      requestId: input.requestId,
      actorKind: 'INTERNAL_SERVICE',
      actorUserId: null,
    };
  }
}
