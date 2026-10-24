import type { SVGProps } from 'react';
type Props = SVGProps<SVGSVGElement>;
function Base({children,...props}: Props) { return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...props}>{children}</svg>; }
export const ArrowUpRight = (p:Props) => <Base {...p}><path d="M6 18 18 6M6 6h12v12" /></Base>;
export const ArrowRight = (p:Props) => <Base {...p}><path d="M4 12h16m-6-6 6 6-6 6" /></Base>;
export const Play = (p:Props) => <Base {...p}><path d="m9 5 11 7-11 7Z" /></Base>;
export const Check = (p:Props) => <Base {...p}><path d="m5 12 4 4L19 6" /></Base>;
export const Monitor = (p:Props) => <Base {...p}><rect x="3" y="4" width="18" height="13" rx="2" /><path d="M8 21h8m-4-4v4" /></Base>;
export const Smartphone = (p:Props) => <Base {...p}><rect x="6" y="2" width="12" height="20" rx="2.5" /><path d="M10 5h4M11 19h2" /></Base>;
export const Store = (p:Props) => <Base {...p}><path d="m3 9 2-6h14l2 6M4 13v8h16v-8M9 21v-6h6v6M3 9v2a3 3 0 0 0 6 0 3 3 0 0 0 6 0 3 3 0 0 0 6 0V9Z" /></Base>;
export const Utensils = (p:Props) => <Base {...p}><path d="M4 3v6a3 3 0 0 0 6 0V3M7 3v18M20 3c-4 3-5 7 0 9v9M20 3v9" /></Base>;
export const Expand = (p:Props) => <Base {...p}><path d="M9 3H3v6m12-6h6v6M3 15v6h6m12-6v6h-6" /></Base>;
export const Close = (p:Props) => <Base {...p}><path d="m6 6 12 12M6 18 18 6" /></Base>;
export const WifiOff = (p:Props) => <Base {...p}><path d="M12 20h.01M8.5 16.43a5 5 0 0 1 7 0M5 12.86a10 10 0 0 1 5.17-2.69M19 12.86a10 10 0 0 0-2-1.52M2 8.82a15 15 0 0 1 4.18-2.64M22 8.82a15 15 0 0 0-11.29-3.76M2 2l20 20" /></Base>;
export const Transfer = (p:Props) => <Base {...p}><path d="M8 3 4 7l4 4M4 7h16m-4 14 4-4-4-4m4 4H4" /></Base>;
export const Sun = (p:Props) => <Base {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2m0 16v2M4.93 4.93l1.41 1.41m11.32 11.32 1.41 1.41M2 12h2m16 0h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" /></Base>;
export const Moon = (p:Props) => <Base {...p}><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></Base>;
export const Cart = (p:Props) => <Base {...p}><circle cx="8" cy="21" r="1" /><circle cx="19" cy="21" r="1" /><path d="M2 2h2l2.7 12.4a2 2 0 0 0 2 1.6h9.7a2 2 0 0 0 2-1.6L22 7H5.1" /></Base>;
export const Menu = (p:Props) => <Base {...p}><path d="M4 6h16M4 12h16M4 18h16" /></Base>;
