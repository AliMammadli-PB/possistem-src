import type {Metadata} from 'next';
import {PosDownloadsPage} from '@/components/pages/PosDownloadsPage';
export const metadata:Metadata={
  title:'POS proqramlarını yükləyin — Possistem',
  description:'Market POS və Restoran POS üçün Windows quraşdırıcıları. Proqramı seçin və yükləyin.',
  alternates:{canonical:'https://possistem.az/download/pos/'},
};
export default function Page(){return <PosDownloadsPage/>;}
