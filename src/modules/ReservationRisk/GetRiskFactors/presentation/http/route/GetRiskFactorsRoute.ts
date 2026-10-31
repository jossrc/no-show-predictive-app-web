import type { FastifyInstance } from 'fastify';
import type { GetRiskFactorsHandler } from '../handler/GetRiskFactorsHandler.js';
import type { GetRiskFactorsRequest } from '../request/GetRiskFactorsRequest.js';
import type { GetRiskFactorsResponse } from '../response/GetRiskFactorsResponse.js';
import { GetRiskFactorsSchema } from '../schema/GetRiskFactorsSchema.js';

/** HU-05: SHAP local bajo demanda; GET sin escrituras ni reentrenamiento. */
export function registerGetRiskFactorsRoute(
  app: FastifyInstance,
  options: { handler: GetRiskFactorsHandler },
): void {
  app.get<GetRiskFactorsRequest & { Reply: GetRiskFactorsResponse }>(
    '/reservations/:reservationId/risk/factors',
    { schema: GetRiskFactorsSchema },
    options.handler.handle,
  );
}
