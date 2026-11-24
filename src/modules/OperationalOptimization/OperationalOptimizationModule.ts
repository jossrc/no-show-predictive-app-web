import type { FastifyPluginAsync } from 'fastify';
import type { DataSourceMode } from '../../shared/data/DataSourceMode.js';
import type { Clock } from '../../shared/time/Clock.js';
import type { ReservationRepository } from '../Reservations/Shared/persistence/ReservationRepository.js';
import type { ReservationScoreReader } from '../Reservations/Shared/persistence/ReservationScoreReader.js';
import type { BookingEvidenceSource } from '../ReservationRisk/Shared/persistence/BookingEvidenceSource.js';
import type { PredictionRunReader } from '../ReservationRisk/Shared/persistence/PredictionRunReader.js';
import { EnableOverbooking } from './EnableOverbooking/application/EnableOverbooking.js';
import { EnableOverbookingHandler } from './EnableOverbooking/presentation/http/handler/EnableOverbookingHandler.js';
import { registerEnableOverbookingRoute } from './EnableOverbooking/presentation/http/route/EnableOverbookingRoute.js';
import { GetAttendanceOutcome } from './GetAttendanceOutcome/application/GetAttendanceOutcome.js';
import { GetAttendanceOutcomeHandler } from './GetAttendanceOutcome/presentation/http/handler/GetAttendanceOutcomeHandler.js';
import { registerGetAttendanceOutcomeRoute } from './GetAttendanceOutcome/presentation/http/route/GetAttendanceOutcomeRoute.js';
import { GetOverbookingAuthorization } from './GetOverbookingAuthorization/application/GetOverbookingAuthorization.js';
import { GetOverbookingAuthorizationHandler } from './GetOverbookingAuthorization/presentation/http/handler/GetOverbookingAuthorizationHandler.js';
import { registerGetOverbookingAuthorizationRoute } from './GetOverbookingAuthorization/presentation/http/route/GetOverbookingAuthorizationRoute.js';
import { GetSpaceRecoveryOutcome } from './GetSpaceRecoveryOutcome/application/GetSpaceRecoveryOutcome.js';
import { GetSpaceRecoveryOutcomeHandler } from './GetSpaceRecoveryOutcome/presentation/http/handler/GetSpaceRecoveryOutcomeHandler.js';
import { registerGetSpaceRecoveryOutcomeRoute } from './GetSpaceRecoveryOutcome/presentation/http/route/GetSpaceRecoveryOutcomeRoute.js';
import { ListAttendanceOutcomes } from './ListAttendanceOutcomes/application/ListAttendanceOutcomes.js';
import { ListAttendanceOutcomesHandler } from './ListAttendanceOutcomes/presentation/http/handler/ListAttendanceOutcomesHandler.js';
import { registerListAttendanceOutcomesRoute } from './ListAttendanceOutcomes/presentation/http/route/ListAttendanceOutcomesRoute.js';
import { ListOverbookingAuthorizations } from './ListOverbookingAuthorizations/application/ListOverbookingAuthorizations.js';
import { ListOverbookingAuthorizationsHandler } from './ListOverbookingAuthorizations/presentation/http/handler/ListOverbookingAuthorizationsHandler.js';
import { registerListOverbookingAuthorizationsRoute } from './ListOverbookingAuthorizations/presentation/http/route/ListOverbookingAuthorizationsRoute.js';
import { ListSpaceRecoveryOutcomes } from './ListSpaceRecoveryOutcomes/application/ListSpaceRecoveryOutcomes.js';
import { ListSpaceRecoveryOutcomesHandler } from './ListSpaceRecoveryOutcomes/presentation/http/handler/ListSpaceRecoveryOutcomesHandler.js';
import { registerListSpaceRecoveryOutcomesRoute } from './ListSpaceRecoveryOutcomes/presentation/http/route/ListSpaceRecoveryOutcomesRoute.js';
import { RecordAttendanceOutcome } from './RecordAttendanceOutcome/application/RecordAttendanceOutcome.js';
import { RecordAttendanceOutcomeHandler } from './RecordAttendanceOutcome/presentation/http/handler/RecordAttendanceOutcomeHandler.js';
import { registerRecordAttendanceOutcomeRoute } from './RecordAttendanceOutcome/presentation/http/route/RecordAttendanceOutcomeRoute.js';
import { RecordSpaceRecoveryOutcome } from './RecordSpaceRecoveryOutcome/application/RecordSpaceRecoveryOutcome.js';
import { RecordSpaceRecoveryOutcomeHandler } from './RecordSpaceRecoveryOutcome/presentation/http/handler/RecordSpaceRecoveryOutcomeHandler.js';
import { registerRecordSpaceRecoveryOutcomeRoute } from './RecordSpaceRecoveryOutcome/presentation/http/route/RecordSpaceRecoveryOutcomeRoute.js';
import { AppointmentFinishedResolver } from './Shared/access/AppointmentFinishedResolver.js';
import { OverbookingEligibilityResolver } from './Shared/access/OverbookingEligibilityResolver.js';
import type { OperationalRepositories } from './Shared/persistence/OperationalRepositories.js';

export interface OperationalOptimizationModuleOptions {
  reservations: ReservationRepository;
  scores: ReservationScoreReader;
  runs: PredictionRunReader;
  evidenceSource: BookingEvidenceSource;
  operations: OperationalRepositories;
  mode: DataSourceMode;
  clock: Clock;
}

/**
 * Sprint 02 · Épica 3 (HU-06/07/08). Composition root local: repositorios → operaciones →
 * handlers → rutas. Todas las escrituras son INSERT en ml.app_*; ninguna toca FLOWww ni Python.
 */
export function createOperationalOptimizationModule(
  options: OperationalOptimizationModuleOptions,
): FastifyPluginAsync {
  return async (app): Promise<void> => {
    const { authorizations, attendance, recoveries } = options.operations;
    const eligibility = new OverbookingEligibilityResolver(
      options.scores,
      options.mode,
      options.clock,
    );
    const finished = new AppointmentFinishedResolver(options.evidenceSource, options.clock);

    registerEnableOverbookingRoute(app, {
      handler: new EnableOverbookingHandler(
        new EnableOverbooking({
          reservations: options.reservations,
          eligibility,
          runs: options.runs,
          authorizations,
          mode: options.mode,
          clock: options.clock,
        }),
      ),
    });
    registerGetOverbookingAuthorizationRoute(app, {
      handler: new GetOverbookingAuthorizationHandler(
        new GetOverbookingAuthorization({
          reservations: options.reservations,
          eligibility,
          authorizations,
        }),
      ),
    });
    registerListOverbookingAuthorizationsRoute(app, {
      handler: new ListOverbookingAuthorizationsHandler(
        new ListOverbookingAuthorizations({ reservations: options.reservations, authorizations }),
      ),
    });

    registerRecordAttendanceOutcomeRoute(app, {
      handler: new RecordAttendanceOutcomeHandler(
        new RecordAttendanceOutcome({
          reservations: options.reservations,
          finished,
          scores: options.scores,
          runs: options.runs,
          outcomes: attendance,
          mode: options.mode,
          clock: options.clock,
        }),
      ),
    });
    registerGetAttendanceOutcomeRoute(app, {
      handler: new GetAttendanceOutcomeHandler(
        new GetAttendanceOutcome({
          reservations: options.reservations,
          finished,
          scores: options.scores,
          outcomes: attendance,
          mode: options.mode,
        }),
      ),
    });
    registerListAttendanceOutcomesRoute(app, {
      handler: new ListAttendanceOutcomesHandler(
        new ListAttendanceOutcomes({ reservations: options.reservations, outcomes: attendance }),
      ),
    });

    registerRecordSpaceRecoveryOutcomeRoute(app, {
      handler: new RecordSpaceRecoveryOutcomeHandler(
        new RecordSpaceRecoveryOutcome({
          reservations: options.reservations,
          authorizations,
          recoveries,
          clock: options.clock,
        }),
      ),
    });
    registerGetSpaceRecoveryOutcomeRoute(app, {
      handler: new GetSpaceRecoveryOutcomeHandler(
        new GetSpaceRecoveryOutcome({
          reservations: options.reservations,
          authorizations,
          recoveries,
        }),
      ),
    });
    registerListSpaceRecoveryOutcomesRoute(app, {
      handler: new ListSpaceRecoveryOutcomesHandler(
        new ListSpaceRecoveryOutcomes({ reservations: options.reservations, recoveries }),
      ),
    });
  };
}
