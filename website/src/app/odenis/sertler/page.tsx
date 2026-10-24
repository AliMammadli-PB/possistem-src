import type {Metadata} from 'next';
import {PaymentPage} from '@/components/billing/PaymentPage';
export const dynamic='force-dynamic';
export const metadata:Metadata={title:'Ödənişlər — Possistem',robots:{index:false,follow:false},referrer:'no-referrer'};
export default function Page(){return <PaymentPage mode='terms'/>;}
