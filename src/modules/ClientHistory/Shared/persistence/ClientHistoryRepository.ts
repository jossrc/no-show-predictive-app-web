import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type { ClientHistoryAsOfSummary } from '../models/ClientHistoryAsOfSummary.js';

/** Contrato público del módulo ClientHistory: también lo usa RiskFeaturesBuilder (as-of). */
export interface ClientHistoryRepository {
  /** Agrega en SQL solo eventos del cliente con `known_at < cutoffExclusive`. */
  summarizeAsOf(clientId: DecimalId, cutoffExclusive: Date): Promise<ClientHistoryAsOfSummary>;
}
