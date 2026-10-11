import { ConflictException } from '../../../../shared/errors/business/ConflictException.js';

/** Filtro/orden por nivel sin política aprobada: se rechaza, nunca se devuelve «lista vacía». */
export class RiskPolicyUnavailableException extends ConflictException {
  static readonly CODE = 'RISK_POLICY_UNAVAILABLE';

  constructor() {
    super({
      message: 'Niveles de riesgo pendientes de validación',
      code: RiskPolicyUnavailableException.CODE,
      details: { riskPolicyStatus: 'pending_validation' },
    });
  }
}
