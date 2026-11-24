import type { OverbookingAuthorizationBody } from '../../../../Shared/http/OperationalHttpMapper.js';

export interface EnableOverbookingResponse {
  data: OverbookingAuthorizationBody & { enabled: true; replayed: boolean };
  requestId: string;
}
