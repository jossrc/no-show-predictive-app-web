import type { FastifyInstance } from 'fastify';
import { strictValidatorCompiler } from '../../../../../../app/http/validation/StrictValidatorCompiler.js';
import type { EnableOverbookingHandler } from '../handler/EnableOverbookingHandler.js';
import type { EnableOverbookingRequest } from '../request/EnableOverbookingRequest.js';
import type { EnableOverbookingResponse } from '../response/EnableOverbookingResponse.js';
import { EnableOverbookingSchema } from '../schema/EnableOverbookingSchema.js';

/** HU-06: POST /api/v1/reservations/:reservationId/overbooking-authorizations. */
export function registerEnableOverbookingRoute(
  app: FastifyInstance,
  options: { handler: EnableOverbookingHandler },
): void {
  app.post<EnableOverbookingRequest & { Reply: EnableOverbookingResponse }>(
    '/reservations/:reservationId/overbooking-authorizations',
    {
      schema: EnableOverbookingSchema,
      bodyLimit: 1024,
      validatorCompiler: strictValidatorCompiler,
    },
    options.handler.handle,
  );
}
