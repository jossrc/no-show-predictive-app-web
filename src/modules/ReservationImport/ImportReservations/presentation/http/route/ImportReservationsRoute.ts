import type { FastifyInstance } from 'fastify';
import { strictValidatorCompiler } from '../../../../../../app/http/validation/StrictValidatorCompiler.js';
import type { ImportReservationsHandler } from '../handler/ImportReservationsHandler.js';
import type { ImportReservationsResponse } from '../response/ImportReservationsResponse.js';
import { ImportReservationsSchema } from '../schema/ImportReservationsSchema.js';

/** POST /api/v1/reservation-imports (multipart/form-data, un archivo). */
export function registerImportReservationsRoute(
  app: FastifyInstance,
  options: { handler: ImportReservationsHandler },
): void {
  app.post<{ Reply: ImportReservationsResponse }>(
    '/reservation-imports',
    {
      schema: ImportReservationsSchema,
      // El cuerpo multipart no se deserializa a JSON: su esquema documenta OpenAPI y el archivo
      // se valida explícitamente (formato, contenido y filas) en la aplicación.
      validatorCompiler: (definition) =>
        definition.httpPart === 'body' ? () => true : strictValidatorCompiler(definition),
    },
    options.handler.handle,
  );
}
