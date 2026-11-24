/**
 * Regla `binary_outcome_threshold_v1` (HU-07), EXPLÍCITAMENTE PROVISIONAL: para contrastar un
 * score continuo con un resultado binario observado, `predictedNoShow = probabilityNoShow >= 0.5`
 * por modelo. 0.5 es una convención técnica de comparación descriptiva, NO un umbral validado ni
 * una redefinición de las bandas Bajo/Medio/Alto. La regla y el umbral se guardan con cada
 * comparación: un cambio futuro de regla no reescribe comparaciones históricas.
 */
export const BINARY_OUTCOME_RULE_VERSION = 'binary_outcome_threshold_v1';
export const BINARY_OUTCOME_THRESHOLD = 0.5;

export const BINARY_OUTCOME_NOTICE =
  'Comparación descriptiva por algoritmo (binary_outcome_threshold_v1: probabilityNoShow >= 0.5 ⇒ inasistencia predicha). Umbral técnico provisional, no validado; no es evaluación científica final del modelo.';

export interface BinaryOutcomeComparison {
  readonly comparisonRuleVersion: typeof BINARY_OUTCOME_RULE_VERSION;
  readonly threshold: number;
  readonly predictedNoShow: boolean;
  readonly observedNoShow: boolean;
  readonly matchesPrediction: boolean;
}

export function compareWithObservedOutcome(
  probabilityNoShow: number,
  observedNoShow: boolean,
): BinaryOutcomeComparison {
  const predictedNoShow = probabilityNoShow >= BINARY_OUTCOME_THRESHOLD;
  return {
    comparisonRuleVersion: BINARY_OUTCOME_RULE_VERSION,
    threshold: BINARY_OUTCOME_THRESHOLD,
    predictedNoShow,
    observedNoShow,
    matchesPrediction: predictedNoShow === observedNoShow,
  };
}
