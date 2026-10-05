export function extractLookupQuery(payload: string): string {
  const value = payload.trim();
  if (!value) return '';

  try {
    const url = new URL(value);
    for (const key of ['control_number', 'controlNumber', 'control', 'cn', 'q']) {
      const parameter = url.searchParams.get(key)?.trim();
      if (parameter) return parameter;
    }

    const pathParts = url.pathname.split('/').map((part) => decodeURIComponent(part).trim()).filter(Boolean);
    const publicPortalIndex = pathParts.findIndex((part) => part.toLowerCase() === 'public-portal');
    if (publicPortalIndex >= 0 && pathParts[publicPortalIndex + 1]) {
      return pathParts[publicPortalIndex + 1];
    }

    const controlNumberPath = pathParts.find((part) => /^(?:[A-Z]{2,}-)?[A-Z0-9]+(?:-[A-Z0-9.]+){2,}$/i.test(part));
    if (controlNumberPath) return controlNumberPath;
  } catch {
    // Not a URL; continue with plain-text parsing.
  }

  const labeledControlNumber = value.match(
    /(?:^|\b)(?:cn|control(?:[_\s-]*number)?)\s*[:=]\s*([A-Za-z0-9][A-Za-z0-9._/-]*)/i,
  );
  return labeledControlNumber?.[1] ?? value;
}
