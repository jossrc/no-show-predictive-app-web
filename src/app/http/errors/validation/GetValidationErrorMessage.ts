export function getValidationErrorMessage(code: string, field: string): string {
  switch (code) {
    case 'REQUIRED':
      return `El campo ${field} es obligatorio`;
    case 'INVALID_TYPE':
      return `El campo ${field} tiene un tipo inválido`;
    case 'INVALID_FORMAT':
      return `El formato del campo ${field} no es válido`;
    case 'MIN_LENGTH':
      return `El campo ${field} no alcanza la longitud mínima`;
    case 'MAX_LENGTH':
      return `El campo ${field} excede la longitud máxima`;
    case 'MIN_VALUE':
      return `El campo ${field} es menor que el valor permitido`;
    case 'MAX_VALUE':
      return `El campo ${field} es mayor que el valor permitido`;
    case 'MIN_ITEMS':
      return `El campo ${field} no contiene suficientes elementos`;
    case 'MAX_ITEMS':
      return `El campo ${field} contiene demasiados elementos`;
    case 'DUPLICATED_ITEMS':
      return `El campo ${field} contiene elementos duplicados`;
    case 'UNEXPECTED_FIELD':
      return `El campo ${field} no está permitido`;
    default:
      return `El campo ${field} contiene un valor inválido`;
  }
}
