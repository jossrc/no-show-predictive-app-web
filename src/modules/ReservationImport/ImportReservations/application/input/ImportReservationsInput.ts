import type { ClinicAccessScope } from '../../../../../shared/security/RequestPrincipal.js';
import type { UploadedImportFile } from '../../../Shared/parsing/ReadImportTable.js';

/** Archivo en memoria (nunca en disco) + alcance y trazabilidad resueltos por el servidor. */
export interface ImportReservationsInput {
  readonly file: UploadedImportFile;
  readonly clinicScope: ClinicAccessScope;
  readonly requestId: string;
}
