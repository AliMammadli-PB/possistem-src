import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DemoWorkspace } from '@/components/marketing/DemoWorkspace';
export const metadata: Metadata = {title:'Canlı POS demo',description:'Restoran, Market, Topdan, Aptek və Geyim POS-u brauzerdə sınayın.',alternates:{canonical:'https://possistem.az/demo/'}};
export default function DemoPage(){return <Suspense fallback={<main className="ps-demo-route-loading" role="status">possistem · Demo…</main>}><DemoWorkspace /></Suspense>;}
