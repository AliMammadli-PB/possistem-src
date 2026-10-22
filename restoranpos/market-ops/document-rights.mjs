import ts from 'typescript';
/** Disable each financial action by its independent Market grant. Product
 * editors keep stock permissions; all writes are checked again by main. */
export function patchDocumentRights(source) {
 const tree=ts.createSourceFile('market.js',source,ts.ScriptTarget.Latest,true,ts.ScriptKind.JS),changes=[];
 const scopes=new Set(['OpsPurchases','OpsExpenses','OpsIncome','PsOriginalSalary']);
 const visit=(node,scope='')=>{
  if(ts.isFunctionDeclaration(node))scope=node.name?.text||'';
  if(scopes.has(scope)&&ts.isCallExpression(node)&&node.expression.getText(tree)==='jsxRuntimeExports.jsx'&&node.arguments[0]?.getText(tree)==='OpsButton'&&ts.isObjectLiteralExpression(node.arguments[1])){
   const obj=node.arguments[1],property=name=>obj.properties.find(p=>ts.isPropertyAssignment(p)&&p.name.getText(tree)===name),children=property('children');
   if(children){const text=children.initializer.getText(tree);let grant='';
    if(/Düzəliş|Düzenle|Edit/.test(text))grant='"canDocsEdit"';
    else if(/Sil|Ləğv et|Delete|Cancel/.test(text))grant='"canDocsDelete"';
    else if(/\+|Ödə|Təsdiq et|Yadda saxla|Yalnız sifariş/.test(text)){
     grant='"canDocsCreate"';
     if(/invoice\.editId/.test(text))grant='invoice.editId ? "canDocsEdit" : "canDocsCreate"';
     else if(/ret\.editId/.test(text))grant='ret.editId ? "canDocsEdit" : "canDocsCreate"';
     else if(scope==='OpsIncome')grant='form?.id ? "canDocsEdit" : "canDocsCreate"';
    }
    if(grant){const disabled=property('disabled'),guard='!(window.__psMarketRights || {})['+grant+']';if(disabled)changes.push({a:disabled.initializer.getStart(tree),b:disabled.initializer.end,text:'('+disabled.initializer.getText(tree)+') || '+guard});else changes.push({a:obj.getStart(tree)+1,b:obj.getStart(tree)+1,text:' disabled: '+guard+','});}
   }
  }
  ts.forEachChild(node,child=>visit(child,scope));
 };
 visit(tree);if(changes.length<8)throw Error('Financial UI permission actions missing ('+changes.length+')');
 for(const change of changes.sort((a,b)=>b.a-a.a))source=source.slice(0,change.a)+change.text+source.slice(change.b);
 return source;
}
