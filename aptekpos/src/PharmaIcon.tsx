/** Line icons for dosage forms and shelf groups: the picture of a medicine without a photo. */
const PATHS: Record<string, string> = {
  tablet: 'M4 12a8 8 0 1 0 16 0 8 8 0 1 0-16 0 M4.5 12h15',
  capsule: 'M8 3.5a4.5 4.5 0 0 1 8 0l-.2 17a4 4 0 0 1-7.6 0Z M8.1 12h7.8',
  bottle: 'M9 2h6v3H9Z M8 5h8l1 3v13H7V8Z M7 12h10 M7 17h10',
  drops: 'M12 3s-5 6-5 9.5a5 5 0 0 0 10 0C17 9 12 3 12 3Z M10 13a2 2 0 0 0 2 2',
  ampoule: 'M10 2h4 M10.5 2v4l-1.5 3v12h6V9l-1.5-3V2 M9 14h6',
  sachet: 'M5 4h14v16H5Z M5 8h14 M9 12h6 M9 15h4',
  tube: 'M6 3h12l-2 13H8Z M10 16h4v3h-4Z M11 19h2v2h-2Z M8 8h8',
  spray: 'M8 9h8v12H8Z M10 9V6h4v3 M11 6V4h4 M18 4h.01 M20 3h.01 M20 6h.01',
  inhaler: 'M8 3h6v10H8Z M8 13h10v6H8Z M14 16h4 M11 3V1',
  suppository: 'M12 3c3 2 4 6 4 10v6H8v-6c0-4 1-8 4-10Z M8 15h8',
  patch: 'M4 9l5-5 11 11-5 5Z M9.5 11.5h.01 M12.5 11.5h.01 M11 13h.01 M11 10h.01',
  device: 'M9 3h6v9a3 3 0 1 1-6 0Z M12 7v5 M12 15a1 1 0 1 0 0 .01',
  heart: 'M12 20s-8-5-8-11a4.5 4.5 0 0 1 8-2.8A4.5 4.5 0 0 1 20 9c0 6-8 11-8 11Z M8 11h2l1-2 2 4 1-2h2',
  baby: 'M12 8a4 4 0 1 0 0-.01 M6 21c0-4 2.7-7 6-7s6 3 6 7 M10 7.5h.01 M14 7.5h.01',
  vitamin: 'M9.2 4.4a4.5 4.5 0 0 1 6.4 6.4L10.8 15.6a4.5 4.5 0 0 1-6.4-6.4Z M7 7l6.4 6.4 M18 15v6 M15 18h6',
  leaf: 'M5 19C5 10 11 4 20 4c0 9-6 15-15 15Z M5 19 13 11',
  box: 'M21 8 12 3 3 8v8l9 5 9-5ZM3 8l9 5 9-5M12 13v8',
  cross: 'M9 3h6v6h6v6h-6v6H9v-6H3V9h6Z',
};

export function PharmaIcon({ icon, size = 24, className }: { icon: string; size?: number; className?: string }) {
  return (
    <svg className={className} width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[icon] ?? PATHS.box} />
    </svg>
  );
}
