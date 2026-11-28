import type { RetentionContactBody } from '../../../../Shared/http/RetentionHttpMapper.js';

export interface RecordRetentionContactResponse {
  data: RetentionContactBody & { replayed: boolean };
  requestId: string;
}
