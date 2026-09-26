import Link from "next/link";
import { db } from "@/lib/db";
import { ananasOrdersHealth } from "@/lib/ananas/orders-health";

export async function AnanasOrdersHealth({ from, to }: { from: string; to: string }) {
  const select = { status: true, startedAt: true, to: true, finishedAt: true } as const;
  const [latest, successful] = await Promise.all([
    db.ananasSyncRun.findFirst({ where: { source: "ORDERS_AUTO" }, orderBy: { startedAt: "desc" }, select }),
    db.ananasSyncRun.findFirst({ where: { source: "ORDERS_AUTO", status: "SUCCESS" }, orderBy: { to: "desc" }, select }),
  ]);
  const health = ananasOrdersHealth(latest, successful);
  return <div role={health.delayed ? "status" : undefined} className={`rounded-lg border px-4 py-3 text-sm ${health.delayed ? "border-amber-300 bg-amber-50 text-amber-950" : "border-border/60 text-ink-500"}`}>
    <p>{health.delayed ? "Ananas porudžbine: preuzimanje kasni ili nije završeno. Prikazani brojevi mogu biti nepotpuni." : "Ananas porudžbine se automatski preuzimaju na 15 minuta."}</p>
    <p className="mt-1">{health.updatedAt ? `Poslednje uspešno preuzimanje: ${health.updatedAt.toLocaleString("sr-Latn-RS", { timeZone: "Europe/Belgrade" })}. ` : "Još nema uspešnog automatskog preuzimanja. "}
      <Link className="font-medium underline" href={`/admin/erp/ananas?view=orders&from=${from}&to=${to}`}>Porudžbine i status preuzimanja →</Link>
    </p>
  </div>;
}
