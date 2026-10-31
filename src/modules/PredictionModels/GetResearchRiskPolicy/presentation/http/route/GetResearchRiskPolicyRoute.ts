import type { FastifyInstance } from 'fastify';
import type { GetResearchRiskPolicyHandler } from '../handler/GetResearchRiskPolicyHandler.js';
import type { GetResearchRiskPolicyResponse } from '../response/GetResearchRiskPolicyResponse.js';
import { GetResearchRiskPolicySchema } from '../schema/GetResearchRiskPolicySchema.js';

export function registerGetResearchRiskPolicyRoute(
  app: FastifyInstance,
  options: { handler: GetResearchRiskPolicyHandler },
): void {
  app.get<{ Reply: GetResearchRiskPolicyResponse }>(
    '/ml/research-risk-policy',
    { schema: GetResearchRiskPolicySchema },
    options.handler.handle,
  );
}
