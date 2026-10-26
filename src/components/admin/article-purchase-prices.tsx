import Link from "next/link";
import { db } from "@/lib/db";
import { requireAdminAction } from "@/lib/admin";
import { canAccessAdminModule } from "@/lib/admin/access-policy";
import { allowedRolesForErpModule } from "@/lib/admin/erp-access";
import { PURCHASE_PRICE_MAX } from "@/lib/admin/purchase-price";
import { addArticlePurchasePrice } from "@/app/admin/erp/artikli/[id]/purchase-price-actions";
import { AdminActionForm } from "./action-form";
import { Card, CardTitle } from "./card";
import { Field } from "./field";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "./submit-button";

export async function ArticlePurchasePrices({ productId }: { productId: string }) {
  const admin = await requireAdminAction(["CONTENT", "OPS"], "/admin/erp/nabavne-cene");
  // The article card is also available to CONTENT; purchasing permissions stay
  // identical to the existing purchase-price module.
  if (!canAccessAdminModule(admin, "/admin/erp/nabavne-cene", allowedRolesForErpModule("nabavne-cene"))) return null;
  const [product, prices] = await Promise.all([
    db.product.findUnique({ where: { id: productId, deletedAt: null }, select: {
      id: true, sku: true, supplier: { select: { name: true, currency: true, parity: true } },
    } }),
    db.purchasePrice.findMany({ where: { productId }, orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }], take: 100,
      select: { id: true, price: true, currency: true, parity: true, validFrom: true, validTo: true,
        supplier: { select: { name: true } } } }),
  ]);
  if (!product) return null;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Belgrade", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  return <Card id="nabavne-cene">
    <CardTitle description="Unesite novu cenu sa datumom važenja. Prethodni period se automatski zatvara; postojeće cene ostaju u istoriji.">
      Nabavne cene
    </CardTitle>
    {product.supplier ? <>
      <p className="mb-4 text-sm text-ink-600">{product.sku} · {product.supplier.name} · {product.supplier.currency} · {product.supplier.parity || "Paritet nije unet"}</p>
      <AdminActionForm action={addArticlePurchasePrice.bind(null, product.id)} refreshOnSuccess className="grid items-end gap-3 sm:grid-cols-2 xl:grid-cols-4" testId="article-purchase-price-form">
        <Field label={`Nabavna cena (${product.supplier.currency})`}><Input name="purchasePrice" type="number" min={0} max={PURCHASE_PRICE_MAX} step="0.01" required /></Field>
        <Field label="Važenje cene od"><Input name="validFrom" type="date" defaultValue={today} required /></Field>
        <Field label="Važenje cene do"><Input name="validTo" type="date" /></Field>
        <SubmitButton>Dodaj nabavnu cenu</SubmitButton>
      </AdminActionForm>
    </> : <p className="text-sm text-ink-600">Za unos nabavne cene prvo izaberite dobavljača i sačuvajte artikal.</p>}
    {prices.length ? <div className="mt-5 overflow-x-auto">
      <table className="w-full text-left text-sm" aria-label="Istorija nabavnih cena">
        <thead><tr className="border-b border-border">{["Važi od", "Važi do", "Nabavna cena", "Dobavljač", "Paritet"].map(label => <th key={label} className="p-2">{label}</th>)}</tr></thead>
        <tbody>{prices.map(price => <tr key={price.id} className="border-b border-border/60">
          <td className="whitespace-nowrap p-2">{price.validFrom.toISOString().slice(0, 10)}</td>
          <td className="whitespace-nowrap p-2">{price.validTo?.toISOString().slice(0, 10) ?? "Bez krajnjeg datuma"}</td>
          <td className="whitespace-nowrap p-2 tabular-nums">{Number(price.price).toLocaleString("sr-Latn-RS", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} {price.currency}</td>
          <td className="p-2">{price.supplier?.name ?? "—"}</td>
          <td className="p-2">{price.parity ?? "—"}</td>
        </tr>)}</tbody>
      </table>
      {prices.length === 100 && <p className="mt-2 text-xs text-ink-500">Prikazano je poslednjih 100 cena. Cela istorija je dostupna u nabavnom cenovniku.</p>}
    </div> : <p className="mt-5 text-sm text-ink-500">Za ovaj artikal još nema nabavnih cena.</p>}
    <Link className="mt-3 inline-block text-sm underline" href="/admin/erp/nabavne-cene">Otvori cenovnik nabavnih cena</Link>
  </Card>;
}
