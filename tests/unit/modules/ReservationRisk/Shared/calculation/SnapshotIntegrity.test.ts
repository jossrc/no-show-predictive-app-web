import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeSnapshotHash } from '../../../../../../src/modules/ReservationRisk/Shared/calculation/SnapshotHash.js';
import { verifySnapshotIntegrity } from '../../../../../../src/modules/ReservationRisk/Shared/calculation/VerifySnapshotIntegrity.js';
import { SnapshotIntegrityException } from '../../../../../../src/modules/ReservationRisk/Shared/errors/SnapshotIntegrityException.js';
import {
  makeStoredSnapshot,
  SYNTHETIC_RESERVATION_ID,
} from '../../../../../helpers/MakeSyntheticReservation.js';

describe('SnapshotHash y verificación de integridad', () => {
  it('el hash es SHA-256 hex independiente del orden de claves', () => {
    const snapshot = makeStoredSnapshot();
    const reversed = Object.fromEntries(Object.entries(snapshot.features).reverse());
    const hash = (features: object) =>
      computeSnapshotHash({
        reservationId: snapshot.reservationId,
        predictionAt: snapshot.predictionAt,
        featureVersion: snapshot.featureVersion,
        builderVersion: snapshot.builderVersion,
        features: features as typeof snapshot.features,
      });
    assert.match(snapshot.snapshotHash, /^[0-9a-f]{64}$/);
    assert.equal(hash(reversed), snapshot.snapshotHash);
  });

  it('acepta un snapshot íntegro y bloquea uno alterado, de otra reserva o de otra versión', () => {
    const snapshot = makeStoredSnapshot();
    assert.equal(verifySnapshotIntegrity(snapshot, SYNTHETIC_RESERVATION_ID), snapshot);

    const tampered = { ...snapshot, features: { ...snapshot.features, previous_no_show: 9 } };
    assert.throws(
      () => verifySnapshotIntegrity(tampered, SYNTHETIC_RESERVATION_ID),
      SnapshotIntegrityException,
    );
    assert.throws(() => verifySnapshotIntegrity(snapshot, '1'), SnapshotIntegrityException);
    assert.throws(
      () =>
        verifySnapshotIntegrity({ ...snapshot, featureVersion: 'OTHER' }, SYNTHETIC_RESERVATION_ID),
      SnapshotIntegrityException,
    );
  });
});
