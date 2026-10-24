import type {Metadata} from 'next';
import {InformationPage} from '@/components/pages/InformationPage';
export const metadata:Metadata={
 title:'Məlumatlar — Possistem',
 description:'Possistem proqramları, filial və anbar idarəsi, quraşdırma addımları, və əlaqə məlumatları.',
 alternates:{canonical:'https://possistem.az/melumatlar/'},
 openGraph:{title:'Məlumatlar — Possistem',description:'Proqramlar, idarəetmə imkanları, və əlaqə.'},
};
export default function Page(){return <InformationPage/>;}
