// Fixed column budgets keep customer-entered text from pushing financial actions offscreen.
function PsDeliveryTable({head, rows, empty}) {
  const label = (value,index) => typeof value==='string' ? value || 'Əməliyyat' : index===0 ? 'Seç' : '';
  const width = value => ({'Seç':'42px','Qaimə':'124px','Vaxt':'110px','Kuryer':'100px','Məbləğ':'102px','Əməliyyat':'132px','Vəziyyət':'132px'})[value];
  return <div className="pm-delivery-table">
    <table>
      <colgroup>{head.map((value,index)=><col key={index} style={{width:width(label(value,index))}}/>)}</colgroup>
      <thead><tr>{head.map((value,index)=><th key={index} scope="col">{value || <span className="sr-only">Əməliyyat</span>}</th>)}</tr></thead>
      <tbody>{rows.length ? rows.map((row,index)=><tr key={index}>{row.map((cell,column)=><td key={column} data-label={label(head[column],column)}><div className="pm-delivery-cell">{cell}</div></td>)}</tr>) : <tr><td colSpan={head.length} className="pm-delivery-empty">{empty}</td></tr>}</tbody>
    </table>
  </div>;
}
