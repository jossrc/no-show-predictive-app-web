import type { Clock } from '../../../../shared/time/Clock.js';
import {
  decodeReservationCursor,
  encodeReservationCursor,
} from '../../../Reservations/Shared/pagination/ReservationCursor.js';
import type { PriorityClientQuery } from '../../Shared/query/PriorityClientQuery.js';
import type { ListPriorityClientsInput } from './input/ListPriorityClientsInput.js';
import type { ListPriorityClientsResult } from './result/ListPriorityClientsResult.js';

/** Listado paginado (keyset, cursor firmado) de clientes prioritarios para retención. */
export class ListPriorityClients {
  constructor(
    private readonly query: PriorityClientQuery,
    private readonly clock: Clock,
  ) {}

  async execute(input: ListPriorityClientsInput): Promise<ListPriorityClientsResult> {
    const resolved = await this.query.resolve(input.filters, this.clock.now());
    const after = input.cursor ? decodeReservationCursor(input.cursor, resolved.signature) : null;
    const page = await this.query.page(resolved, after, input.limit);
    return {
      query: resolved,
      items: page.items,
      limit: input.limit,
      nextCursor:
        page.hasMore && page.last ? encodeReservationCursor(page.last, resolved.signature) : null,
      predictiveStoreAvailable: page.predictiveStoreAvailable,
    };
  }
}
