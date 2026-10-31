import { InfrastructureException } from './InfrastructureException.js';

/** Un servicio dependiente (o su cupo local) está saturado; aplicar backpressure (HTTP 429). */
export abstract class UpstreamRateLimitedException extends InfrastructureException {}
