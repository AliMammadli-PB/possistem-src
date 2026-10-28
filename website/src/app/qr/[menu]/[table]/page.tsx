import {notFound} from 'next/navigation';
import {QrMenu} from '@/components/qr/QrMenu';
export const metadata={title:'QR menyu · Possistem',robots:{index:false,follow:false}};
export default async function Page({params}:{params:Promise<{menu:string;table:string}>}){
 const {menu,table}=await params;if(!/^[a-f0-9]{48}$/.test(menu)||!/^[a-f0-9]{48}$/.test(table))notFound();
 return <QrMenu menuToken={menu} tableToken={table}/>;
}
