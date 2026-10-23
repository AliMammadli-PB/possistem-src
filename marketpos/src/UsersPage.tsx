import { useCallback, useEffect, useState } from 'react';
import { Check, Pencil, Plus, Trash2, UserCog } from 'lucide-react';
import { Field, Modal, RoleAvatar } from './forms';
import { roleLabel, tr } from './i18n';
import type { Lang, Role, SessionUser, StaffProfile } from './types';
import './users1568.css';

type Places = { offline?:boolean; warning?:string; warehouses?: {id:string;name:string;objectId?:string}[]; objects: { id: string; name: string;localObjectId?:string }[]; registers: { id: string; name: string; objectId: string }[] };
const ROLES: Role[] = ['manager', 'head_cashier', 'cashier', 'warehouse'];
/** The rights shown to the shop; POSSISTEM sets them (role policy + per-worker overrides). */
const SHOWN: Record<string, { az: string; ru: string; en: string }> = {
  SALE_CANCEL: { az: 'Səbətdən mal silmək', ru: 'Удаление товара из корзины', en: 'Remove items from the basket' },
  SALE_REFUND: { az: 'Geri qaytarma', ru: 'Возврат', en: 'Refunds' },
  SALE_DISCOUNT: { az: 'Endirim', ru: 'Скидка', en: 'Discounts' },
  PRICE_OVERRIDE: { az: 'Qiyməti dəyişmək', ru: 'Изменение цены', en: 'Price override' },
  DOCS_CREATE:{az:'Qaimə yaratmaq',ru:'Создание документов',en:'Create documents'},
  DOCS_VIEW: { az: 'Qaimələrə baxmaq', ru: 'Просмотр накладных', en: 'View documents' },
  DOCS_EDIT: { az: 'Qaimələrdə düzəliş', ru: 'Изменение накладных', en: 'Edit documents' },
  DOCS_DELETE: { az: 'Qaimələri silmək', ru: 'Удаление накладных', en: 'Delete documents' },
  MANAGE_USERS: { az: 'İstifadəçi yaratmaq', ru: 'Создание пользователей', en: 'Create users' },
  CLOSE_SHIFT: { az: 'Növbəni bağlamaq', ru: 'Закрытие смены', en: 'Close shift' },
};
const words = {
  az: { add: 'Yeni istifadəçi', edit: 'Düzəliş', remove: 'Deaktiv et', title: 'İstifadəçi', pinNew: 'PIN · 4–8 rəqəm *', pinKeep: 'Yeni PIN (boş qalsa dəyişmir)', object: 'Filial', anyObject: 'Bütün filiallar', kassas: 'Kassalar', anyKassa: 'Kassa seçilməsə hər kassada daxil ola bilər', perms: 'Səlahiyyətlər', fromPossistem: 'Səlahiyyətləri possistem təyin edir (rol və işçi üzrə). Dəyişiklik üçün possistem dəstəyinə yazın.', active: 'Aktiv', confirm: 'deaktiv edilsin? Əməliyyat tarixçəsi saxlanılır.', inactive: 'Passiv', noRights: 'İstifadəçiləri idarə etməyə icazəniz yoxdur.', you: 'siz' },
  ru: { add: 'Новый пользователь', edit: 'Изменить', remove: 'Отключить', title: 'Пользователь', pinNew: 'PIN · 4–8 цифр *', pinKeep: 'Новый PIN (пусто — без изменений)', object: 'Филиал', anyObject: 'Все филиалы', kassas: 'Кассы', anyKassa: 'Без выбора — вход на любой кассе', perms: 'Права', fromPossistem: 'Права назначает possistem (по ролям и сотрудникам). Для изменений напишите в поддержку possistem.', active: 'Активен', confirm: 'отключить? История сохранится.', inactive: 'Неактивен', noRights: 'Нет права управлять пользователями.', you: 'вы' },
  en: { add: 'New user', edit: 'Edit', remove: 'Deactivate', title: 'User', pinNew: 'PIN · 4–8 digits *', pinKeep: 'New PIN (blank keeps it)', object: 'Branch', anyObject: 'All branches', kassas: 'Registers', anyKassa: 'None chosen — may sign in at any register', perms: 'Permissions', fromPossistem: 'Permissions are set by possistem (per role and per worker). Contact possistem support to change them.', active: 'Active', confirm: 'be deactivated? History is retained.', inactive: 'Inactive', noRights: 'You may not manage users.', you: 'you' },
};

/**
 * İstifadəçilər: who may sign in to this till, where (object and kassas) and
 * with which extra rights. Everything here needs the users permission; the
 * main process checks it again and refuses granting rights one does not hold.
 */
export function UsersPage({ session, canManage, staff, lang, onChanged, notify }: { session: SessionUser; canManage: boolean; staff: StaffProfile[]; lang: Lang; onChanged: (rows: StaffProfile[]) => void; notify: (text: string) => void }) {
  const w = words[lang];
  const can = canManage;
  const [rights, setRights] = useState<Record<string, string[]>>({});
  const [editing, setEditing] = useState<StaffProfile | 'new' | null>(null);
  const [places, setPlaces] = useState<Places>({ objects: [], registers: [] });
  const [error, setError] = useState('');
  const [placesBusy,setPlacesBusy]=useState(false),[placesError,setPlacesError]=useState('');
  const loadPlaces=useCallback(async()=>{
    if(!can||!window.marketSystem)return;
    setPlacesBusy(true);setPlacesError('');
    try{setPlaces(await window.marketSystem.staff.places(session.sessionToken));}
    catch(e){setPlacesError(e instanceof Error?e.message:String(e));}
    finally{setPlacesBusy(false);}
  },[can,session.sessionToken]);
  useEffect(()=>{void loadPlaces();},[loadPlaces]);
  // Each user's effective rights, read from the core (nothing here changes them).
  useEffect(() => {
    const load = window.marketSystem?.auth.rights;
    if (!can || !load) return;
    let live = true;
    void Promise.all(staff.map(async (user) => [user.id, await load(session.sessionToken, user.id).catch(() => [] as string[])] as const))
      .then((rows) => { if (live) setRights(Object.fromEntries(rows)); });
    return () => { live = false; };
  }, [can, staff, session.sessionToken]);
  const remove = async (user: StaffProfile) => {
    if (!window.marketSystem || !window.confirm(`${user.name} ${w.confirm}`)) return;
    setError('');
    try { await window.marketSystem.staff.remove(session.sessionToken, user.id); onChanged(staff.map((row) => row.id === user.id ? {...row,active:false} : row)); notify(`${user.name} · ${w.remove}`); }
    catch (reason) { setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '') : String(reason)); }
  };
  const objectName = (id?: string) => places.objects.find((o) => o.id === id)?.name;
  const kassaNames = (ids: string[]) => ids.map((id) => places.registers.find((r) => r.id === id)?.name ?? id).join(', ');
  return <div className="module-page users-page">
    <header className="users-section-heading"><UserCog/><div><h2>{tr(lang, 'staff')}</h2><p>{staff.filter((row) => row.active).length} {tr(lang, 'active').toLowerCase()} · {w.object} / {w.kassas}</p></div>
      {can && <button className="primary-action" onClick={() => setEditing('new')}><Plus />{w.add}</button>}</header>
    {!can && <p className="form-error">{w.noRights}</p>}
    <p className="label-hint users-note">{w.fromPossistem}</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="users-table" role="table">{staff.map((user) => <div key={user.id} role="row" className={user.active ? '' : 'inactive'}>
      <RoleAvatar role={user.role} name={user.name} />
      <div role="cell"><b>{user.name}{user.id === session.id && <small> · {w.you}</small>}</b><em>{roleLabel(user.role, lang)}{user.active ? '' : ` · ${w.inactive}`}</em></div>
      <div role="cell"><small>{objectName(user.objectId) ?? w.anyObject}</small><small>{user.placesSet && user.registerIds.length ? kassaNames(user.registerIds) : '—'}</small></div>
      <div role="cell" className="permission-pills">{(rights[user.id] ?? []).filter((key) => SHOWN[key]).map((key) => <span key={key}>{SHOWN[key]![lang]}</span>)}</div>
      {can && <div role="cell" className="users-actions"><button onClick={() => setEditing(user)}><Pencil />{w.edit}</button><button className="danger" disabled={user.id === session.id} onClick={() => void remove(user)}><Trash2 />{w.remove}</button></div>}
    </div>)}</div>
    {editing && <UserModal lang={lang} session={session} user={editing === 'new' ? null : editing} places={places} placesBusy={placesBusy} placesError={placesError} reloadPlaces={loadPlaces} onClose={() => setEditing(null)} onSaved={(saved) => {
      onChanged(staff.some((row) => row.id === saved.id) ? staff.map((row) => row.id === saved.id ? saved : row) : [...staff, saved]);
      setEditing(null); notify(tr(lang, 'staffSaved'));
    }} />}
  </div>;
}

function UserModal({ lang, session, user, places, placesBusy,placesError,reloadPlaces,onClose, onSaved }: { lang: Lang; session: SessionUser; user: StaffProfile | null; places: Places; placesBusy:boolean;placesError:string;reloadPlaces:()=>Promise<void>; onClose: () => void; onSaved: (user: StaffProfile) => void }) {
  const w = words[lang];
  const [name, setName] = useState(user?.name ?? ''), [role, setRole] = useState<Role>(user?.role ?? 'cashier'), [pin, setPin] = useState('');
  const [active, setActive] = useState(user?.active ?? true), [objectId, setObjectId] = useState(user?.objectId ?? '');
  useEffect(()=>{const mapped=places.objects.find(o=>o.id===objectId||o.localObjectId===objectId);if(mapped&&mapped.id!==objectId)setObjectId(mapped.id);},[places,objectId]);
  const [warehouseIds,setWarehouseIds]=useState<string[]>(user?.warehouseIds||[]);
  const [registerIds, setRegisterIds] = useState<string[]>(user?.placesSet ? user.registerIds : []);
  const [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const kassas = places.registers.filter((r) => !objectId || r.objectId === objectId || !r.objectId);
  const toggle = <T,>(list: T[], item: T) => (list.includes(item) ? list.filter((x) => x !== item) : [...list, item]);
  const submit = async () => {
    if (!window.marketSystem) return;
    setBusy(true); setError('');
    try {
      const saved = await window.marketSystem.staff.save(session.sessionToken, { id: user?.id, name, role, active, objectId, warehouseIds, registerIds: registerIds.filter((id) => kassas.some((k) => k.id === id)) }, pin);
      onSaved(saved);
    } catch (reason) { setError(reason instanceof Error ? reason.message.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, '') : String(reason)); }
    finally { setBusy(false); }
  };
  const self = user?.id === session.id;
  return <Modal title={user ? `${w.edit} · ${user.name}` : w.add} subtitle={w.title} onClose={onClose} wide>
    {(placesBusy||placesError||places.warning||!places.objects.length)&&<div className="panel-card" role={placesError?'alert':'status'}>{placesBusy?tr(lang,'loading'):placesError||places.warning||(lang==='ru'?'Филиалы пока не назначены':lang==='en'?'No branches assigned yet':'Hələ filial təyin edilməyib')}<button type="button" disabled={placesBusy} onClick={()=>void reloadPlaces()}>{lang==='ru'?'Обновить':lang==='en'?'Reload':'Yenilə'}</button></div>}
    <div className="role-select">{ROLES.map((item) => <button key={item} type="button" className={role === item ? 'active' : ''} disabled={self || (item === 'manager' && session.role !== 'manager')} onClick={() => setRole(item)}><UserCog /><b>{roleLabel(item, lang)}</b></button>)}</div>
    <div className="form-grid">
      <Field label={`${tr(lang, 'name')} *`} value={name} onChange={setName} />
      <Field label={user ? w.pinKeep : w.pinNew} value={pin} onChange={(value) => setPin(value.replace(/\D/g, '').slice(0, 8))} type="password" />
      <label className="field"><span>{w.object}</span><select value={objectId} disabled={placesBusy||!!placesError} onChange={(e) => {setObjectId(e.target.value);setRegisterIds([]);setWarehouseIds([]);}}><option value="">{w.anyObject}</option>{places.objects.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}</select></label>
      <label className="field users-check"><input type="checkbox" checked={active} disabled={self} onChange={(e) => setActive(e.target.checked)} /><span>{w.active}</span></label>
    </div>

    <fieldset className="users-fieldset"><legend>{lang==='ru'?'Доступ к складам':lang==='en'?'Warehouse access':'Anbar icazələri'}</legend>{(places.warehouses||[]).filter(wh=>!objectId||!wh.objectId||wh.objectId===objectId).map(wh=><label className="users-check" key={wh.id}><input type="checkbox" checked={warehouseIds.includes(wh.id)} onChange={()=>setWarehouseIds(list=>toggle(list,wh.id))}/>{wh.name}</label>)}</fieldset>
    <fieldset className="users-fieldset"><legend>{w.kassas}</legend>
      {kassas.map((k) => <label key={k.id} className="users-check"><input type="checkbox" checked={registerIds.includes(k.id)} onChange={() => setRegisterIds((list) => toggle(list, k.id))} /><span>{k.name}</span></label>)}
      <small>{w.anyKassa}</small>
    </fieldset>
    <p className="label-hint users-note">{w.fromPossistem}</p>
    {error && <p className="form-error" role="alert">{error}</p>}
    <div className="modal-actions"><button type="button" onClick={onClose}>{tr(lang, 'cancel')}</button><button type="button" className="modal-primary" disabled={busy || placesBusy || !!placesError || !name.trim() || (!user && pin.length < 4) || (pin.length > 0 && pin.length < 4)} onClick={() => void submit()}><Check />{tr(lang, 'save')}</button></div>
  </Modal>;
}
