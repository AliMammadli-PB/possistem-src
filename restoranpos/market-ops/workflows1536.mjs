export function patchMarket1536(source){
 if(source.includes('POS_MARKET_WORKFLOWS_1536'))return source;
 const terms={'Obyektlər':'Filiallar','obyektlər':'filiallar','Obyektdən':'Filialdan','obyektdən':'filialdan','Obyektə':'Filiala','obyektə':'filiala','Obyektdə':'Filialda','obyektdə':'filialda','Obyektin':'Filialın','obyektin':'filialın','Obyekt':'Filial','obyekt':'filial','Объект':'Филиал','объект':'филиал'};
 for(const [from,to] of Object.entries(terms))source=source.replaceAll(from,to);
 return source+'\n// POS_MARKET_WORKFLOWS_1536\n';
}
