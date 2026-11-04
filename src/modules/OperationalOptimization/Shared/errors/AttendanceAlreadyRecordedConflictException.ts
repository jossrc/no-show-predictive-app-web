import { ConflictException } from '../../../../shared/errors/business/ConflictException.js';

/** HU-07: ya existe otra observación; el registro histórico nunca se modifica ni se borra. */
export class AttendanceAlreadyRecordedConflictException extends ConflictException {
  static readonly CODE = 'ATTENDANCE_ALREADY_RECORDED_CONFLICT';

  constructor(existing: { attendanceStatus: string; predictionRunId: string }) {
    super({
      message: 'La asistencia ya fue registrada con otro valor; el registro no se modifica',
      code: AttendanceAlreadyRecordedConflictException.CODE,
      details: { ...existing },
    });
  }
}
