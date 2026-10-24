export type ErpSource = 'stock' | 'documents' | 'sales' | 'returns' | 'orders' | 'customers' | 'points' | 'suppliers' | 'purchases' | 'payments' | 'debts' | 'transfers' | 'cash' | 'daily' | 'turnover';

export type ErpItem = {
  key: string;
  label: string;
  source: ErpSource;
  fields: string;
};

export const ERP_MENU: Array<{ label: string; items: ErpItem[] }> = [
  {
    label: 'Məhsullar',
    items: [
      { key: 'product', label: 'Məhsul və Xidmətlər', source: 'stock', fields: 'Ad, barkod, qrup, vahid, anbar, qalıq, satış qiyməti' },
      { key: 'enter', label: 'Daxilolmalar', source: 'documents', fields: 'Qəbul sənədləri və POS təsdiqi' },
      { key: 'loss', label: 'Silinmələr', source: 'documents', fields: 'Silinmə sənədləri və POS təsdiqi' },
      { key: 'move', label: 'Yerdəyişmələr', source: 'documents', fields: 'Anbarlararası hərəkət sənədləri' },
      { key: 'inventory', label: 'İnventarizasiyalar', source: 'documents', fields: 'Sayım sənədləri və POS təsdiqi' },
      { key: 'stock', label: 'Anbar qalığı', source: 'stock', fields: 'Məhsul, anbar, ümumi qalıq, satış qiyməti' },
    ],
  },
  {
    label: 'Alışlar',
    items: [
      { key: 'supply', label: 'Alışlar', source: 'purchases', fields: 'Təchizatçı, status, məbləğ, tarix' },
      { key: 'purchaseorder', label: 'Sifarişlər', source: 'purchases', fields: 'Alış sifarişi, status, məbləğ, tarix' },
    ],
  },
  {
    label: 'Satışlar',
    items: [
      { key: 'demand', label: 'Satışlar', source: 'sales', fields: 'Satış №, məbləğ, tarix' },
      { key: 'demandreturns', label: 'Satışların geriqaytarması', source: 'returns', fields: 'Qaytarma №, məbləğ, tarix' },
      { key: 'customerorders', label: 'Sifarişlər', source: 'orders', fields: 'Sifariş, sətir sayı, tarix' },
    ],
  },
  {
    label: 'Tərəf-Müqabillər',
    items: [
      { key: 'customer', label: 'Tərəf-Müqabillər', source: 'customers', fields: 'Ad' },
    ],
  },
  {
    label: 'Maliyyə',
    items: [
      { key: 'transactions', label: 'Ödənişlər', source: 'payments', fields: 'POS ödəniş sənədləri' },
      { key: 'settlements', label: 'Borclar', source: 'debts', fields: 'Müştəri və təchizatçı üzrə qalıq' },
      { key: 'cashtransactions', label: 'Transferlər', source: 'transfers', fields: 'Hesablararası transfer sənədləri' },
    ],
  },
  {
    label: 'Pərakəndə',
    items: [
      { key: 'shifts', label: 'Növbələr', source: 'points', fields: 'Nöqtə, vəziyyət' },
      { key: 'retailsales', label: 'Satışlar', source: 'sales', fields: 'Satış №, məbləğ, tarix' },
      { key: 'retailreturns', label: 'Qaytarmalar', source: 'returns', fields: 'Qaytarma №, məbləğ, tarix' },
      { key: 'credittransaction', label: 'Kredit ödənişləri', source: 'payments', fields: 'Müştəri borc ödənişləri və POS təsdiqi' },
      { key: 'cashins', label: 'Kassa mədaxillər', source: 'cash', fields: 'Kassa mədaxil sənədləri' },
      { key: 'cashouts', label: 'Kassa məxariclər', source: 'cash', fields: 'Kassa məxaric sənədləri' },
      { key: 'salepoints', label: 'Satış nöqtələri', source: 'points', fields: 'Nöqtə, vəziyyət' },
    ],
  },
  {
    label: 'Hesabatlar',
    items: [
      { key: 'salereports', label: 'Mənfəət', source: 'daily', fields: 'Satış, maya fərqi' },
      { key: 'profit', label: 'Mənfəət və ya Zərər', source: 'daily', fields: 'Günlük mənfəət' },
      { key: 'dailyreports', label: 'Gündəlik hesabat', source: 'daily', fields: 'Satış, nağd, kart, say' },
      { key: 'producttransactions', label: 'Dövriyyə', source: 'turnover', fields: 'Məhsul, miqdar, məbləğ' },
      { key: 'comprehensive', label: 'Təchizatçılar hesabatı', source: 'suppliers', fields: 'Təchizatçı, status, sətir' },
      { key: 'cashes', label: 'Hesablar', source: 'cash', fields: 'Kassa hərəkətləri' },
      { key: 'stockbalance', label: 'Anbar qalığı', source: 'stock', fields: 'Məhsul, anbar, qalıq, satış qiyməti' },
    ],
  },
];

export function erpItem(key: string | undefined) {
  if (!key) return null;
  for (const group of ERP_MENU) {
    const item = group.items.find((row) => row.key === key);
    if (item) return { group: group.label, ...item };
  }
  return null;
}
