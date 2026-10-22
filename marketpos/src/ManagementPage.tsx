import { BarChart3, Boxes, ChevronRight, RotateCcw, Store } from 'lucide-react';
import { tr } from './i18n';
import type { Lang, View } from './types';

export function ManagementPage({lang,views,onView}:{lang:Lang;views:View[];onView:(view:View)=>void}) {
 const entries: Array<{id:View;icon:typeof Store}>=[{id:'branches',icon:Store},{id:'returns',icon:RotateCcw},{id:'reports',icon:BarChart3},{id:'ops',icon:Boxes}];
 return <div className="module-page"><section className="page-intro"><div><h2>{tr(lang,'management')}</h2><span>{lang==='ru'?'Филиалы, кассы и операции':lang==='en'?'Locations, tills and operations':'Filiallar, kassalar və gündəlik əməliyyatlar'}</span></div></section><div className="management-grid">{entries.filter(item=>views.includes(item.id)).map(({id,icon:Icon})=><button className="management-card" key={id} onClick={()=>onView(id)}><Icon size={34}/><b>{tr(lang,id)}</b><ChevronRight/></button>)}</div></div>;
}
