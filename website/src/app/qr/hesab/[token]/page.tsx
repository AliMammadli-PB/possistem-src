import { notFound } from "next/navigation";
import { TableBillPayment } from "@/components/qr/TableBillPayment";
export const metadata = {
  title: "Masa hesabı",
  robots: { index: false, follow: false },
  referrer: "no-referrer" as const,
};
export default async function Page({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!/^[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(token)) notFound();
  return <TableBillPayment token={token} />;
}
