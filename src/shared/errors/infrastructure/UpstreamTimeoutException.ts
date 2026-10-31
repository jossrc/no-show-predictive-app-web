import { InfrastructureException } from './InfrastructureException.js';

/** Un servicio dependiente no respondió dentro del presupuesto de tiempo (HTTP 504). */
export abstract class UpstreamTimeoutException extends InfrastructureException {}
