export const ASSET_VERSION = '20260904-7';

export function asset(path: string): string {
  const normalized = path.startsWith('/') ? path : `/${path}`;
  const separator = normalized.includes('?') ? '&' : '?';
  return `${normalized}${separator}v=${ASSET_VERSION}`;
}

export function assetUrl(path: string): string {
  return `https://possistem.az${asset(path)}`;
}
