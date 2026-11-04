import type { SnapshotEvidenceSource } from '../../../../shared/data/DataSourceMode.js';
import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type { ModelScore } from '../models/ModelScore.js';

/**
 * Lectura de un run de predicción YA persistido (inmutable) por su identidad pública
 * `predictionRunId` (run_uid). Usado por Sprint 02 para vincular acciones y observaciones a una
 * predicción concreta sin recalcularla. Nunca llama a Python.
 */
export interface PredictionRunReader {
  /**
   * Resultados por modelo del run indicado SOLO si pertenece a la reserva y a la evidencia del
   * modo activo; [] si no existe o es de otra reserva (no se revela cuál de los dos casos).
   */
  findRunResults(
    reservationId: DecimalId,
    predictionRunId: string,
    evidence: SnapshotEvidenceSource,
  ): Promise<readonly ModelScore[]>;
}
