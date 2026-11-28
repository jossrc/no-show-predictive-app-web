import { randomUUID } from 'node:crypto';
import multipart from '@fastify/multipart';
import type { FastifyPluginAsync } from 'fastify';
import type { Clock } from '../../shared/time/Clock.js';
import { ImportReservations } from './ImportReservations/application/ImportReservations.js';
import { ImportReservationsHandler } from './ImportReservations/presentation/http/handler/ImportReservationsHandler.js';
import { registerImportReservationsRoute } from './ImportReservations/presentation/http/route/ImportReservationsRoute.js';
import type { ImportFileLimits } from './Shared/parsing/ImportTable.js';
import type { ImportReferenceReader } from './Shared/persistence/ImportReferenceReader.js';
import type { ImportedReservationRepository } from './Shared/persistence/ImportedReservationRepository.js';

export interface ReservationImportModuleOptions {
  imported: ImportedReservationRepository;
  references: ImportReferenceReader;
  limits: ImportFileLimits;
  clock: Clock;
}

/**
 * Incorporación masiva de reservas. El parser multipart se registra SOLO en este contexto
 * encapsulado: el resto de la API conserva el límite global de cuerpo JSON. Un archivo, sin
 * campos adicionales, leído en memoria con tamaño máximo configurable.
 */
export function createReservationImportModule(
  options: ReservationImportModuleOptions,
): FastifyPluginAsync {
  return async (app): Promise<void> => {
    await app.register(multipart, {
      throwFileSizeLimit: true,
      limits: {
        fileSize: options.limits.maxFileBytes,
        files: 1,
        fields: 0,
        parts: 1,
        fieldNameSize: 64,
        headerPairs: 20,
      },
    });

    registerImportReservationsRoute(app, {
      handler: new ImportReservationsHandler(
        new ImportReservations({
          references: options.references,
          imported: options.imported,
          limits: options.limits,
          clock: options.clock,
          newBatchId: randomUUID,
        }),
      ),
    });
  };
}
