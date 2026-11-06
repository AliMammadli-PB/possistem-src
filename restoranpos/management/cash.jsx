/* Named cash accounts. Amounts are integer qəpik; transfers stay in native transactions. */
function psCashKind(kind){return psAdminText(...({till:['Kassa','Kasa','Till'],bank:['Bank','Banka','Bank'],treasury:['Xəzinə','Hazine','Treasury']}[kind]||['Kassa','Kasa','Account']));}
function psCashFacts(account){
  const n=key=>Number(account[key])||0;
  const known=key=>typeof account[key]==='number';
  if(account.kind==='treasury')return [
    [psAdminText('Bu gün daxil / çıxış','Bugün giriş / çıkış','Today in / out'),known('todayInMinor')?formatMoney(n('todayInMinor'))+' / '+formatMoney(n('todayOutMinor')):'—'],
    [psAdminText('Ümumi daxilolma','Toplam giriş','Total receipts'),known('totalInMinor')?formatMoney(n('totalInMinor')):'—']
  ];
  return [
    [account.kind==='bank'?psAdminText('Bu gün kartla','Bugün kartla','Card receipts today'):psAdminText('Bu gün satış ödənişi','Bugünkü satış ödemesi','Sales receipts today'),formatMoney(n('todayCashMinor')+n('todayCardMinor'))],
    [account.kind==='bank'?psAdminText('Ümumi kart ödənişi','Toplam kart ödemesi','Total card receipts'):psAdminText('Ümumi satış ödənişi','Toplam satış ödemesi','Total sales receipts'),known('totalCashMinor')&&known('totalCardMinor')?formatMoney(n('totalCashMinor')+n('totalCardMinor')):'—']
  ];
}
function PsCashAccountsGrid({accounts,data,busy,canManage,termName,onTransfer,onMoves,onEdit,onRemove,onRegisterOpen}){
  const grid=reactExports.useRef(null);
  reactExports.useEffect(()=>{const close=event=>grid.current?.querySelectorAll('details[open]').forEach(node=>{if(!node.contains(event.target))node.open=false});document.addEventListener('pointerdown',close);return()=>document.removeEventListener('pointerdown',close)},[]);
  const action=(event,fn)=>{const menu=event.currentTarget.closest('details');if(menu)menu.open=false;fn();};
  if(!accounts.length)return <p className="ps-recipe-note">{psAdminText('Hələ kassa yoxdur. “Yeni kassa” ilə satış kassasını, bankı və ya xəzinəni yaradın.','Henüz kasa yok. “Yeni kasa” ile satış kasası, banka veya hazine oluşturun.','No accounts yet. Create a till, bank or treasury with “New account”.')}</p>;
  return <div className="pm-cash-grid" ref={grid}>{accounts.map(account=><article className={'pm-cash-card is-'+account.kind} key={account.id} aria-label={account.name}>
    <button type="button" className="pm-cash-card-main" aria-label={account.name+' — '+(canManage?psAdminText('Transfer aç','Transfer aç','Open transfer'):psAdminText('Pul hərəkətləri','Para hareketleri','Money movements'))} disabled={busy} onClick={()=>canManage?onTransfer(account):onMoves(account)}>
      <span className="pm-cash-card-heading"><strong>{account.name}</strong><span className="pm-cash-kind">{psCashKind(account.kind)}</span></span>
      <span className="pm-cash-meta">{[account.objectName,account.kind==='till'&&account.terminalId?termName(account.terminalId):''].filter(Boolean).join(' · ')||psAdminText('Obyektsiz','İşletmesiz','No location')}</span>
      <span className="pm-cash-balance-label">{psAdminText('Cari balans','Güncel bakiye','Current balance')}</span><strong className="pm-cash-balance">{formatMoney(account.balanceMinor||0)}</strong>
      <span className="pm-cash-facts">{psCashFacts(account).map(([label,value])=><span key={label}><small>{label}</small><b>{value}</b></span>)}</span>
    </button>
    <div className="pm-cash-card-actions">
      {canManage&&<button type="button" className="ps-ops-button pm-cash-transfer" disabled={busy} onClick={()=>onTransfer(account)}>{psAdminText('Transfer','Transfer','Transfer')} <span aria-hidden="true">↗</span></button>}
      <details className="pm-cash-menu" onKeyDown={event=>{if(event.key==='Escape'){event.currentTarget.open=false;event.currentTarget.querySelector('summary')?.focus();}}}>
        <summary aria-label={account.name+' — '+psAdminText('Əlavə əməliyyatlar','Diğer işlemler','More actions')}><span aria-hidden="true">⋯</span></summary>
        <div>{onRegisterOpen&&account.kind==='till'&&String(account.terminalId||'').startsWith('market-')&&<button type="button" disabled={busy} onClick={event=>action(event,()=>onRegisterOpen(account))}>{psAdminText('Növbə · X/Z','Vardiya · X/Z','Shift · X/Z')}</button>}<button type="button" disabled={busy} onClick={event=>action(event,()=>onMoves(account))}>{psAdminText('Pul hərəkətləri','Para hareketleri','Money movements')}</button>
          {canManage&&<><button type="button" disabled={busy} onClick={event=>action(event,()=>onEdit(account))}>{psAdminText('Redaktə et','Düzenle','Edit')}</button><button type="button" className="is-danger" disabled={busy} onClick={event=>action(event,()=>onRemove(account))}>{psAdminText('Sil','Sil','Delete')}</button></>}
        </div>
      </details>
    </div>
  </article>)}</div>;
}
function PsCashTransferDialog({form,onChange,accounts,busy,error,onClose,onSave}){
  const from=accounts.find(a=>a.id===form.fromId),available=Number(from?.balanceMinor)||0,amount=opsMinor(form.value||'0');
  const valid=!!from&&!!form.toId&&form.toId!==form.fromId&&psStockInputValid(form.value)&&Number.isSafeInteger(amount)&&amount>0&&amount<=available;
  const option=a=><option key={a.id} value={a.id}>{[a.name,a.objectName,psCashKind(a.kind)].filter(Boolean).join(' · ')} — {formatMoney(a.balanceMinor||0)}</option>;
  return <PsAdminDialog title={psAdminText('Kassalar arası transfer','Kasalar arası transfer','Transfer between accounts')} busy={busy} onClose={()=>{if(!busy)onClose();}}>
    <form className="pm-cash-transfer-form" onSubmit={event=>{event.preventDefault();if(valid&&!busy)onSave();}}>
      <div className="pm-cash-transfer-selects"><label>{psAdminText('Haradan','Nereden','From')}<select value={form.fromId} disabled={busy} onChange={event=>onChange({...form,fromId:event.target.value,toId:event.target.value===form.toId?'':form.toId,value:''})}><option value="">{psAdminText('Kassanı seçin','Kasa seçin','Choose account')}</option>{accounts.map(option)}</select></label>
      <label>{psAdminText('Haraya','Nereye','To')}<select value={form.toId} disabled={busy} onChange={event=>onChange({...form,toId:event.target.value})}><option value="">{psAdminText('Kassanı seçin','Kasa seçin','Choose account')}</option>{accounts.filter(a=>a.id!==form.fromId).map(option)}</select></label></div>
      {from&&<div className="pm-cash-transfer-summary"><div><span>{psAdminText('Köçürülə bilən balans','Aktarılabilir bakiye','Available balance')}</span><strong>{formatMoney(available)}</strong></div>{psCashFacts(from).map(([label,value])=><div key={label}><span>{label}</span><b>{value}</b></div>)}</div>}
      <div className="pm-cash-transfer-amount"><label>{psAdminText('Məbləğ (₼)','Tutar (₼)','Amount (₼)')}<input inputMode="decimal" value={form.value} disabled={busy} placeholder="0.00" onChange={event=>onChange({...form,value:event.target.value})}/></label><button type="button" className="ps-ops-button" disabled={busy||!from||available<=0} onClick={()=>onChange({...form,value:(available/100).toFixed(2)})}>{psAdminText('Hamısını köçür','Tümünü aktar','Transfer all')}</button></div>
      {amount>available&&from&&<p className="pm-cash-error" role="alert">{psAdminText('Məbləğ cari balansdan çoxdur.','Tutar güncel bakiyeyi aşıyor.','The amount exceeds the current balance.')}</p>}
      <label>{psAdminText('Qeyd','Not','Note')}<input value={form.note} disabled={busy} maxLength={500} onChange={event=>onChange({...form,note:event.target.value})}/></label>
      <p className="pm-cash-help">{psAdminText('Transfer cari balansdan edilir. Satış ödənişi kassada qalan pul və ya mənfəət deyil.','Transfer güncel bakiyeden yapılır. Satış ödemesi kasada kalan para veya kâr değildir.','Transfers use the current balance. Sales receipts are not remaining funds or profit.')}</p>
      {error&&<p className="pm-cash-error" role="alert">{error}</p>}
      <div className="pm-cash-dialog-actions"><button type="submit" className="ps-ops-button" disabled={busy||!valid}>{busy?psAdminText('Köçürülür…','Aktarılıyor…','Transferring…'):psAdminText('Transfer et','Transfer et','Transfer')}</button><button type="button" className="ps-ops-button" disabled={busy} onClick={onClose}>{psAdminText('İmtina','Vazgeç','Cancel')}</button></div>
    </form>
  </PsAdminDialog>;
}
function PsCashActivity({account,onClose}){
  const rg=usePsRange('day'),[query,setQuery]=reactExports.useState(''),[result,setResult]=reactExports.useState(null),[error,setError]=reactExports.useState(''),[retry,setRetry]=reactExports.useState(0);
  reactExports.useEffect(()=>{let live=true;setResult(null);setError('');void psErp('cashAccounts.moves',{accountId:account.id,from:rg.from,to:rg.to,includeSales:true}).then(r=>{if(!r.success)throw Error(r.error?.message||'Hərəkətlər alınmadı');if(live)setResult(r.data)}).catch(e=>{if(live)setError(e.message)});return()=>{live=false}},[account.id,rg.from,rg.to,retry]);
  const labels={opening:psAdminText('İlkin qalıq','Açılış bakiyesi','Opening balance'),sale:psAdminText('Satış ödənişi','Satış ödemesi','Sales receipt'),refund:psAdminText('Qaytarma','İade','Refund'),transfer:psAdminText('Transfer','Transfer','Transfer'),salary:psAdminText('Maaş','Maaş','Salary'),supplier:psAdminText('Təchizatçı ödənişi','Tedarikçi ödemesi','Supplier payment'),debt_in:psAdminText('Borc ödənişi','Borç ödemesi','Debt payment'),expense:psAdminText('Xərc','Gider','Expense'),cash_in:psAdminText('Mədaxil','Giriş','Cash in'),cash_out:psAdminText('Məxaric','Çıkış','Cash out'),float_adjust:psAdminText('Düzəliş','Düzeltme','Adjustment'),adjust:psAdminText('Düzəliş','Düzeltme','Adjustment'),correction:psAdminText('Qaimə düzəlişi','Belge düzeltmesi','Document correction')};
  const needle=query.trim().toLocaleLowerCase('az'),rows=(result?.moves||[]).filter(row=>!needle||[row.note,row.actorName,labels[row.kind]||row.kind].some(value=>String(value||'').toLocaleLowerCase('az').includes(needle)));
  return <section className="pm-cash-activity"><header><div><h2>{account.name} — {psAdminText('pul hərəkətləri','para hareketleri','money movements')}</h2><p>{psAdminText('Satış, qaytarma, transfer, maaş və digər pul giriş-çıxışları.','Satış, iade, transfer, maaş ve diğer para giriş-çıkışları.','Sales, refunds, transfers, salaries and other money in and out.')}</p></div><button type="button" className="ps-ops-button" onClick={onClose}>{psAdminText('Bağla','Kapat','Close')}</button></header>
    <div className="pm-cash-activity-tools">{psRangeBar(rg)}{psSearchBox(query,setQuery,psAdminText('Axtar: qeyd, növ və ya əməkdaş','Ara: not, tür veya çalışan','Search note, type or employee'))}</div>
    {error?<p className="pm-cash-error" role="alert">{error} <button type="button" className="ps-ops-button" onClick={()=>setRetry(v=>v+1)}>{psAdminText('Yenidən yoxla','Tekrar dene','Retry')}</button></p>:!result?<p role="status">{psAdminText('Yüklənir…','Yükleniyor…','Loading…')}</p>:<>
      {result.includesSales?<><dl className="pm-cash-activity-summary">{[[psAdminText('Dövrün əvvəli','Dönem başı','Period opening'),result.openingMinor],[psAdminText('Daxilolma','Giriş','Money in'),result.inMinor],[psAdminText('Çıxış','Çıkış','Money out'),result.outMinor],[psAdminText('Dövrün sonu','Dönem sonu','Period closing'),result.closingMinor]].map(([label,value])=><div key={label}><dt>{label}</dt><dd>{formatMoney(value||0)}</dd></div>)}</dl><p className="pm-cash-help">{psAdminText('Cəmlər seçilmiş dövrün bütün hərəkətlərinə aiddir. Axtarış yalnız siyahını süzür.','Toplamlar seçilen dönemin tüm hareketlerini kapsar. Arama yalnızca listeyi süzer.','Totals cover all movements in the selected period. Search filters the list only.')}</p></>:<p className="pm-cash-error">{psAdminText('Bu POS-un köhnə versiyası satışları siyahıya əlavə etmir. Tam hərəkətlər üçün POS-u yeniləyin.','Bu POS sürümü satışları listeye eklemiyor. Tüm hareketler için POS’u güncelleyin.','This older POS version omits sales. Update it to view all movements.')}</p>}
      {result.limited&&<p className="pm-cash-error">{psAdminText('İlk 5000 hərəkət göstərilir. Daha qısa tarix aralığı seçin.','İlk 5000 hareket gösteriliyor. Daha kısa tarih aralığı seçin.','Showing the first 5,000 movements. Choose a shorter date range.')}</p>}
      <OpsTable head={[psAdminText('Tarix','Tarih','Date'),psAdminText('Növ','Tür','Type'),psAdminText('Məbləğ','Tutar','Amount'),psAdminText('Qeyd / qaimə','Not / belge','Note / document'),psAdminText('Əməkdaş','Çalışan','Employee')]} empty={psAdminText('Bu dövrdə hərəkət yoxdur','Bu dönemde hareket yok','No movements in this period')} rows={rows.map(row=>[opsWhen(row.createdAt),labels[row.kind]||row.kind,<b className={(row.amountMinor||0)<0?'pm-cash-out':'pm-cash-in'}>{(row.amountMinor||0)<0?'−':'+'}{formatMoney(Math.abs(row.amountMinor||0))}</b>,row.note||'—',row.actorName||'—'])}/>
    </>}
  </section>;
}
