import Link from "next/link";
import { db } from "@/lib/db";
import { PICKUP_BATCH_STATUS_LABEL } from "@/lib/admin/pickup-batch";

export async function OrderPickupLinks({ orderId }: { orderId: string }) {
  const batches = await db.pickupBatch.findMany({
    where: { lines: { some: { orderId, purpose: "ORDER_DELIVERY" } } },
    select: { id: true, number: true, status: true },
    orderBy: { createdAt: "desc" },
  });
  return (
    <section className="mb-4 rounded-xl border border-border bg-white p-4">
      <h2 className="font-semibold">Picking / nalozi za preuzimanje</h2>
      {batches.length ? <ul className="mt-2 space-y-1 text-sm">
        {batches.map((batch) => <li key={batch.id}>
          <Link href={`/admin/erp/preuzimanja/${batch.id}`} className="font-medium text-walnut hover:underline">{batch.number}</Link>
          {" · "}{PICKUP_BATCH_STATUS_LABEL[batch.status]}
        </li>)}
      </ul> : <p className="mt-2 text-sm text-ink-500">Porudžbina još nije učitana ni u jedan picking nalog.</p>}
    </section>
  );
}
