import type { FastifyPluginAsync } from 'fastify';
import type { DataSourceMode } from '../../shared/data/DataSourceMode.js';
import type { Clock } from '../../shared/time/Clock.js';
import type { ReservationRepository } from '../Reservations/Shared/persistence/ReservationRepository.js';
import type { ReservationScoreReader } from '../Reservations/Shared/persistence/ReservationScoreReader.js';
import type { PredictionRunReader } from '../ReservationRisk/Shared/persistence/PredictionRunReader.js';
import type { RiskLevelPolicy } from '../ReservationRisk/Shared/policy/RiskLevelPolicy.js';
import { ExportPriorityClients } from './ExportPriorityClients/application/ExportPriorityClients.js';
import { ExportPriorityClientsHandler } from './ExportPriorityClients/presentation/http/handler/ExportPriorityClientsHandler.js';
import { registerExportPriorityClientsRoute } from './ExportPriorityClients/presentation/http/route/ExportPriorityClientsRoute.js';
import { ListPriorityClients } from './ListPriorityClients/application/ListPriorityClients.js';
import { ListPriorityClientsHandler } from './ListPriorityClients/presentation/http/handler/ListPriorityClientsHandler.js';
import { registerListPriorityClientsRoute } from './ListPriorityClients/presentation/http/route/ListPriorityClientsRoute.js';
import { RecordRetentionContact } from './RecordRetentionContact/application/RecordRetentionContact.js';
import { RecordRetentionContactHandler } from './RecordRetentionContact/presentation/http/handler/RecordRetentionContactHandler.js';
import { registerRecordRetentionContactRoute } from './RecordRetentionContact/presentation/http/route/RecordRetentionContactRoute.js';
import type { RetentionContactRepository } from './Shared/persistence/RetentionContactRepository.js';
import { PriorityClientQuery } from './Shared/query/PriorityClientQuery.js';

export interface CustomerRetentionModuleOptions {
  reservations: ReservationRepository;
  scores: ReservationScoreReader;
  runs: PredictionRunReader;
  contacts: RetentionContactRepository;
  policy: RiskLevelPolicy;
  mode: DataSourceMode;
  clock: Clock;
}

/**
 * Gestión de retención: listado y exportación de clientes prioritarios (una sola consulta) y
 * registro de la acción realizada. Solo INSERT en ml.app_retention_contacts; ninguna operación
 * envía comunicaciones, modifica la agenda ni llama a Python.
 */
export function createCustomerRetentionModule(
  options: CustomerRetentionModuleOptions,
): FastifyPluginAsync {
  return async (app): Promise<void> => {
    const query = new PriorityClientQuery({
      reservations: options.reservations,
      scores: options.scores,
      contacts: options.contacts,
      mode: options.mode,
    });

    registerListPriorityClientsRoute(app, {
      handler: new ListPriorityClientsHandler(
        new ListPriorityClients(query, options.clock),
        options.policy,
      ),
    });
    registerExportPriorityClientsRoute(app, {
      handler: new ExportPriorityClientsHandler(new ExportPriorityClients(query, options.clock)),
    });
    registerRecordRetentionContactRoute(app, {
      handler: new RecordRetentionContactHandler(
        new RecordRetentionContact({
          reservations: options.reservations,
          scores: options.scores,
          runs: options.runs,
          contacts: options.contacts,
          mode: options.mode,
          clock: options.clock,
        }),
      ),
    });
  };
}
