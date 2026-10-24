'use client';

import type { DemoMode, DemoScreen } from './data';
import { openPosDemo } from './PosDemo';

/**
 * Invisible buttons laid over the "Quraşdırma və Başlanğıc" illustration so
 * every menu item / button painted in the picture opens the live demo there.
 * Coordinates are measured on the 1536×1024 source images (light and dark
 * variants differ slightly, so each has its own map).
 */
type Spot = { label: string; x: number; y: number; w: number; h: number; mode: DemoMode; screen: DemoScreen };

const W = 1536;
const H = 1024;

const SIDEBAR: [string, DemoMode, DemoScreen][] = [
  ['İdarə Paneli', 'restaurant', 'dashboard'],
  ['Satışlar', 'restaurant', 'sales'],
  ['Menyu', 'restaurant', 'menu'],
  ['Masalar', 'restaurant', 'pos'],
  ['Anbar', 'restaurant', 'stock'],
  ['Müştərilər', 'restaurant', 'customers'],
  ['Personal', 'restaurant', 'staff'],
  ['Hesabatlar', 'restaurant', 'reports'],
  ['Market', 'market', 'pos'],
  ['Lisenziyalar', 'restaurant', 'license'],
  ['Bildirişlər', 'restaurant', 'notifications'],
  ['Parametrlər', 'restaurant', 'settings'],
];

const DETAILS: [string, DemoScreen][] = [
  ['POS bağlantısı', 'settings'],
  ['Quraşdırma', 'settings'],
  ['Lisenziya', 'license'],
  ['Yeniləmə', 'notifications'],
];

function build(v: {
  side: { x: number; w: number; ys: number[] };
  details: { x: number; w: number; ys: number[]; h: number };
  cta: [number, number, number, number];
  bell: [number, number, number, number];
}): Spot[] {
  const spots: Spot[] = SIDEBAR.map(([label, mode, screen], i) => ({
    label,
    mode,
    screen,
    x: v.side.x,
    w: v.side.w,
    y: v.side.ys[i] - 23,
    h: 46,
  }));
  DETAILS.forEach(([label, screen], i) =>
    spots.push({ label: `${label} — təfərrüatlar`, mode: 'restaurant', screen, x: v.details.x, w: v.details.w, y: v.details.ys[i], h: v.details.h }),
  );
  const [cx, cy, cw, ch] = v.cta;
  spots.push({ label: 'İdarə Panelinə keçid', mode: 'restaurant', screen: 'dashboard', x: cx, y: cy, w: cw, h: ch });
  const [bx, by, bw, bh] = v.bell;
  spots.push({ label: 'Bildirişlər', mode: 'restaurant', screen: 'notifications', x: bx, y: by, w: bw, h: bh });
  return spots;
}

const LIGHT = build({
  side: { x: 20, w: 238, ys: [157, 214, 268, 321, 375, 428, 483, 537, 592, 646, 700, 755] },
  details: { x: 1242, w: 236, ys: [303, 450, 596, 741], h: 44 },
  cta: [1302, 882, 188, 52],
  bell: [1226, 36, 52, 60],
});

const DARK = build({
  side: { x: 20, w: 226, ys: [146, 201, 255, 310, 363, 417, 472, 526, 580, 634, 688, 743] },
  details: { x: 1268, w: 214, ys: [287, 424, 562, 699], h: 40 },
  cta: [1300, 830, 190, 48],
  bell: [1242, 28, 50, 56],
});

function Layer({ spots, variant }: { spots: Spot[]; variant: 'light' | 'dark' }) {
  return (
    <span className={`setup-hotspots setup-hotspots--${variant}`}>
      {spots.map((s, i) => (
        <button
          type="button"
          key={i}
          className={`setup-hotspot ${s.label === 'İdarə Panelinə keçid' ? 'is-cta' : ''}`}
          style={{
            left: `${(s.x / W) * 100}%`,
            top: `${(s.y / H) * 100}%`,
            width: `${(s.w / W) * 100}%`,
            height: `${(s.h / H) * 100}%`,
          }}
          aria-label={`${s.label} — canlı demoda aç`}
          title={`${s.label} — canlı demoda aç`}
          onClick={() => openPosDemo({ mode: s.mode, screen: s.screen, signedIn: true })}
        />
      ))}
    </span>
  );
}

export function SetupHotspots() {
  return (
    <>
      <Layer spots={LIGHT} variant="light" />
      <Layer spots={DARK} variant="dark" />
      <span className="setup-hotspots-badge" aria-hidden="true">
        <i /> Klikləyin — canlı demo
      </span>
    </>
  );
}
