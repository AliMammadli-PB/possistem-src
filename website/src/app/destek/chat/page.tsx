import { permanentRedirect } from 'next/navigation';

// The public community chat was replaced by private live support (bottom-right on every page).
export default function Page() {
  permanentRedirect('/destek/');
}
