import { useEffect, useMemo, useState } from 'react';
import { Check, LoaderCircle, Network, ScanBarcode, Search, Send, Wand2 } from 'lucide-react';
import type { Lang, Product, SessionUser } from './types';
import { marketCoreClient } from './core/client';
import { ALL_PREFIXES, SCALE_PRESETS, dahuaDescription, detectLayout, layoutFromRules, presetOf, readBarcode, rulesFromLayout, sampleBarcode, validLayout, type Candidate, type ScaleGood, type ScaleLayout } from './scaleBarcode';
import './scale1561.css';

/**
 * Parametrlər → Tərəzi (1.5.61). The label scale's barcode, designed once here: the till reads
 * it with these rules, and the same layout is shown as the description to key into the scale.
 * The LAN part sends goods (and the scale's print format per PLU) to a Dahua TM-A / TM-F.
 */
const LABEL_FORMATS: Array<[number, string, string, string]> = [
  [0, 'Tərəzinin öz formatı (Spec000)', 'Формат весов (Spec000)', 'Scale default (Spec000)'],
  [1, '1 · Mal etiketi 58×40', '1 · Этикетка 58×40', '1 · Item label 58×40'],
  [2, '2 · Mal etiketi 40×30', '2 · Этикетка 40×30', '2 · Item label 40×30'],
  [3, '3 · Mal etiketi 58×30', '3 · Этикетка 58×30', '3 · Item label 58×30'],
  [4, '4 · Cəm etiketi 58×40', '4 · Итоговая 58×40', '4 · Total label 58×40'],
  [5, '5 · Cəm etiketi 40×30', '5 · Итоговая 40×30', '5 · Total label 40×30'],
  [6, '6 · Cəm etiketi 58×30', '6 · Итоговая 58×30', '6 · Total label 58×30'],
  [7, '7 · Çek 58 mm', '7 · Чек 58 мм', '7 · Receipt 58 mm'],
  [8, '8 · Çek 40 mm', '8 · Чек 40 мм', '8 · Receipt 40 mm'],
  [9, '9 · Çek 48 mm', '9 · Чек 48 мм', '9 · Receipt 48 mm'],
  ...Array.from({ length: 30 }, (_, i): [number, string, string, string] => [10 + i, `${10 + i} · Öz dizaynınız`, `${10 + i} · Ваш формат`, `${10 + i} · Your own format`]),
];

const money = (minor?: number) => (minor === undefined ? '—' : `${(minor / 100).toFixed(2)} AZN`);
const kgText = (kg?: number) => (kg === undefined ? '—' : `${kg.toFixed(3)} kq`);

export function ScaleSettings({ session, lang, products, notify }: { session: SessionUser; lang: Lang; products: Product[]; notify: (s: string) => void }) {
  const t = (az: string, ru: string, en: string) => (lang === 'ru' ? ru : lang === 'en' ? en : az);
  const [layout, setLayout] = useState<ScaleLayout>({ prefixes: [...ALL_PREFIXES], ...SCALE_PRESETS[0]!.layout });
  const [saved, setSaved] = useState<string>(''), [custom, setCustom] = useState(false);
  const [busy, setBusy] = useState(''), [error, setError] = useState(''), [message, setMessage] = useState('');
  const [testCode, setTestCode] = useState(''), [testResult, setTestResult] = useState('');
  const [sample, setSample] = useState(''), [shownKind, setShownKind] = useState<'kg' | 'total'>('total'), [shownValue, setShownValue] = useState('');
  const [candidates, setCandidates] = useState<Candidate[] | null>(null);
  const scale = window.marketSystem?.scale, token = session.sessionToken;
  const [lan, setLan] = useState<{ ip: string; prefix: string; auto: boolean; last: string; labelNo: number } | null>(null), [found, setFound] = useState<string[]>([]);

  const goods: ScaleGood[] = useMemo(() => products.map((p) => ({ id: p.id, name: p.name[lang] || p.name.az, plu: String((p as Product & { plu?: string }).plu ?? ''), barcode: p.barcode, priceMinor: p.priceMinor, unit: p.unit })), [products, lang]);
  useEffect(() => {
    let live = true;
    if (marketCoreClient.available()) void marketCoreClient.scale.rules().then((r) => { const l = layoutFromRules(r.rules); if (!live) return; if (l) { setLayout(l); setCustom(!presetOf(l)); } setSaved(JSON.stringify(l ? rulesFromLayout(l) : r.rules)); }).catch((e) => { if (live) setError(String(e?.message || e)); });
    if (scale) void scale.get(token).then((c) => { if (live) setLan({ ...c, labelNo: Number(c.labelNo) || 0 }); }).catch(() => {});
    return () => { live = false; };
  }, [token]);

  const invalid = validLayout(layout);
  const rules = rulesFromLayout(layout), dirty = JSON.stringify(rules) !== saved;
  const code = sampleBarcode(layout), active = presetOf(layout);
  const work = async (kind: string, fn: () => Promise<void>) => {
    if (busy) return; setBusy(kind); setError(''); setMessage('');
    try { await fn(); } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(''); }
  };
  const save = () => work('save', async () => {
    await marketCoreClient.settings.setValue('scaleBarcodeRules', rules, session.id, session.role);
    setSaved(JSON.stringify(rules)); setMessage(t('Tərəzi barkodu saxlanıldı. Kassa yeni etiketləri bu formatla oxuyur.', 'Формат сохранён. Касса читает этикетки по нему.', 'Saved. The till now reads labels in this layout.')); notify(t('Tərəzi barkodu saxlanıldı', 'Формат сохранён', 'Scale barcode saved'));
  });
  const tryCode = () => work('try', async () => {
    const local = readBarcode(testCode, layout);
    if (!local) { setTestResult(t('Bu barkod seçilmiş prefikslərə və 13 rəqəmə uyğun deyil', 'Код не подходит к префиксам или не 13 цифр', 'Not 13 digits or prefix not selected')); return; }
    if (!local.checksumOk) { setTestResult(t('Yoxlama rəqəmi səhvdir — barkod düz oxunmayıb', 'Неверная контрольная цифра', 'Check digit is wrong')); return; }
    if (dirty) { setTestResult(t('Əvvəlcə yadda saxlayın, sonra kassa ilə yoxlayın', 'Сначала сохраните', 'Save first, then test with the till')); return; }
    const r = await marketCoreClient.scale.tryBarcode(testCode);
    const name = (r.name as { az?: string } | undefined)?.az ?? '';
    setTestResult(`${name} · ${kgText(Number(r.qtyMilli) / 1000 || undefined)} · ${money(Number(r.lineTotalMinor ?? r.embeddedPriceMinor) || undefined)}`);
  });
  const detect = () => {
    const n = Number(shownValue.replace(',', '.'));
    const shown = shownValue && Number.isFinite(n) ? (shownKind === 'kg' ? { kg: n } : { totalMinor: Math.round(n * 100) }) : undefined;
    setCandidates(detectLayout(sample, goods, shown));
  };
  const pick = (c: Candidate) => { setLayout((l) => ({ ...c.preset.layout, prefixes: l.prefixes.includes(c.reading.prefix) ? l.prefixes : [...l.prefixes, c.reading.prefix] })); setCustom(false); setCandidates(null); };
  const setPlu = (pluLen: number) => setLayout((l) => ({ ...l, pluLen, valueLen: 10 - pluLen }));
  const segments = [
    { cls: 'prefix', text: code.slice(0, 2), label: t('Prefiks', 'Префикс', 'Prefix') },
    { cls: 'plu', text: code.slice(2, 2 + layout.pluLen), label: 'PLU' },
    { cls: 'value', text: code.slice(2 + layout.pluLen, 12), label: layout.mode === 'PRICE' ? t('Məbləğ', 'Сумма', 'Total') : t('Çəki', 'Вес', 'Weight') },
    { cls: 'check', text: code.slice(12), label: t('Yoxlama', 'Контр.', 'Check') },
  ];
  const lanSave = (patch: Partial<NonNullable<typeof lan>>) => lan && work('lan', async () => { const next = { ...lan, ...patch }; await scale!.set(token, next); setLan(next); setMessage(t('Tərəzi ayarı saxlanıldı', 'Настройки весов сохранены', 'Scale settings saved')); });

  return <div className="scale-settings">
    {error && <div className="label-feedback error" role="alert">{error}</div>}
    {message && <div className="label-feedback" role="status"><Check/>{message}</div>}

    <section className="panel-card settings-card scale-card">
      <div className="panel-title"><div><p>{t('TƏRƏZİ ETİKETİ', 'ЭТИКЕТКА ВЕСОВ', 'SCALE LABEL')}</p><h3>{t('Tərəzi barkodunun dizaynı', 'Дизайн штрихкода весов', 'Scale barcode design')}</h3></div><ScanBarcode/></div>
      <p className="hint">{t('Tərəzinin çap etdiyi 13 rəqəmin nə daşıdığını seçin. Kassa etiketi bu formatla oxuyur; eyni formatı tərəzinin "barkod" proqramına da yazın (aşağıdakı kod).', 'Выберите, что несут 13 цифр этикетки. Касса читает по этому формату; тот же формат задайте в весах (код ниже).', 'Choose what the 13 digits on the label carry. The till reads this layout; key the same layout into the scale (code below).')}</p>
      <div className="scale-presets" role="radiogroup" aria-label={t('Barkod formatı', 'Формат', 'Layout')}>
        {SCALE_PRESETS.map((p) => <button type="button" role="radio" key={p.id} aria-checked={!custom && active?.id === p.id} className={!custom && active?.id === p.id ? 'active' : ''} onClick={() => { setLayout((l) => ({ ...p.layout, prefixes: l.prefixes })); setCustom(false); }}>{t(p.az, p.ru, p.en)}</button>)}
        <button type="button" role="radio" aria-checked={custom} className={custom ? 'active' : ''} onClick={() => setCustom(true)}>{t('Öz dizaynım', 'Свой формат', 'My own layout')}</button>
      </div>
      {custom && <div className="scale-custom">
        <label>{t('PLU uzunluğu', 'Длина PLU', 'PLU length')}<select value={layout.pluLen} onChange={(e) => setPlu(Number(e.target.value))}>{[3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
        <label>{t('Son rəqəmlər', 'Последние цифры', 'Last digits')}<select value={layout.mode} onChange={(e) => setLayout((l) => ({ ...l, mode: e.target.value as ScaleLayout['mode'], decimals: e.target.value === 'PRICE' ? 2 : 3 }))}><option value="WEIGHT">{t('Çəki', 'Вес', 'Weight')}</option><option value="PRICE">{t('Məbləğ', 'Сумма', 'Total price')}</option></select></label>
        <label>{t('Onluq rəqəm', 'Знаков после запятой', 'Decimals')}<select value={layout.decimals} onChange={(e) => setLayout((l) => ({ ...l, decimals: Number(e.target.value) }))}>{[0, 1, 2, 3].map((n) => <option key={n} value={n}>{n}{layout.mode === 'WEIGHT' && n === 3 ? ' (qram)' : layout.mode === 'PRICE' && n === 2 ? ' (qəpik)' : ''}</option>)}</select></label>
      </div>}
      <fieldset className="scale-prefixes"><legend>{t('Prefikslər (tərəzidə "mağaza/flag" kodu)', 'Префиксы (флаг весов)', 'Prefixes (scale flag)')}</legend>
        {ALL_PREFIXES.map((p) => <label key={p}><input type="checkbox" checked={layout.prefixes.includes(p)} onChange={(e) => setLayout((l) => ({ ...l, prefixes: e.target.checked ? [...l.prefixes, p].sort() : l.prefixes.filter((x) => x !== p) }))}/>{p}</label>)}
      </fieldset>
      <div className="scale-strip" aria-label={t('Nümunə barkod', 'Пример', 'Sample')}>{segments.map((s) => <span key={s.cls} className={`seg ${s.cls}`}><b>{s.text}</b><small>{s.label}</small></span>)}</div>
      <p className="scale-sample">{t('Nümunə', 'Пример', 'Sample')}: <code>{code}</code> → PLU {Number(code.slice(2, 2 + layout.pluLen))} · {layout.mode === 'PRICE' ? money(Math.round(Number(code.slice(2 + layout.pluLen, 12)) * 10 ** (2 - layout.decimals))) : kgText(Number(code.slice(2 + layout.pluLen, 12)) / 10 ** layout.decimals)}</p>
      <div className="scale-dahua"><span>{t('Dahua TM-30F-də barkod təsviri (P25 · BAR · Des)', 'Описание штрихкода в Dahua (P25 · BAR · Des)', 'Dahua barcode description (P25 · BAR · Des)')}</span><code>{dahuaDescription(layout)}</code>
        <small>{layout.mode === 'PRICE' ? t('Tərəzidə Spec209 (barkodda pulun onluğu) = ', 'В весах Spec209 = ', 'On the scale Spec209 = ') + layout.decimals : t('Tərəzidə Spec208 (barkodda çəkinin onluğu) = ', 'В весах Spec208 = ', 'On the scale Spec208 = ') + layout.decimals}</small></div>
      {invalid && <p className="label-warning" role="alert">{invalid === 'prefix' ? t('Ən azı bir prefiks seçin', 'Выберите префикс', 'Pick at least one prefix') : t('Prefiks + PLU + son rəqəmlər 12 rəqəm olmalıdır', 'Сумма полей должна быть 12', 'Fields must add up to 12 digits')}</p>}
      <div className="button-row"><button type="button" className="primary-action" disabled={Boolean(busy) || Boolean(invalid) || !dirty || !marketCoreClient.available()} onClick={() => void save()}>{busy === 'save' ? <LoaderCircle className="spin"/> : <Check/>}{t('Yadda saxla', 'Сохранить', 'Save')}</button>{dirty && <span className="label-dirty">{t('Saxlanmamış dəyişiklik var', 'Есть несохранённые изменения', 'Unsaved changes')}</span>}</div>
      <div className="scale-try"><label>{t('Tərəzi etiketini oxudun', 'Отсканируйте этикетку', 'Scan a scale label')}<input inputMode="numeric" value={testCode} onChange={(e) => setTestCode(e.target.value.replace(/\D/g, '').slice(0, 13))} placeholder="2000012008508"/></label><button type="button" disabled={testCode.length !== 13 || Boolean(busy)} onClick={() => void tryCode()}>{t('Yoxla', 'Проверить', 'Check')}</button>{testResult && <p role="status">{testResult}</p>}</div>
    </section>

    <section className="panel-card settings-card scale-card">
      <div className="panel-title"><div><p>{t('AVTOMATİK', 'АВТОМАТИЧЕСКИ', 'AUTOMATIC')}</p><h3>{t('Formatı etiketdən tap', 'Определить по этикетке', 'Find the layout from a label')}</h3></div><Wand2/></div>
      <p className="hint">{t('Tərəzidə bir mal çəkib etiket çıxarın, barkodu oxudun və etiketdə yazılan çəkini və ya məbləği daxil edin — kassa hansı formatın düz olduğunu tapır.', 'Взвесьте товар, отсканируйте этикетку и введите вес или сумму с этикетки — касса найдёт формат.', 'Weigh a good, scan its label and type the weight or total it shows — the till finds the layout.')}</p>
      <div className="scale-detect">
        <label>{t('Barkod', 'Штрихкод', 'Barcode')}<input inputMode="numeric" value={sample} onChange={(e) => setSample(e.target.value.replace(/\D/g, '').slice(0, 13))} placeholder="2200012006808"/></label>
        <label>{t('Etiketdə yazılan', 'На этикетке', 'Label shows')}<select value={shownKind} onChange={(e) => setShownKind(e.target.value as 'kg' | 'total')}><option value="total">{t('Məbləğ (AZN)', 'Сумма (AZN)', 'Total (AZN)')}</option><option value="kg">{t('Çəki (kq)', 'Вес (кг)', 'Weight (kg)')}</option></select></label>
        <label>{t('Dəyər', 'Значение', 'Value')}<input inputMode="decimal" value={shownValue} onChange={(e) => setShownValue(e.target.value)} placeholder={shownKind === 'kg' ? '0.850' : '6.80'}/></label>
        <button type="button" disabled={sample.length !== 13} onClick={detect}><Search/>{t('Tap', 'Найти', 'Find')}</button>
      </div>
      {candidates && (candidates.length ? <ol className="scale-candidates">{candidates.slice(0, 3).map((c, i) => <li key={c.preset.id} className={i === 0 ? 'best' : ''}><span><b>{t(c.preset.az, c.preset.ru, c.preset.en)}</b><small>{c.good ? c.good.name : t('PLU tapılmadı', 'PLU не найден', 'PLU not found')} · PLU {Number(c.reading.plu)} · {kgText(c.kg)} · {money(c.totalMinor)}{c.reading.checksumOk ? '' : ' · ' + t('yoxlama rəqəmi səhv', 'контр. цифра неверна', 'bad check digit')}</small></span><button type="button" onClick={() => pick(c)}>{t('Bunu seç', 'Выбрать', 'Use this')}</button></li>)}</ol>
        : <p className="label-warning">{t('Barkod 13 rəqəm olmalı və 20–29 ilə başlamalıdır', 'Код должен быть 13 цифр и начинаться с 20–29', 'The code must be 13 digits starting 20–29')}</p>)}
    </section>

    {scale && lan && <section className="panel-card settings-card scale-card">
      <div className="panel-title"><div><p>LAN · TCP 4001</p><h3>{t('Tərəziyə göndəriş (Dahua TM-30F)', 'Отправка на весы (Dahua TM-30F)', 'Send to the scale (Dahua TM-30F)')}</h3></div><Network/></div>
      <div className="scale-custom">
        <label>{t('Tərəzinin IP ünvanı', 'IP весов', 'Scale IP')}<input value={lan.ip} placeholder="192.168.1.50" onChange={(e) => setLan({ ...lan, ip: e.target.value.trim() })}/></label>
        <label>{t('Prefiks', 'Префикс', 'Prefix')}<select value={lan.prefix} onChange={(e) => setLan({ ...lan, prefix: e.target.value })}>{ALL_PREFIXES.map((p) => <option key={p} value={p}>{p}</option>)}</select></label>
        <label>{t('Etiket formatı (hər PLU ilə)', 'Формат этикетки (с каждым PLU)', 'Print format (sent with each PLU)')}<select value={lan.labelNo} onChange={(e) => setLan({ ...lan, labelNo: Number(e.target.value) })}>{LABEL_FORMATS.map(([n, az, ru, en]) => <option key={n} value={n}>{t(az, ru, en)}</option>)}</select></label>
      </div>
      <label className="label-check"><input type="checkbox" checked={lan.auto} onChange={(e) => setLan({ ...lan, auto: e.target.checked })}/>{t('Mal dəyişəndə avtomatik göndər', 'Отправлять автоматически при изменении', 'Send automatically on change')}</label>
      {!layout.prefixes.includes(lan.prefix) && <p className="label-warning">{t('Bu prefiks yuxarıdakı barkod dizaynında seçilməyib — kassa etiketi oxumayacaq', 'Этот префикс не выбран в формате выше', 'This prefix is not selected in the layout above')}</p>}
      <div className="button-row">
        <button type="button" disabled={Boolean(busy)} onClick={() => void work('scan', async () => { const r = await scale.scan(token); setFound(r.found); setMessage(r.found.length ? t('Tapıldı: ', 'Найдено: ', 'Found: ') + r.found.join(', ') : t('Bu şəbəkədə port 4001 açıq cihaz tapılmadı', 'Устройств с портом 4001 нет', 'No device with port 4001 found')); })}>{busy === 'scan' ? <LoaderCircle className="spin"/> : <Search/>}{t('Şəbəkədə axtar', 'Искать в сети', 'Search network')}</button>
        <button type="button" disabled={Boolean(busy)} onClick={() => void lanSave({})}><Check/>{t('Yadda saxla', 'Сохранить', 'Save')}</button>
        <button type="button" disabled={Boolean(busy) || !lan.ip} onClick={() => void work('send', async () => { await scale.set(token, lan); const r = await scale.send(token); setMessage(`${r.sent}/${r.total} ${t('mal tərəziyə yazıldı', 'товаров записано', 'goods stored')}${r.refused?.length ? ` · ${t('rədd', 'отказ', 'refused')}: ${r.refused.slice(0, 3).join(', ')}` : ''}`); })}>{busy === 'send' ? <LoaderCircle className="spin"/> : <Send/>}{t('Hamısını göndər', 'Отправить все', 'Send all')}</button>
        <button type="button" disabled={Boolean(busy) || !lan.ip} onClick={() => void work('test', async () => { await scale.set(token, lan); const r = await scale.test(token); setMessage(r.accepted ? t(`Test PLU ${r.plu} yazıldı: tərəzidə ${r.plu} çağırıb etiket çıxarın — qiymət 8.00 AZN/kq görünməlidir`, `Тест PLU ${r.plu} записан: цена должна быть 8.00 AZN/кг`, `Test PLU ${r.plu} stored: the label must show 8.00 AZN/kg`) : t('Tərəzi test sətrini qəbul etmədi: ', 'Весы не приняли тест: ', 'The scale refused the test: ') + r.reply); })}>{t('Test etiketi', 'Тестовая этикетка', 'Test label')}</button>
      </div>
      {found.length > 0 && <div className="button-row">{found.map((ip) => <button type="button" key={ip} onClick={() => setLan({ ...lan, ip })}>{ip}</button>)}</div>}
      {lan.last && <p className="hint">{lan.last}</p>}
    </section>}

    <section className="panel-card settings-card scale-card">
      <div className="panel-title"><div><p>TM-30F</p><h3>{t('Etiketdə 0.80 AZN əvəzinə "80" çıxırsa', 'Если на этикетке «80» вместо 0.80', 'If the label prints "80" instead of 0.80')}</h3></div></div>
      <p className="hint">{t('Kassa qiyməti tərəziyə qəpiklə göndərir (80 = 0.80 AZN, 800 = 8.00 AZN) — Dahua protokolu belə tələb edir. Nöqtəni tərəzinin özü qoyur. Etiketdə "80" və ya "800" görünürsə, tərəzinin sistem parametrlərində onluq nöqtə 0-a dəyişdirilib. Tərəzidə F-Prog → Spec ilə bunları qurun:', 'Касса передаёт цену в копейках (80 = 0.80). Точку ставят весы. Если печатается «80», в параметрах весов знаков после запятой 0. Установите:', 'The till sends the price in qəpik (80 = 0.80 AZN); the scale places the point. If labels show "80", its decimal settings were changed. Set:')}</p>
      <table className="scale-spec"><thead><tr><th>Spec</th><th>{t('Mənası', 'Значение', 'Meaning')}</th><th>{t('Dəyər', 'Значение', 'Value')}</th></tr></thead><tbody>
        <tr><td>202</td><td>{t('Vahid qiymətin onluğu', 'Знаки цены за кг', 'Unit price decimals')}</td><td><b>2</b></td></tr>
        <tr><td>203</td><td>{t('Məbləğin onluğu', 'Знаки суммы', 'Total price decimals')}</td><td><b>2</b></td></tr>
        <tr><td>206</td><td>{t('Vahid qiymətdə nöqtəni sabitlə', 'Фиксировать точку цены', 'Fix unit price point')}</td><td><b>3</b></td></tr>
        <tr><td>207</td><td>{t('Məbləğdə nöqtəni sabitlə', 'Фиксировать точку суммы', 'Fix total point')}</td><td><b>1</b></td></tr>
        <tr><td>100 / 101</td><td>{t('Yuvarlaqlaşdırma (qəpik gizlənməsin)', 'Округление (без скрытия копеек)', 'Rounding (keep qəpik)')}</td><td><b>0</b></td></tr>
        <tr><td>208 / 209</td><td>{t('Barkodda çəki / pul onluğu', 'Знаки веса / суммы в штрихкоде', 'Weight / money decimals in barcode')}</td><td><b>3 / 2</b></td></tr>
      </tbody></table>
      <p className="hint">{t('Sonra yuxarıdakı "Test etiketi" ilə yoxlayın: etiketdə 8.00 AZN/kq görünməlidir.', 'Затем проверьте «Тестовой этикеткой»: 8.00 AZN/кг.', 'Then print the test label: it must read 8.00 AZN/kg.')}</p>
    </section>
  </div>;
}
