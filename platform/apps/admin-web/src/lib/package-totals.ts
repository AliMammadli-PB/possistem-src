export type Billing = 'monthly' | 'one_time';
export type PricedLine = { priceMinor: number; quantity: number; billing?: Billing };
export function packageTotals(lines: PricedLine[]) {
  let monthlyMinor=0,oneTimeMinor=0;
  for(const line of lines){
    const amount=line.priceMinor*line.quantity;
    if(line.billing==='one_time')oneTimeMinor+=amount;
    else monthlyMinor+=amount;
  }
  return {monthlyMinor,oneTimeMinor,firstPaymentMinor:monthlyMinor+oneTimeMinor};
}
