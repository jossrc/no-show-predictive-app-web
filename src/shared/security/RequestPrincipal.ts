/**
 * Identidad técnica de la petición durante Sprint 01.
 * NO representa un usuario final: login (HU-21) y roles (HU-22) siguen pendientes.
 */
export const AUTH_LIMITATION_CODE = 'AUTH_FULL_FLOW_PENDING_HU21_HU22';

export type ClinicAccessScope =
  | { readonly kind: 'ALL_CLINICS' }
  | { readonly kind: 'CLINICS'; readonly clinicIds: readonly number[] };

export interface RequestPrincipal {
  readonly kind: 'INTERNAL_SERVICE';
  readonly authenticationMethod: 'PROVISIONAL_INTERNAL_API_KEY';
  readonly clinicScope: ClinicAccessScope;
  /** Sin identidad de usuario final verificable hasta HU-21/HU-22. */
  readonly userId: null;
  readonly limitation: typeof AUTH_LIMITATION_CODE;
}

export const PROVISIONAL_INTERNAL_PRINCIPAL: RequestPrincipal = Object.freeze({
  kind: 'INTERNAL_SERVICE',
  authenticationMethod: 'PROVISIONAL_INTERNAL_API_KEY',
  clinicScope: Object.freeze({ kind: 'ALL_CLINICS' }),
  userId: null,
  limitation: AUTH_LIMITATION_CODE,
});

export function canAccessClinic(scope: ClinicAccessScope, clinicId: number): boolean {
  return scope.kind === 'ALL_CLINICS' || scope.clinicIds.includes(clinicId);
}
