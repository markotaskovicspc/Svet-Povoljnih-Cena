import Link from "next/link";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { getPickingBatchProgress, pickingLinesQuery } from "@/lib/admin/picking.server";

export const dynamic = "force-dynamic";
export const metadata = { title: "Magacin · Picking", robots: { index: false, follow: false } };
export default async function WarehousePicking({ searchParams }: { searchParams: Promise<{ q?: string; forbidden?: string }> }) {
  await requireAdminAction(["OPS", "WAREHOUSE"]);
  const { q: rawQuery, forbidden } = await searchParams;
  const q = rawQuery?.trim().slice(0, 100) ?? "";
  const batches = await db.pickupBatch.findMany({
    where: { status: "DRAFT", labelsCreationStartedAt: null, labelsCreatedAt: null, ...(q ? { number: { contains: q, mode: "insensitive" } } : {}) },
    orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 100,
    select: { id: true, number: true, createdAt: true, _count: { select: { lines: true } }, lines: pickingLinesQuery },
  });
  const progress = await getPickingBatchProgress(batches);
  return <main className="space-y-5 p-4 sm:p-6">
    {forbidden && <p role="alert" className="rounded-lg border border-warning/30 p-3 text-sm">Vaš nalog ima pristup samo pickingu i povratima.</p>}
    <div><h1 className="text-xl font-semibold">Odvajanje robe</h1><p className="mt-1 text-sm text-ink-500">Otvorite nalog, pronađite robu i potvrdite količinu.</p></div>
    <form className="flex gap-2"><label className="min-w-0 flex-1"><span className="sr-only">Broj picking naloga</span><input name="q" defaultValue={q} placeholder="Pretraži broj naloga" className="w-full rounded-lg border bg-surface px-3 py-3" /></label><button className="rounded-lg border bg-surface px-4">Traži</button></form>
    <p className="text-sm text-ink-500">Nalozi za rad: {batches.length}{batches.length === 100 ? " (prvih 100)" : ""}</p>
    <div className="space-y-3">{batches.map(batch => {
      const state = progress.get(batch.id)!;
      const color = state.status === "complete" ? "border-emerald-300 bg-emerald-50 text-emerald-950" : state.status === "partial" ? "border-amber-400 bg-amber-50 text-amber-950" : "border-border bg-surface";
      return <Link key={batch.id} href={`/admin/magacin/picking/${batch.id}`} className={`flex min-h-20 items-center justify-between gap-3 rounded-xl border p-4 active:opacity-80 ${color}`}>
      <div className="min-w-0"><h2 className="break-words text-lg font-semibold">{batch.number}</h2><p className="mt-1 text-sm text-ink-500">{batch._count.lines} stavki · {batch.createdAt.toLocaleDateString("sr-Latn-RS", { timeZone: "Europe/Belgrade" })}</p><p className="mt-2 text-sm font-semibold">{state.status === "complete" ? "✓ Potpuno odvojeno" : state.status === "partial" ? "Delimično odvojeno" : "Odvajanje nije započeto"} · {state.done} / {state.total} kom.</p></div><span className="shrink-0 rounded-lg bg-foreground px-3 py-2 text-sm text-background">Otvori →</span>
    </Link>; })}</div>
    {!batches.length && <p className="rounded-xl border bg-surface p-8 text-center text-ink-500">{q ? "Nema naloga sa tim brojem." : "Trenutno nema naloga za odvajanje."}</p>}
  </main>;
}
