function decodeJsonPointerSegment(segment: string): string {
  return segment.replaceAll('~1', '/').replaceAll('~0', '~');
}

function normalizePath(instancePath: string): string {
  return instancePath
    .replace(/^\//, '')
    .split('/')
    .filter(Boolean)
    .map(decodeJsonPointerSegment)
    .join('.');
}

export function getValidationField(
  instancePath: string,
  keyword: string,
  params: Record<string, unknown>,
): string {
  const basePath = normalizePath(instancePath);

  if (keyword === 'required' && typeof params.missingProperty === 'string') {
    return basePath ? `${basePath}.${params.missingProperty}` : params.missingProperty;
  }

  if (keyword === 'additionalProperties' && typeof params.additionalProperty === 'string') {
    return basePath ? `${basePath}.${params.additionalProperty}` : params.additionalProperty;
  }

  return basePath || 'request';
}
