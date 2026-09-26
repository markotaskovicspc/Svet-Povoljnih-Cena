import Link from "next/link";
import { requireAdminAction } from "@/lib/admin";
import { db } from "@/lib/db";
import { pickingLayout } from "@/lib/admin/picking-plan";
import { PageHeader } from "@/components/admin/page-header";
import { AdminActionForm } from "@/components/admin/action-form";
import { SubmitButton } from "@/components/admin/submit-button";
import { savePosition } from "./actions";
import styles from "./picking-map.module.css";
export const dynamic = "force-dynamic";
export default async function PickingPositionsPage({ searchParams }: { searchParams: Promise<{ warehouse?: string; position?: string; q?: string }> }) {
  await requireAdminAction(["OPS"]);
  const params = await searchParams;
  const warehouses = await db.warehouse.findMany({ where: { active: true }, orderBy: [{ isDefault: "desc" }, { name: "asc" }] });
  const warehouse = warehouses.find(w => w.id === params.warehouse) ?? warehouses[0];
  const suppliers = await db.supplier.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } });
  const positions = warehouse ? await db.warehousePickingPosition.findMany({ where: { warehouseId: warehouse.id } }) : [];
  const selected = Math.max(1, Math.min(240, Number(params.position) || 1));
  const position = positions.find(p => p.number === selected);
  const q = (params.q ?? "").trim().toLocaleLowerCase("sr");
  const occupied = positions.filter(p => p.skus.length || p.supplierIds.length).length;
  return <>
    <PageHeader title="Picking pozicije" description="Raspored 240 pozicija prema skici magacina. Izaberite poziciju za dodelu artikala i dobavljača." />
    <div className="space-y-6 p-4 md:p-8">
      <form className="flex flex-wrap gap-3">
        <label>Magacin<select name="warehouse" defaultValue={warehouse?.id} className="ml-2 rounded border p-2">{warehouses.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}</select></label>
        <input name="q" defaultValue={params.q} aria-label="Šifra, dobavljač ili napomena" placeholder="Šifra, dobavljač ili napomena" className="rounded border p-2" />
        <button className="rounded bg-foreground px-4 py-2 text-background">Prikaži</button>
      </form>
      <p className="text-sm text-muted-foreground">{occupied} / 240 popunjenih pozicija. Svaki magacin ima zasebne dodele. Više šifara i dobavljača može deliti poziciju; konkretna šifra ima prednost nad opštom dodelom dobavljača. Ovo je raspored robe, ne evidencija količina na lageru.</p>
      <div className={styles.viewport} role="region" aria-label="Skica magacina sa picking pozicijama" tabIndex={0}>
        <div className={styles.floorplan}>
          {pickingLayout.map((blocks, r) => <div key={r} className={styles.row} style={{ gridRow: 2 + r * 2 }}>{blocks.map((block, b) => <div key={b} className={styles.shelf} style={{ gridColumn: b === 0 ? 1 : 3 }}>{block.map(n => {
            const entry = positions.find(p => p.number === n);
            const supplierNames = suppliers.filter(s => entry?.supplierIds.includes(s.id)).map(s => s.name);
            const assigned = !!(entry?.skus.length || entry?.supplierIds.length);
            const match = !q || [String(n), ...(entry?.skus ?? []), ...supplierNames, entry?.note ?? ""].some(v => v.toLocaleLowerCase("sr").includes(q));
            return <Link key={n} href={`?warehouse=${warehouse?.id ?? ""}&position=${n}&q=${encodeURIComponent(params.q ?? "")}#position-editor`} title={[...(entry?.skus ?? []), ...supplierNames].join(", ") || "Prazna pozicija"} aria-label={`Pozicija ${n}${assigned ? ", popunjena" : ", prazna"}`} aria-current={selected === n ? "location" : undefined} className={`${styles.position} ${assigned ? styles.assigned : ""} ${selected === n ? styles.selected : ""} ${match ? "" : styles.dimmed}`}>{n}</Link>;
          })}</div>)}</div>)}
        </div>
      </div>
      {warehouse && <section id="position-editor" className="max-w-3xl rounded-xl border p-5">
        <h2 className="mb-4 text-xl font-semibold">Pozicija {selected} · {warehouse.name}</h2>
        <AdminActionForm key={`${warehouse.id}:${selected}`} action={savePosition} className="space-y-4">
          <input type="hidden" name="warehouseId" value={warehouse.id} /><input type="hidden" name="number" value={selected} /><input type="hidden" name="version" value={position?.updatedAt.toISOString() ?? ""} />
          <label className="block">Šifre artikala <span className="text-sm text-muted-foreground">(svaka u novom redu ili odvojena zarezom)</span><textarea name="skus" rows={4} defaultValue={position?.skus.join("\n")} className="mt-1 w-full rounded border p-3" /></label>
          <label className="block">Dobavljači<select name="supplierIds" multiple size={6} defaultValue={position?.supplierIds ?? []} className="mt-1 w-full rounded border p-2">{suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select><span className="text-sm text-muted-foreground">Ctrl / Cmd za izbor više dobavljača ili uklanjanje izbora.</span></label>
          <label className="block">Redosled obilaska<input name="routeOrder" type="number" min={1} max={10000} required defaultValue={position?.routeOrder ?? selected} className="ml-3 w-28 rounded border p-2" /></label>
          <p className="text-sm text-muted-foreground">Početni redosled je 1–240. Prilagodite ga početku obilaska i mestu pakovanja; numeracija na skici ostaje ista.</p>
          <label className="block">Napomena<textarea name="note" maxLength={1000} defaultValue={position?.note ?? ""} className="mt-1 w-full rounded border p-2" /></label>
          <SubmitButton>Sačuvaj poziciju</SubmitButton>
        </AdminActionForm>
      </section>}
    </div>
  </>;
}
