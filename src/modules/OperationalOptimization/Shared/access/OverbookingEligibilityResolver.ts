import {
  ML_MODEL_KEYS,
  type MlModelKey,
} from '../../../../infrastructure/http/ml/MlFeatureContract.js';
import {
  allowedSnapshotEvidence,
  type DataSourceMode,
} from '../../../../shared/data/DataSourceMode.js';
import type { Clock } from '../../../../shared/time/Clock.js';
import type { Reservation } from '../../../Reservations/Shared/models/Reservation.js';
import type { ReservationScoreSummary } from '../../../Reservations/Shared/models/ReservationScoreSummary.js';
import type { ReservationScoreReader } from '../../../Reservations/Shared/persistence/ReservationScoreReader.js';
import {
  evaluateOverbookingEligibility,
  type OverbookingEligibility,
} from '../rules/OverbookingEligibility.js';

export interface OverbookingEligibilityResolution {
  readonly eligibility: OverbookingEligibility;
  readonly latestScores: readonly ReservationScoreSummary[];
}

/**
 * Carga lo necesario para evaluar overbooking_eligibility_v1 desde el almacén de la app (último
 * score por modelo y política research vigente por modelo). Solo lecturas; nunca llama a Python.
 */
export class OverbookingEligibilityResolver {
  constructor(
    private readonly scores: Pick<
      ReservationScoreReader,
      'latestScores' | 'currentExperimentalPolicy'
    >,
    private readonly mode: DataSourceMode,
    private readonly clock: Clock,
  ) {}

  async resolve(
    reservation: Reservation,
    alreadyEnabled: boolean,
  ): Promise<OverbookingEligibilityResolution> {
    const evidence = allowedSnapshotEvidence(this.mode);
    const [latest, policies] = await Promise.all([
      this.scores.latestScores([reservation.reservationId], evidence),
      Promise.all(
        ML_MODEL_KEYS.map(
          async (modelKey) =>
            [
              modelKey,
              (await this.scores.currentExperimentalPolicy(modelKey, evidence))?.policyHash ?? null,
            ] as const,
        ),
      ),
    ]);
    const latestScores = latest.get(reservation.reservationId) ?? [];
    return {
      latestScores,
      eligibility: evaluateOverbookingEligibility({
        reservation,
        now: this.clock.now(),
        latestScores,
        currentPolicyHashes: new Map<MlModelKey, string | null>(policies),
        alreadyEnabled,
      }),
    };
  }
}
