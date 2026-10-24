import type { SVGProps } from 'react';

export type IconName =
  | 'activity'
  | 'arrow-right'
  | 'bell'
  | 'building'
  | 'camera'
  | 'check'
  | 'chevron-down'
  | 'chevron-left'
  | 'chevron-right'
  | 'clock'
  | 'copy'
  | 'download'
  | 'external'
  | 'eye'
  | 'eye-off'
  | 'file'
  | 'help'
  | 'home'
  | 'info'
  | 'integrations'
  | 'key'
  | 'logout'
  | 'mail'
  | 'map-pin'
  | 'menu'
  | 'monitor'
  | 'moon'
  | 'more'
  | 'phone'
  | 'plus'
  | 'minus'
  | 'refresh'
  | 'search'
  | 'settings'
  | 'setup'
  | 'shield'
  | 'sun'
  | 'table'
  | 'trash'
  | 'upload'
  | 'user'
  | 'warning'
  | 'wifi'
  | 'wifi-off'
  | 'windows'
  | 'chat'
  | 'send'
  | 'x';

type Props = Omit<SVGProps<SVGSVGElement>, 'name'> & {
  name: IconName;
  size?: number;
};

export function Icon({ name, size = 20, ...props }: Props) {
  return (
    <svg
      aria-hidden={props['aria-label'] ? undefined : true}
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.75"
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      {iconPath(name)}
    </svg>
  );
}

function iconPath(name: IconName) {
  switch (name) {
    case 'home':
      return <><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10M9 20v-6h6v6" /></>;
    case 'setup':
      return <><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06-2.83 2.83-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6 1.7 1.7 0 0 0-.4 1.1V21h-4v-.09A1.7 1.7 0 0 0 8.6 19.4a1.7 1.7 0 0 0-1.88.34l-.06.06-2.83-2.83.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1 1.7 1.7 0 0 0-1.1-.4H3v-4h.09A1.7 1.7 0 0 0 4.6 8.6a1.7 1.7 0 0 0-.34-1.88l-.06-.06 2.83-2.83.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6 1.7 1.7 0 0 0 .4-1.1V3h4v.09A1.7 1.7 0 0 0 15.4 4a1.7 1.7 0 0 0 1.88-.34l.06-.06 2.83 2.83-.06.06A1.7 1.7 0 0 0 19.4 9c.16.37.4.7.72.95.32.26.72.4 1.13.4H21v4h-.09A1.7 1.7 0 0 0 19.4 15Z" /></>;
    case 'download':
      return <><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></>;
    case 'upload':
      return <><path d="M12 16V4" /><path d="m7 9 5-5 5 5" /><path d="M5 20h14" /></>;
    case 'camera':
      return (
        <>
          <path d="M4 8.5h3.1l1.2-2.1A1.5 1.5 0 0 1 9.6 5.5h4.8a1.5 1.5 0 0 1 1.3.9L16.9 8.5H20A1.5 1.5 0 0 1 21.5 10v7.5A1.5 1.5 0 0 1 20 19H4a1.5 1.5 0 0 1-1.5-1.5V10A1.5 1.5 0 0 1 4 8.5Z" />
          <circle cx="12" cy="13.2" r="3.1" />
        </>
      );
    case 'activity':
      return <><path d="M4 19V9M10 19V5M16 19v-7M22 19H2" /></>;
    case 'integrations':
      return <><path d="M8 3v4M16 3v4M5 7h14v3a7 7 0 0 1-14 0ZM12 17v4" /></>;
    case 'settings':
      return <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1a7 7 0 0 0-1.7-1L14.5 3h-5L9 6.1a7 7 0 0 0-1.7 1l-2.4-1-2 3.4L5 11a7 7 0 0 0 0 2l-2 1.5 2 3.4 2.4-1a7 7 0 0 0 1.7 1l.4 3.1h5l.4-3.1a7 7 0 0 0 1.7-1l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z" /></>;
    case 'help':
      return <><circle cx="12" cy="12" r="9" /><path d="M9.8 9a2.4 2.4 0 1 1 3.6 2.1c-.9.5-1.4 1-1.4 2.1M12 17h.01" /></>;
    case 'logout':
      return <><path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9" /></>;
    case 'menu':
      return <path d="M4 7h16M4 12h16M4 17h16" />;
    case 'x':
      return <path d="m6 6 12 12M18 6 6 18" />;
    case 'sun':
      return <><circle cx="12" cy="12" r="3.5" /><path d="M12 2v2M12 20v2M4.9 4.9l1.5 1.5M17.6 17.6l1.5 1.5M2 12h2M20 12h2M4.9 19.1l1.5-1.5M17.6 6.4l1.5-1.5" /></>;
    case 'moon':
      return <path d="M20 15.7A8.5 8.5 0 0 1 8.3 4 8.5 8.5 0 1 0 20 15.7Z" />;
    case 'bell':
      return <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 7h18s-3 0-3-7" /><path d="M10 20h4" /></>;
    case 'chevron-down':
      return <path d="m7 10 5 5 5-5" />;
    case 'chevron-left':
      return <path d="m15 18-6-6 6-6" />;
    case 'chevron-right':
      return <path d="m9 18 6-6-6-6" />;
    case 'arrow-right':
      return <><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></>;
    case 'check':
      return <path d="m5 12 4 4 10-10" />;
    case 'warning':
      return <><path d="M12 3 2.7 20h18.6Z" /><path d="M12 9v4M12 17h.01" /></>;
    case 'info':
      return <><circle cx="12" cy="12" r="9" /><path d="M12 11v5M12 8h.01" /></>;
    case 'wifi':
      return <><path d="M5 12.5a10 10 0 0 1 14 0M8.5 16a5 5 0 0 1 7 0M12 20h.01M2 9a14 14 0 0 1 20 0" /></>;
    case 'wifi-off':
      return <><path d="m3 3 18 18M8.5 16a5 5 0 0 1 3.5-1.5M5 12.5a10 10 0 0 1 2.4-1.7M2 9a14 14 0 0 1 2.2-1.7M14.7 10.4A10 10 0 0 1 19 12.5M10.7 6.2A14 14 0 0 1 22 9M12 20h.01" /></>;
    case 'monitor':
      return <><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8M12 17v4" /></>;
    case 'clock':
      return <><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></>;
    case 'shield':
      return <><path d="M12 3 4 6v5c0 5 3.4 8.4 8 10 4.6-1.6 8-5 8-10V6Z" /><path d="m9 12 2 2 4-4" /></>;
    case 'key':
      return <><circle cx="8" cy="15" r="4" /><path d="m11 12 8-8M16 7l2 2M14 9l2 2" /></>;
    case 'eye':
      return <><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6S2 12 2 12" /><circle cx="12" cy="12" r="2.5" /></>;
    case 'eye-off':
      return <><path d="m3 3 18 18M10.6 6.1Q11.3 6 12 6c6.5 0 10 6 10 6a16 16 0 0 1-2.5 3.1M6.5 6.8A16 16 0 0 0 2 12s3.5 6 10 6c1.5 0 2.8-.3 4-.8M9.9 9.9A3 3 0 0 0 14.1 14" /></>;
    case 'mail':
      return <><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m4 7 8 6 8-6" /></>;
    case 'user':
      return <><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>;
    case 'building':
      return <><path d="M4 21V5h10v16M14 9h6v12M8 9h2M8 13h2M8 17h2M17 13h1M17 17h1M2 21h20" /></>;
    case 'phone':
      return <path d="M7 3H4a1 1 0 0 0-1 1c0 9.4 7.6 17 17 17a1 1 0 0 0 1-1v-3l-4-2-2 2c-3.5-1.5-6.5-4.5-8-8l2-2Z" />;
    case 'plus':
      return <path d="M12 5v14M5 12h14" />;
    case 'minus':
      return <path d="M5 12h14" />;
    case 'map-pin':
      return <><path d="M20 10c0 5-8 11-8 11S4 15 4 10a8 8 0 1 1 16 0Z" /><circle cx="12" cy="10" r="2.5" /></>;
    case 'file':
      return <><path d="M6 3h8l4 4v14H6Z" /><path d="M14 3v5h5M9 13h6M9 17h5" /></>;
    case 'trash':
      return <><path d="M4 7h16M9 7V4h6v3M7 7l1 14h8l1-14M10 11v6M14 11v6" /></>;
    case 'refresh':
      return <><path d="M20 7v5h-5" /><path d="M4 17v-5h5" /><path d="M6.1 8a7 7 0 0 1 11.6-2.3L20 8M4 16l2.3 2.3A7 7 0 0 0 18 16" /></>;
    case 'external':
      return <><path d="M14 4h6v6M20 4l-9 9" /><path d="M18 13v7H4V6h7" /></>;
    case 'copy':
      return <><rect x="8" y="8" width="11" height="12" rx="2" /><path d="M16 8V4H5a1 1 0 0 0-1 1v11h4" /></>;
    case 'windows':
      return <><path d="m3 5 8-1v8H3ZM13 3.7 21 3v9h-8ZM3 14h8v8l-8-1ZM13 14h8v9l-8-1Z" /></>;
    case 'table':
      return <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M9 9v11" /></>;
    case 'more':
      return <><circle cx="5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="12" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="19" cy="12" r="1" fill="currentColor" stroke="none" /></>;
    case 'search':
      return <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 5 5" /></>;
    case 'chat':
      return <><path d="M21 12a8 8 0 0 1-8 8H7l-4 3V12a8 8 0 1 1 18 0Z" /><path d="M8 12h.01M12 12h.01M16 12h.01" /></>;
    case 'send':
      return <path d="M3 11.5 21 3l-5.5 18-3.5-7Z" />;
    default:
      return null;
  }
}
