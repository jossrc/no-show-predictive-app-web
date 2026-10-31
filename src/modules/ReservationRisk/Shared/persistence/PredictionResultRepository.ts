import type { MlModelKey } from '../../../../infrastructure/http/ml/MlFeatureContract.js';
import type { DecimalId } from '../../../../shared/identifiers/DecimalId.js';
import type { ModelScore, NewModelScore } from '../models/ModelScore.js';
import type { NewPredictionRun } from '../models/PredictionRun.js';

/**
 * Identidad de idempotencia: snapshot + modelo + versión + política research. Si la política
 * cambia (otro hash), el score anterior NO se reutiliza ni se reinterpreta: se pide uno nuevo.
 * `researchPolicyHash = null` identifica scores v1 sin banda experimental.
 */
export interface ModelIdentity {
  readonly modelKey: MlModelKey;
  readonly modelVersion: string;
  readonly researchPolicyHash: string | null;
}

export interface SavePredictionRunOutcome {
  /** run_uid creado; null si todos los resultados ya existían (petición concurrente ganadora). */
  readonly createdRunUid: string | null;
  /** Registros vigentes para cada identidad solicitada (propios o del ganador). */
  readonly scores: readonly ModelScore[];
}

export interface PredictionResultRepository {
  /** Último resultado por modelo para el snapshot. */
  findLatestBySnapshot(snapshotId: DecimalId): Promise<ModelScore[]>;
  /** Resultados exactos por identidad (snapshot, modelo, versión, política): idempotencia. */
  findByIdentities(
    snapshotId: DecimalId,
    identities: readonly ModelIdentity[],
  ): Promise<ModelScore[]>;
  /**
   * Persiste run + resultados en UNA transacción corta, después de validar la respuesta ML.
   * Conflictos UNIQUE se resuelven leyendo el registro ganador (sin 500 ni duplicados).
   */
  saveRun(
    run: NewPredictionRun,
    scores: readonly NewModelScore[],
  ): Promise<SavePredictionRunOutcome>;
}
