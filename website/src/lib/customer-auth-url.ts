const SITE_ORIGIN = 'https://possistem.az';

export function customerLoginUrl(returnPath = '/'): string {
  const next = returnPath.startsWith('http') ? returnPath : `${SITE_ORIGIN}${returnPath.startsWith('/') ? returnPath : `/${returnPath}`}`;
  return `/pos/app/login?next=${encodeURIComponent(next)}`;
}

export function customerRegisterUrl(returnPath = '/'): string {
  const next = returnPath.startsWith('http') ? returnPath : `${SITE_ORIGIN}${returnPath.startsWith('/') ? returnPath : `/${returnPath}`}`;
  return `/pos/app/login?next=${encodeURIComponent(next)}`;
}
