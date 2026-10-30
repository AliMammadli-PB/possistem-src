import ts from 'typescript';
// Applied to both remote products only; local operation pages keep their existing lifecycle.
export function patchRetainedBranchPages(source){
 const start=source.indexOf('function OperationsPage()'),end=source.indexOf('/* POS_ADMIN_COMPONENTS_START */',start);
 if(start<0||end<0)throw Error('Remote operations page missing');
 const helper=`
const PsBranchPageContext=reactExports.createContext(null);
function usePsBranchReload(reload){
 const context=reactExports.useContext(PsBranchPageContext),latest=reactExports.useRef(reload),seen=reactExports.useRef(context?.revision);
 latest.current=reload;
 reactExports.useEffect(()=>{if(context?.active&&seen.current!==context.revision){seen.current=context.revision;void latest.current();}},[context?.active,context?.revision]);
}
function PsBranchPages({tabs,active}){
 const [visited,setVisited]=reactExports.useState([active]),[revision,setRevision]=reactExports.useState(window.__psBranchCache?.version||0);
 reactExports.useEffect(()=>{setVisited(old=>old.includes(active)?old:[...old,active]);window.__psBranchCache?.refreshIfStale();},[active]);
 reactExports.useEffect(()=>{const update=()=>setRevision(window.__psBranchCache?.version||0);window.addEventListener('ps:branch-data',update);
 const timer=setInterval(()=>{if(!document.hidden&&window.frameElement?.getClientRects().length&&!Array.from(document.querySelectorAll('[role="dialog"],dialog[open]')).some(e=>e.getClientRects().length))window.__psBranchCache?.refresh();},60000);
 return()=>{clearInterval(timer);window.removeEventListener('ps:branch-data',update);};},[]);
 const lang=new URLSearchParams(location.search).get('lang'),label=lang==='ru'?'Обновить данные':lang==='en'?'Refresh data':lang==='tr'?'Verileri yenile':'Məlumatları yenilə';
 return jsxRuntimeExports.jsxs('div',{children:[jsxRuntimeExports.jsx('div',{style:{display:'flex',justifyContent:'flex-end',marginBottom:12},children:jsxRuntimeExports.jsx('button',{type:'button',className:'ps-branch-refresh',style:{minHeight:48,padding:'10px 18px',border:'1px solid #bfd2ec',borderRadius:12},onClick:()=>window.__psBranchCache?.refresh(),children:label})}),
 ...tabs.filter(t=>visited.includes(t.id)||t.id===active).map(t=>jsxRuntimeExports.jsx('div',{hidden:t.id!==active,'data-branch-tab':t.id,children:jsxRuntimeExports.jsx(PsBranchPageContext.Provider,{value:{active:t.id===active,revision},children:t.render()})},t.id))]});
}
`;
 let page=source.slice(start,end),needle='children: current?.render()';
 if(!page.includes(needle))throw Error('Remote page render needle missing');
 page=page.replace(needle,'children: jsxRuntimeExports.jsx(PsBranchPages,{tabs,active})');
 source=source.slice(0,start)+helper+page+source.slice(end);
 // A retained menu must refresh after another tab changes a name, price or recipe.
 source=source.replace('  const [showGallery, setShowGallery]', '  const reloadMenu=reactExports.useCallback(()=>loadProducts(categoryId),[categoryId]);usePsBranchReload(reloadMenu);\n  const [showGallery, setShowGallery]');
 // Each page and its shared option lists refresh only while active, retaining filters and editors.
 source=source.replaceAll('reactExports.useEffect(() => { void reload(); }, [reload]);','reactExports.useEffect(() => { void reload(); }, [reload]); usePsBranchReload(reload);');
 source=source.replace('reactExports.useEffect(() => { void reload(); return () => { ++requestSeq.current; }; }, [reload]);','reactExports.useEffect(() => { void reload(); return () => { ++requestSeq.current; }; }, [reload]); usePsBranchReload(reload);');
 source=source.replace('reactExports.useEffect(() => { void reload(); void window.pos.inventory.warehouses()', 'usePsBranchReload(reload); reactExports.useEffect(() => { void reload(); void window.pos.inventory.warehouses()');
 source=source.replace(/reactExports\.useEffect\(\(\)=>\{void reload\(\);?\},\[reload\]\);/g,'$&usePsBranchReload(reload);');
 const accountsStart=source.indexOf('function usePsAccounts()'),accountsEnd=source.indexOf('\nfunction ',accountsStart+1);
 if(accountsStart<0||accountsEnd<0)throw Error('Remote accounts hook missing');
 source=source.slice(0,accountsStart)+`function usePsAccounts(){const [data,setData]=reactExports.useState(_psAccountsCache);const reload=reactExports.useCallback(async()=>{const [from,to]=psToday();const r=await window.pos.cashAccounts.list(from,to);if(r.success){_psAccountsCache=r.data;setData(r.data);}},[]);reactExports.useEffect(()=>{void reload();},[reload]);usePsBranchReload(reload);return data;}\n`+source.slice(accountsEnd);
 // Existing page refresh/retry buttons must bypass cached reads too.
 source=source.replaceAll('onClick: () => void reload()', 'onClick: () => {window.__psBranchCache?.refresh();void reload();}');
 source=source.replaceAll('onClick:()=>void reload()', 'onClick:()=>{window.__psBranchCache?.refresh();void reload();}');
 // Fail packaging rather than silently shipping one page that never refreshes.
 for(const name of ['OpsSales','OpsStock','OpsGoods','OpsStocktake','OpsPurchases','OpsPartners','OpsKassalar','PsOriginalSalary','OpsExpenses','OpsIncome','PsDocuments']){
  const a=source.indexOf('function '+name+'('),b=source.indexOf('\nfunction ',a+1),part=source.slice(a,b);
  if(a<0||!part.includes('usePsBranchReload(reload)'))throw Error('Remote refresh hook missing: '+name);
 }
 // Never remove a populated stock page (and its editor) during a background refresh.
 source=source.replace('if (loading || loadError) return jsxRuntimeExports.jsx(PsOpsLoadState','if ((loading && !levels.length) || loadError) return jsxRuntimeExports.jsx(PsOpsLoadState');
 // Remote workspaces authenticate through their parent/API. The desktop
 // payment screen must not request its local billing IPC from a browser frame.
 // No native access policy or server authorization is changed here.
 const ast=ts.createSourceFile('remote.js',source,99,true),boundary=ast.statements.find(n=>ts.isFunctionDeclaration(n)&&n.name?.text==='PsSubscriptionBoundary');
 if(boundary)source=source.slice(0,boundary.getStart(ast))+'function PsSubscriptionBoundary({children}){return children;}'+source.slice(boundary.end);
 return source+'\n// POS_BRANCH_RETAINED_PAGES_1538\n';
}
