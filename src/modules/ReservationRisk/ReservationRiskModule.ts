import type { FastifyPluginAsync } from 'fastify';
import type { CachedMlModelCatalog } from '../../infrastructure/http/ml/CachedMlModelCatalog.js';
import type { MlPredictionClient } from '../../infrastructure/http/ml/MlPredictionClient.js';
import type { DataSourceMode } from '../../shared/data/DataSourceMode.js';
import type { Clock } from '../../shared/time/Clock.js';
import type { ClientHistoryRepository } from '../ClientHistory/Shared/persistence/ClientHistoryRepository.js';
import type { ReservationRepository } from '../Reservations/Shared/persistence/ReservationRepository.js';
import { GetReservationRisk } from './GetReservationRisk/application/GetReservationRisk.js';
import { GetReservationRiskHandler } from './GetReservationRisk/presentation/http/handler/GetReservationRiskHandler.js';
import { registerGetReservationRiskRoute } from './GetReservationRisk/presentation/http/route/GetReservationRiskRoute.js';
import { GetRiskFactors } from './GetRiskFactors/application/GetRiskFactors.js';
import { GetRiskFactorsHandler } from './GetRiskFactors/presentation/http/handler/GetRiskFactorsHandler.js';
import { registerGetRiskFactorsRoute } from './GetRiskFactors/presentation/http/route/GetRiskFactorsRoute.js';
import { ListReservationRisks } from './ListReservationRisks/application/ListReservationRisks.js';
import { ListReservationRisksHandler } from './ListReservationRisks/presentation/http/handler/ListReservationRisksHandler.js';
import { registerListReservationRisksRoute } from './ListReservationRisks/presentation/http/route/ListReservationRisksRoute.js';
import { RequestReservationPrediction } from './RequestReservationPrediction/application/RequestReservationPrediction.js';
import { RequestReservationPredictionHandler } from './RequestReservationPrediction/presentation/http/handler/RequestReservationPredictionHandler.js';
import { registerRequestReservationPredictionRoute } from './RequestReservationPrediction/presentation/http/route/RequestReservationPredictionRoute.js';
import { BookingSnapshotResolver } from './Shared/calculation/BookingSnapshotResolver.js';
import { RiskFeaturesBuilder } from './Shared/calculation/RiskFeaturesBuilder.js';
import type { BookingEvidenceSource } from './Shared/persistence/BookingEvidenceSource.js';
import type { BookingSnapshotRepository } from './Shared/persistence/BookingSnapshotRepository.js';
import type { PredictionResultRepository } from './Shared/persistence/PredictionResultRepository.js';
import type { RiskLevelPolicy } from './Shared/policy/RiskLevelPolicy.js';

export interface ReservationRiskModuleOptions {
  reservations: ReservationRepository;
  history: ClientHistoryRepository;
  snapshots: BookingSnapshotRepository;
  results: PredictionResultRepository;
  evidenceSource: BookingEvidenceSource;
  ml: MlPredictionClient;
  modelCatalog: CachedMlModelCatalog;
  policy: RiskLevelPolicy;
  mode: DataSourceMode;
  clock: Clock;
}

/** Composition root local: repositorios → operaciones → handlers → rutas. */
export function createReservationRiskModule(
  options: ReservationRiskModuleOptions,
): FastifyPluginAsync {
  return async (app): Promise<void> => {
    const resolver = new BookingSnapshotResolver(
      options.snapshots,
      options.evidenceSource,
      options.mode,
    );

    const listReservationRisks = new ListReservationRisks({
      reservations: options.reservations,
      policy: options.policy,
      evidenceSource: options.evidenceSource,
      mode: options.mode,
      clock: options.clock,
    });
    const getReservationRisk = new GetReservationRisk({
      reservations: options.reservations,
      snapshots: resolver,
      results: options.results,
      policy: options.policy,
      mode: options.mode,
      clock: options.clock,
    });
    const requestReservationPrediction = new RequestReservationPrediction({
      reservations: options.reservations,
      resolver,
      history: options.history,
      builder: new RiskFeaturesBuilder(),
      snapshots: options.snapshots,
      results: options.results,
      ml: options.ml,
      modelCatalog: options.modelCatalog,
      policy: options.policy,
      mode: options.mode,
      clock: options.clock,
    });
    const getRiskFactors = new GetRiskFactors({
      reservations: options.reservations,
      resolver,
      results: options.results,
      ml: options.ml,
    });

    registerListReservationRisksRoute(app, {
      handler: new ListReservationRisksHandler(listReservationRisks),
    });
    registerGetReservationRiskRoute(app, {
      handler: new GetReservationRiskHandler(getReservationRisk),
    });
    registerRequestReservationPredictionRoute(app, {
      handler: new RequestReservationPredictionHandler(requestReservationPrediction),
    });
    registerGetRiskFactorsRoute(app, {
      handler: new GetRiskFactorsHandler(getRiskFactors, options.policy),
    });
  };
}
