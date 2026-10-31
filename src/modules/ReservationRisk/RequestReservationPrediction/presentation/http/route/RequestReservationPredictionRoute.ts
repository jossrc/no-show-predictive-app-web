import type { FastifyInstance } from 'fastify';
import type { RequestReservationPredictionHandler } from '../handler/RequestReservationPredictionHandler.js';
import type { RequestReservationPredictionRequest } from '../request/RequestReservationPredictionRequest.js';
import type { RequestReservationPredictionResponse } from '../response/RequestReservationPredictionResponse.js';
import { RequestReservationPredictionSchema } from '../schema/RequestReservationPredictionSchema.js';

/** HU-02 acción explícita: crea un run auditable; nunca se dispara por reloj ni por GET. */
export function registerRequestReservationPredictionRoute(
  app: FastifyInstance,
  options: { handler: RequestReservationPredictionHandler },
): void {
  app.post<RequestReservationPredictionRequest & { Reply: RequestReservationPredictionResponse }>(
    '/reservations/:reservationId/predictions',
    { schema: RequestReservationPredictionSchema, bodyLimit: 1024 },
    options.handler.handle,
  );
}
