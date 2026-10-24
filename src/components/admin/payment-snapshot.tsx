import { z } from "zod";
import { Card, CardTitle } from "@/components/admin/card";

const snapshotSchema = z.object({
  version: z.literal(1), currency: z.string(), capturedAt: z.string(),
  totalAmount: z.string(), totalRsd: z.string(),
  payments: z.array(z.object({ id: z.string(), paidAt: z.string(),
    amount: z.string(), amountRsd: z.string(), notes: z.string().nullable() })),
});

export function PaymentSnapshotCard({ value }: { value: unknown }) {
  const result = snapshotSchema.safeParse(value);
  if (!result.success) return null;
  const snapshot = result.data;
  const money = (value: string) => Number(value).toLocaleString("sr-Latn-RS", {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
  return <Card>
    <CardTitle description="Uplate zabeležene pri poslednjem preuzimanju zbira. Kasnije uplate ne menjaju ovaj obračun.">Preuzete uplate</CardTitle>
    <ul className="space-y-2 text-sm">{snapshot.payments.map((payment) =>
      <li key={payment.id}>{payment.paidAt} · {money(payment.amount)} {snapshot.currency} · {money(payment.amountRsd)} RSD{payment.notes ? " · " + payment.notes : ""}</li>)}</ul>
    <p className="mt-3 font-medium">Preuzeti zbir: {money(snapshot.totalAmount)} {snapshot.currency} · {money(snapshot.totalRsd)} RSD</p>
  </Card>;
}
