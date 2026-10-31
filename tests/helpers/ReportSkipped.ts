import { it } from 'node:test';

/**
 * Node no contabiliza en el resumen los tests de un describe omitido. Este marcador hace visible
 * cada suite opt-in no ejecutada como SKIP (nunca como PASS silencioso).
 */
export function reportSkipped(scope: string, reason: string | false | null): void {
  if (reason) it(`${scope} — no ejecutado (opt-in)`, { skip: reason }, () => undefined);
}
