import Link from "next/link";
import { db } from "@/lib/db";
import { getProductBySku } from "@/lib/api/catalog";
import { getProductAvailability } from "@/lib/product-availability";
import { importWishlistRestockAlerts } from "@/lib/email/restock";
import { Card, CardTitle } from "./card";
import { DataTable } from "./data-table";
import { RestockSendButton } from "./restock-send-button";
export async function RestockSegments() {
  await importWishlistRestockAlerts();
  const groups = await db.restockSubscription.groupBy({ by: ["productId", "status"], _count: { _all: true, userId: true }, orderBy: { productId: "asc" } });
  const ids = [...new Set(groups.map((row) => row.productId))];
  const products = await db.product.findMany({ where: { id: { in: ids } }, select: { id: true, sku: true, name: true } });
  const rows = await Promise.all(products.map(async (product) => {
    const counts = Object.fromEntries(groups.filter((g) => g.productId === product.id).map((g) => [g.status, g._count._all]));
    const registered = groups.filter((g) => g.productId === product.id && g.status === "PENDING").reduce((sum, g) => sum + g._count.userId, 0);
    const dto = await getProductBySku(product.sku);
    const available = Boolean(dto && getProductAvailability(dto).canAddToCart);
    return { id: product.id, cells: {
      product: <><Link href={`/admin/erp/artikli?search=${encodeURIComponent(product.sku)}`} className="font-medium text-walnut">{product.name}</Link><p className="text-xs text-ink-500">{product.sku} · tag: interest:{product.sku}</p></>,
      availability: available ? "Dostupno" : "Nije dostupno",
      waiting: <>{counts.PENDING ?? 0}<p className="text-xs text-ink-500">{registered} naloga · {(counts.PENDING ?? 0) - registered} gostiju</p></>, sent: counts.SENT ?? 0,
      review: (counts.REVIEW ?? 0) + (counts.SENDING ?? 0),
      send: <RestockSendButton productId={product.id} disabled={!available || !counts.PENDING} />,
    } };
  }));
  return <Card><CardTitle description="Gosti, prijavljeni kupci i postojeće liste želja, grupisani po artiklu. Automatska provera radi na svakih pet minuta. Ručno slanje koristi isti zapis i preskače već obaveštene kupce.">Zainteresovani za artikal</CardTitle>
    <p className="mb-4 text-xs text-ink-500">Postojeći newsletter kontakti dobijaju interest:šifra tag kada se prijave. Taj tag možete koristiti u filteru „Tag” za newsletter publiku. Lista čekanja uključuje i ljude koji su pristali samo na obaveštenje o ovom artiklu. „Za proveru” označava nezavršen pokušaj slanja; ne šaljemo ga ponovo naslepo.</p>
    <DataTable columns={[{ key: "product", label: "Artikal" }, { key: "availability", label: "Dostupnost" }, { key: "waiting", label: "Čeka", align: "right" }, { key: "sent", label: "Poslato", align: "right" }, { key: "review", label: "Za proveru", align: "right" }, { key: "send", label: "Obaveštenje" }]} rows={rows} />
  </Card>;
}
