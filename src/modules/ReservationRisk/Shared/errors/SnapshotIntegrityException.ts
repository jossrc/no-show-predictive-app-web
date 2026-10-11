import { InfrastructureException } from '../../../../shared/errors/infrastructure/InfrastructureException.js';

/** El snapshot persistido no coincide con su hash o contrato: se bloquea su uso. */
export class SnapshotIntegrityException extends InfrastructureException {
  static readonly CODE = 'SNAPSHOT_INTEGRITY_VIOLATION';

  constructor(snapshotId: string) {
    super({
      message: 'La instantánea persistida no supera la verificación de integridad',
      code: SnapshotIntegrityException.CODE,
      metadata: { snapshotId },
    });
  }
}
