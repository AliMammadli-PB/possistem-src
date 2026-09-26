/** Line icons for clothing categories: the picture of a product without a photo. */
const PATHS: Record<string, string> = {
  shirt: 'M8 3 4 5 2 10l3 1.5V21h14v-9.5L22 10l-2-5-4-2-2 3h-4Z M12 6v15 M10 3l2 3 2-3',
  tee: 'M8 3 3 6l2 4 2.5-1V21h9V9l2.5 1 2-4-5-3a4 4 0 0 1-8 0Z',
  sweater: 'M8 3 3 7v12h3V10l1.5-1V21h9V9l1.5 1v9h3V7l-5-4a4 4 0 0 1-8 0Z M7.5 18.5h9',
  jacket: 'M8 3 3 6v15h7l2-9 2 9h7V6l-5-3-4 5Z M12 12v9 M6 14h2 M16 14h2',
  vest: 'M8 3 5 5v16h6l1-9 1 9h6V5l-3-2-4 6Z',
  coat: 'M8 2 3 5v17h8V9 M16 2l5 3v17h-8V9 M8 2l4 7 4-7 M9 14h.01 M9 17h.01',
  trousers: 'M6 3h12l1 18h-5l-2-11-2 11H5Z M6 6h12',
  shorts: 'M5 5h14l1 11h-6l-2-5-2 5H4Z M5 8h14',
  skirt: 'M8 4h8l4 16H4Z M8 7h8',
  dress: 'M9 2v4L6 9l2 3-4 10h16l-4-10 2-3-3-3V2 M9 6h6',
  underwear: 'M3 7h18v3l-6 8H9L3 10Z M3 10h18',
  sock: 'M9 2h6v10l3 4a3 3 0 0 1-2.5 5H8a3 3 0 0 1-3-3v-2l4-4Z M9 6h6',
  swim: 'M4 4c2 5 5 7 8 7s6-2 8-7 M4 13h16l-2 6H6Z',
  shoe: 'M2 16V9l4 1 3-4 5 5 5 1c2 .4 3 1.6 3 4v1H2Z M2 18h20',
  sneaker: 'M2 17v-5l5-1 3-4 3 3 4 1 4 2c1 .5 1 1.5 1 2v2Z M2 19h19 M9 10l1.5 2 M11.5 8.5 13 10.5',
  boot: 'M7 2h6v10l6 3c1.5.7 2 1.5 2 3v2H5V2 M5 20h16 M7 6h6',
  bag: 'M5 8h14l-1 13H6Z M9 8V6a3 3 0 0 1 6 0v2',
  belt: 'M2 9h20v6H2Z M13 8h6v8h-6Z M16 12h3',
  hat: 'M5 16c0-5 3-9 7-9s7 4 7 9 M2 17c3 2 17 2 20 0 M12 7V5',
  scarf: 'M6 3h12v6l-3 2v10h-4v-9L6 9Z M11 18h4 M11 15h4',
  glove: 'M7 21v-4L4 12l1.5-1.5L8 13V4.5a1.5 1.5 0 0 1 3 0V11 M11 4a1.5 1.5 0 0 1 3 0v7 M14 5a1.5 1.5 0 0 1 3 0v7 M17 7.5a1.5 1.5 0 0 1 3 0V15c0 3-2 6-5 6H7',
  gem: 'M6 3h12l4 6-10 12L2 9Z M2 9h20 M12 21 8 9l4-6 4 6Z',
  tag: 'M3 12V3h9l9 9-9 9Z M7.5 7.5h.01',
};

export function ApparelIcon({ icon, size = 24, className }: { icon: string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[icon] ?? PATHS.tag} />
    </svg>
  );
}
