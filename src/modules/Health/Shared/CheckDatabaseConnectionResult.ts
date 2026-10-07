export type DatabaseConnectionName = 'postgres' | 'mysql';
export type DatabaseConnectionStatus = 'ok' | 'error' | 'disabled';

export interface CheckDatabaseConnectionResult {
  database: DatabaseConnectionName;
  status: DatabaseConnectionStatus;
  message: string;
}

export function getConnectionErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }

  return 'No se pudo verificar la conexión';
}
