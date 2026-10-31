import { InfrastructureException } from './InfrastructureException.js';

/** Un servicio dependiente respondió fuera de su contrato versionado (HTTP 502). */
export abstract class UpstreamContractException extends InfrastructureException {}
