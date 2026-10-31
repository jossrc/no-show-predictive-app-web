import type { FastifyRequest } from 'fastify';
import { requirePrincipal } from '../../../../../../app/http/security/RequirePrincipal.js';
import type { GetResearchRiskPolicy } from '../../../application/GetResearchRiskPolicy.js';
import type { GetResearchRiskPolicyResponse } from '../response/GetResearchRiskPolicyResponse.js';

export class GetResearchRiskPolicyHandler {
  constructor(private readonly getResearchRiskPolicy: GetResearchRiskPolicy) {}

  readonly handle = async (request: FastifyRequest): Promise<GetResearchRiskPolicyResponse> => {
    requirePrincipal(request);
    const data = await this.getResearchRiskPolicy.execute({ requestId: request.id });
    return { data, requestId: request.id };
  };
}
