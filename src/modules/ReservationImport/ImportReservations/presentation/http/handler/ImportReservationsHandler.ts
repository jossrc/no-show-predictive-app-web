import type { FastifyReply, FastifyRequest } from 'fastify';
import { requirePrincipal } from '../../../../../../app/http/security/RequirePrincipal.js';
import { InvalidImportFileException } from '../../../../Shared/errors/InvalidImportFileException.js';
import {
  IMPORT_BATCH_STATUS_LABELS,
  IMPORT_PREDICTION_NOTICE,
  summarizeRejections,
  toRowErrors,
} from '../../../../Shared/http/ImportHttpMapper.js';
import type { ImportReservations } from '../../../application/ImportReservations.js';
import type { ImportReservationsResponse } from '../response/ImportReservationsResponse.js';

export const IMPORT_FILE_FIELD = 'file';

function unsupportedMediaType(): Error {
  return Object.assign(new Error('Se requiere multipart/form-data'), { statusCode: 415 });
}

export class ImportReservationsHandler {
  constructor(private readonly importReservations: ImportReservations) {}

  readonly handle = async (
    request: FastifyRequest,
    reply: FastifyReply,
  ): Promise<ImportReservationsResponse> => {
    const principal = requirePrincipal(request);
    if (!request.isMultipart()) throw unsupportedMediaType();

    // Un único archivo en memoria (límites de tamaño/partes del plugin); nunca toca el disco.
    const part = await request.file();
    if (!part || part.fieldname !== IMPORT_FILE_FIELD) {
      throw new InvalidImportFileException('IMPORT_FILE_REQUIRED');
    }
    const data = await part.toBuffer();

    const result = await this.importReservations.execute({
      file: { filename: part.filename, data },
      clinicScope: principal.clinicScope,
      requestId: request.id,
    });
    const { batch } = result;

    reply.status(201);
    return {
      data: {
        batchId: batch.batchId,
        contractVersion: batch.contractVersion,
        fileFormat: batch.fileFormat,
        fileSha256: batch.fileSha256,
        fileSizeBytes: batch.fileSizeBytes,
        status: batch.status,
        statusLabel: IMPORT_BATCH_STATUS_LABELS[batch.status],
        processedAt: batch.processedAt.toISOString(),
        totalRows: batch.totalRows,
        acceptedRows: batch.acceptedRows,
        rejectedRows: batch.rejectedRows,
        acceptedReservations: result.accepted.map((row) => ({ ...row })),
        rejectedRowDetails: result.rejections.map((rejection) => ({
          rowNumber: rejection.rowNumber,
          reservationId: rejection.reservationId,
          errors: toRowErrors(rejection),
        })),
        rejectionSummary: summarizeRejections(result.rejections),
        ignoredColumns: [...result.ignoredColumns],
        predictionsGenerated: false,
        notice: IMPORT_PREDICTION_NOTICE,
        actorKind: batch.actorKind,
        actorUserId: batch.actorUserId,
      },
      requestId: request.id,
    };
  };
}
