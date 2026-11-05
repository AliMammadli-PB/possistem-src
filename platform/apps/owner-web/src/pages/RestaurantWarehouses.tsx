import {useEffect, useRef, useState, type FormEvent} from 'react';
import type {WarehouseBranch, WarehouseCall, WarehouseResult} from '../api';
import './restaurant-warehouses.css';

type Warehouse = {id:string; name:string; kind:string; active:boolean|number; sortOrder:number};
type Good = {id:string; name:string; barcode?:string; unit:string};
type Props = {
  branch:WarehouseBranch;
  online:boolean;
  canManage:boolean;
  canTransfer:boolean;
  rpc:(deviceId:string,calls:WarehouseCall[])=>Promise<{results:WarehouseResult[]}>;
};

export function RestaurantWarehouses({branch,online,canManage,canTransfer,rpc}:Props) {
  const [warehouses,setWarehouses] = useState<Warehouse[]>([]);
  const [goods,setGoods] = useState<Good[]>([]);
  const [revision,setRevision] = useState(0);
  const [warehouseError,setWarehouseError] = useState('');
  const [loading,setLoading] = useState(true);
  const [editor,setEditor] = useState<Warehouse|null>(null);
  const [from,setFrom] = useState('');
  const [to,setTo] = useState('');
  const [query,setQuery] = useState('');
  const [goodId,setGoodId] = useState('');
  const [quantity,setQuantity] = useState('');
  const [busy,setBusy] = useState(false);
  const [notice,setNotice] = useState('');
  const [error,setError] = useState('');
  const lock = useRef(false);
  const supported = branch.version.localeCompare('1.10.1',undefined,{numeric:true}) >= 0;
  const active = warehouses.filter(row=>row.active);
  const selectedGood = goods.find(good=>good.id===goodId);
  const needle = query.trim().toLocaleLowerCase('az');
  const matched = goods.filter(good=>[good.name,good.barcode].some(value=>value?.toLocaleLowerCase('az').includes(needle)));

  useEffect(()=>{
    let current = true;
    setLoading(true);
    setWarehouseError('');
    void rpc(branch.deviceId,[{method:'warehouses.list'},{method:'goods.list'}]).then(({results})=>{
      if(!current)return;
      if(!results[0]?.success)throw Error(results[0]?.error?.message || 'Anbarlar alınmadı.');
      setWarehouses(results[0].data.warehouses || []);
      setGoods(results[1]?.success ? results[1].data.goods || [] : []);
      if(!results[1]?.success)setWarehouseError(results[1]?.error?.message || 'Mal siyahısı alınmadı.');
    }).catch(cause=>{if(current)setWarehouseError((cause as Error).message);})
      .finally(()=>{if(current)setLoading(false);});
    return ()=>{current=false;};
  },[branch.deviceId,rpc,revision]);

  async function write(call:WarehouseCall,message:string,onSaved:()=>void) {
    if(lock.current || !online || !supported)return;
    lock.current = true;
    setBusy(true);
    setError('');
    setNotice('');
    try {
      const {results} = await rpc(branch.deviceId,[call]);
      if(!results[0]?.success)throw Error(results[0]?.error?.message || 'Dəyişiklik təsdiqlənmədi.');
      onSaved();
      setNotice(message);
      setRevision(value=>value+1);
    } catch(cause) {
      setError((cause as Error).message);
    } finally {
      lock.current=false;
      setBusy(false);
    }
  }

  function save(event:FormEvent) {
    event.preventDefault();
    if(!editor?.name.trim())return;
    void write({method:'warehouses.save',payload:{...editor,name:editor.name.trim(),active:Boolean(editor.active)}},
      'Anbar saxlanıldı.',()=>setEditor(null));
  }

  function move(event:FormEvent) {
    event.preventDefault();
    const value=quantity.trim().replace(',','.');
    const qtyMilli=Math.round(Number(value)*1000);
    if(!from || !to || from===to || !selectedGood || !/^\d+(?:\.\d{1,3})?$/.test(value) || !Number.isSafeInteger(qtyMilli) || qtyMilli<=0) {
      setError('Fərqli anbarlar, bir mal və sıfırdan böyük miqdar seçin.');
      return;
    }
    void write({method:'inventory.transfer',payload:{fromWarehouseId:from,toWarehouseId:to,ingredientId:goodId,qtyMilli}},
      'Mal seçilən anbara köçürüldü.',()=>setQuantity(''));
  }

  const editable=online && supported && !busy;
  return <section className="pw-location-workspace">
    {loading && <p role="status">Anbarlar yüklənir…</p>}
    {warehouseError && <p className="pw-error" role="alert">{warehouseError}</p>}
    {error && <p className="pw-error" role="alert">{error}</p>}
    {notice && <p className="pw-notice" role="status">{notice}</p>}
    {(!online || !supported) && <p className="pw-notice">{!supported
      ? 'Dəyişiklik üçün filialda Restoran POS 1.10.1 və ya daha yeni versiya lazımdır.'
      : 'Dəyişiklik etmək üçün filialın POS-u internetə qoşulmalıdır.'}</p>}
    <div className="pw-location-heading">
      <div><h2>Anbarlar</h2><p>{branch.name} · {active.length} aktiv anbar</p></div>
      {canManage && <button className="pw-action" type="button" disabled={!editable} onClick={()=>setEditor({id:'',name:'',kind:'store',active:true,sortOrder:0})}>Yeni anbar</button>}
    </div>
    <ul className="pw-location-list">
      {warehouses.map(row=><li key={row.id}><span>{row.name}{!row.active && <small>Bağlı</small>}</span>
        {canManage && <button type="button" disabled={!editable} onClick={()=>setEditor(row)}>Adı dəyiş</button>}</li>)}
    </ul>
    {editor && <form className="pw-location-form" onSubmit={save}>
      <label>Anbarın adı<input autoFocus required maxLength={100} value={editor.name} disabled={!editable} onChange={event=>setEditor({...editor,name:event.target.value})}/></label>
      <div className="pw-location-actions"><button type="submit" className="pw-action" disabled={!editable}>Saxla</button>
        <button type="button" disabled={busy} onClick={()=>setEditor(null)}>Ləğv et</button></div>
    </form>}
    {canTransfer && <section className="pw-location-move">
      <h2>Anbarlar arasında köçür</h2>
      <p>Bu filialdakı iki anbarı seçin.</p>
      {active.length<2 ? <p>Mal köçürmək üçün ən azı iki aktiv anbar lazımdır.</p>
      : <form className="pw-location-form" onSubmit={move}>
        <label>Göndərən anbar<select required value={from} disabled={!editable} onChange={event=>{setFrom(event.target.value);if(to===event.target.value)setTo('');}}>
          <option value="">Anbar seçin</option>{active.map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label>Qəbul edən anbar<select required value={to} disabled={!editable} onChange={event=>setTo(event.target.value)}>
          <option value="">Anbar seçin</option>{active.filter(row=>row.id!==from).map(row=><option key={row.id} value={row.id}>{row.name}</option>)}</select></label>
        <label>Mal axtar<input type="search" value={query} disabled={!editable} onChange={event=>{setQuery(event.target.value);setGoodId('');}} placeholder="Ad və ya barkod"/></label>
        <label>Mal<select aria-label="Mal" required value={goodId} disabled={!editable} onChange={event=>setGoodId(event.target.value)}>
          <option value="">{matched.length ? 'Mal seçin' : 'Uyğun mal yoxdur'}</option>
          {matched.slice(0,50).map(good=><option key={good.id} value={good.id}>{good.name}</option>)}</select></label>
        <label>Miqdar {selectedGood && `(${selectedGood.unit})`}<input required inputMode="decimal" value={quantity} disabled={!editable} onChange={event=>setQuantity(event.target.value)}/></label>
        <div className="pw-location-actions"><button type="submit" className="pw-action" disabled={!editable}>{busy ? 'Təsdiq gözlənilir…' : 'Malı köçür'}</button></div>
      </form>}
    </section>}
  </section>;
}
