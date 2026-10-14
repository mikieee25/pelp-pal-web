const TOKEN_PATTERN = /^[A-Za-z0-9+\/%=_-]{20,200}$/;

export function isAllowedDoeUrl(value: string): boolean {
  try {
    const url = new URL(value);
    const token = url.search.slice(1);
    return url.protocol === 'https:' && url.hostname === 'pelp.doe.gov.ph' && !url.port && !url.username && !url.password && !url.hash && url.pathname === '/vapproved.php' && !token.includes('&') && TOKEN_PATTERN.test(token);
  } catch {
    return false;
  }
}

export function getDoeToken(value: string): string | undefined {
  return isAllowedDoeUrl(value) ? new URL(value).search.slice(1) : undefined;
}

export function isBlockedDoeResponse(status: number, body: string, headers: Headers | string | null | undefined): boolean {
  const cfMitigated = typeof headers === 'string' ? headers.toLowerCase() === 'challenge' : headers?.has('cf-mitigated') ?? false;
  return status === 403 || status === 429 || /just a moment/i.test(body) || cfMitigated;
}

export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}
