import { readFile } from 'node:fs/promises';
import { env } from '../env.js';

/**
 * Each product publishes its own electron-updater feed, so the installer a
 * customer is offered is resolved from that feed rather than pinned in the UI.
 * Hardcoded links went stale the moment a release shipped: the portal was still
 * handing out MarketPos 1.4.2 while the feed had moved on.
 */
/* geyim-product: type */ export type SetupProduct = 'restaurant' | 'market' | 'geyim' | 'aptek' | 'topdan'; /* topdan-product: type */ /* aptek-product: type */

const FEEDS: Record<SetupProduct, { publicBase: string; localFile: string; localHttp: string; productName: string }> = {
  restaurant: {
    publicBase: 'https://possistem.az/pos-updates',
    localFile: '/var/www/pos-updates/latest.yml',
    localHttp: 'http://127.0.0.1/pos-updates',
    productName: 'possistem',
  },
  market: {
    publicBase: 'https://possistem.az/marketpos/updates',
    localFile: '/var/www/marketpos/updates/latest.yml',
    localHttp: 'http://127.0.0.1/marketpos/updates',
    productName: 'MarketPos',
  },
  /* geyim-product: feed */
  geyim: {
    publicBase: 'https://possistem.az/geyimpos/updates',
    localFile: '/var/www/geyimpos/updates/latest.yml',
    localHttp: 'http://127.0.0.1/geyimpos/updates',
    productName: 'GeyimPos',
  },
  /* aptek-product: feed */
  aptek: {
    publicBase: 'https://possistem.az/aptekpos/updates',
    localFile: '/var/www/aptekpos/updates/latest.yml',
    localHttp: 'http://127.0.0.1/aptekpos/updates',
    productName: 'AptekPos',
  },
  /* topdan-product: feed */
  topdan: {
    publicBase: 'https://possistem.az/topdanpos/updates',
    localFile: '/var/www/topdanpos/updates/latest.yml',
    localHttp: 'http://127.0.0.1/topdanpos/updates',
    productName: 'TopdanPos',
  },
};

/** Env overrides stay honoured, but only for the restaurant feed they named. */
function feedFor(product: SetupProduct) {
  const feed = FEEDS[product];
  if (product !== 'restaurant') return feed;
  return {
    ...feed,
    publicBase: process.env.UPDATE_FEED_URL ?? env.updateFeedUrl ?? feed.publicBase,
    localFile: process.env.UPDATE_FEED_FILE ?? feed.localFile,
  };
}

function parseLatestYml(text: string): {
  version: string;
  path: string;
  size: number | null;
  sha512: string | null;
  releaseDate: string | null;
} | null {
  const version = text.match(/^version:\s*['"]?([^\s'"]+)/m)?.[1];
  const path =
    text.match(/^path:\s*['"]?([^\s'"]+)/m)?.[1] ??
    text.match(/^\s*-\s*url:\s*['"]?([^\s'"]+)/m)?.[1];
  const sizeRaw = text.match(/^\s*size:\s*(\d+)/m)?.[1];
  const sha512 = text.match(/^\s*sha512:\s*['"]?([^\s'"]+)/m)?.[1] ?? null;
  const releaseDate =
    text.match(/^releaseDate:\s*['"]?([^'"\r\n]+)['"]?/m)?.[1]?.trim() ?? null;
  if (!version || !path) return null;
  return {
    version,
    path,
    size: sizeRaw ? Number(sizeRaw) : null,
    sha512,
    releaseDate,
  };
}

export type SetupInfo = {
  version: string;
  fileName: string;
  downloadUrl: string;
  sizeBytes: number | null;
  sha512: string | null;
  releaseDate: string | null;
  feedUrl: string;
  platform: 'windows';
  productName: string;
  requirements: {
    operatingSystem: string;
    architecture: string;
    memory: string;
    diskSpace: string;
    internet: string;
  };
};

export type SetupError = {
  error: string;
  feedUrl: string;
  details?: string[];
};

/** Son Windows setup bilgisini update feed'inden çözer. */
export async function resolveSetupInfo(
  product: SetupProduct = 'restaurant',
): Promise<{ ok: true; info: SetupInfo } | { ok: false; error: SetupError }> {
  const feed = feedFor(product);
  const base = feed.publicBase.replace(/\/+$/, '');
  const candidates = [
    { kind: 'file' as const, url: feed.localFile },
    { kind: 'http' as const, url: `${feed.localHttp}/latest.yml` },
    { kind: 'http' as const, url: `${base}/latest.yml` },
  ];

  let text: string | null = null;
  let latestUrl = candidates[0].url;
  const errors: string[] = [];

  for (const candidate of candidates) {
    latestUrl = candidate.url;
    try {
      if (candidate.kind === 'file') {
        text = await readFile(candidate.url, 'utf8');
      } else {
        const res = await fetch(candidate.url, {
          headers: { accept: 'text/plain,*/*' },
          signal: AbortSignal.timeout(10_000),
        });
        if (!res.ok) {
          errors.push(`${candidate.url} → HTTP ${res.status}`);
          continue;
        }
        text = await res.text();
      }
      break;
    } catch (err) {
      errors.push(`${candidate.url} → ${err instanceof Error ? err.message : 'failed'}`);
    }
  }

  if (!text) {
    return {
      ok: false,
      error: { error: 'Update feed unreachable', feedUrl: latestUrl, details: errors },
    };
  }

  const parsed = parseLatestYml(text);
  if (!parsed) {
    return { ok: false, error: { error: 'Invalid latest.yml', feedUrl: latestUrl } };
  }

  return {
    ok: true,
    info: {
      version: parsed.version,
      fileName: parsed.path,
      downloadUrl: `${base}/${parsed.path}`,
      sizeBytes: parsed.size,
      sha512: parsed.sha512,
      releaseDate: parsed.releaseDate,
      feedUrl: base,
      platform: 'windows',
      productName: feed.productName,
      requirements: {
        operatingSystem: 'Windows 10 və ya Windows 11',
        architecture: '64-bit (x64)',
        memory: 'Minimum 4 GB RAM',
        diskSpace: 'Minimum 1 GB boş yer',
        internet: 'Aktivləşdirmə və sinxronizasiya üçün tələb olunur',
      },
    },
  };
}

/**
 * Bayiye gösterilen daraltılmış sürüm.
 *
 * `feedUrl` ve `sha512` kasten çıkarılır: bayi yalnızca kuruluma yönlendirilir,
 * feed dizinine / kaynak arşivine değil.
 */
export function publicSetupInfo(info: SetupInfo) {
  return {
    version: info.version,
    fileName: info.fileName,
    downloadUrl: info.downloadUrl,
    sizeBytes: info.sizeBytes,
    productName: info.productName,
    platform: info.platform,
    releaseDate: info.releaseDate,
    requirements: info.requirements,
  };
}
