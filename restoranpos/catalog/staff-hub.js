function PsStaffHub(){
 const h=psH,has=useAuthStore(s=>s.hasPermission),location=useLocation();
 const tabs=[
  {id:'people',label:'İşçi siyahısı',allowed:has('users.manage'),component:PsStaffPage},
  {id:'scope',label:'Obyekt və maaş təyinatı',allowed:has('users.manage'),component:PsStaffScope},
  {id:'salary',label:'Maaş ödənişləri',allowed:has('salary.manage'),component:OpsSalary},
  {id:'roles',label:'Səlahiyyətlər',allowed:has('roles.manage'),component:RolePermissionsPanel}
 ].filter(t=>t.allowed);
 const [picked,setPicked]=reactExports.useState(()=>new URLSearchParams(location.search).get('tab')==='salary'?'salary':'people');
 const current=tabs.find(t=>t.id===picked)||tabs[0];
 if(!current)return h('p',{role:'alert'},'İşçilər bölməsi üçün səlahiyyətiniz yoxdur.');
 return h('div',{className:'ps-staff-hub'},
  location.pathname==='/admin/staff'?h('header',null,h('h1',null,'İşçilər'),h('p',null,'Giriş hesabı, obyekt təyinatı və maaşları buradan idarə edin.')):null,
  h('nav',{'aria-label':'İşçilər bölmələri',className:'ps-staff-tabs'},tabs.map(t=>h('button',{key:t.id,type:'button','aria-pressed':t.id===current.id,onClick:()=>setPicked(t.id)},t.label))),
  jsxRuntimeExports.jsx(current.component,{},current.id));
}
