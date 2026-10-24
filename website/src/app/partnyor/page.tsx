import type {Metadata} from 'next';
import {PartnerPageContent} from '@/components/pages/PartnerPageContent';
export const metadata:Metadata={title:'Partnyor kabineti',robots:{index:false,follow:false},alternates:{canonical:'https://possistem.az/partnyor/'}};
export default function Page(){return <PartnerPageContent/>;}
