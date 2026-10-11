import Link from "next/link";
import Image from "next/image";
import { getPublicSets } from "@/lib/product-sets/server";
import { formatRsd as formatMoney } from "@/lib/format";
const formatRsd = (value: number) => formatMoney(value, true);
export const dynamic = "force-dynamic";
export const metadata = { title: "Prodajni setovi", description: "Izaberite kombinacije artikala sa zajedničkom cenom." };
export default async function ProductSets() {
  const sets = await getPublicSets();
  return <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6"><p className="text-sm text-ink-500"><Link href="/">Početna</Link> / Setovi</p><h1 className="mt-4 text-3xl font-semibold text-ink-900">Prodajni setovi</h1><p className="mt-3 max-w-2xl text-ink-600">Artikli koji se kupuju zajedno, po jednoj zajedničkoj ceni. U svakom setu pogledajte tačan sastav i dostupnost.</p>
    {!sets.length ? <p className="my-12 rounded-2xl border border-border p-8">Trenutno nema objavljenih setova. <Link className="underline" href="/pretraga">Pogledajte artikle</Link></p> : <div className="mt-8 grid gap-6 sm:grid-cols-2 lg:grid-cols-3">{sets.map(set => <Link href={`/setovi/${set.slug}`} key={set.id} className="overflow-hidden rounded-2xl border border-border bg-white transition hover:shadow-md"><div className="relative aspect-[4/3] bg-sand-50">{set.image ? <Image src={set.image} alt={set.name} fill sizes="(max-width:640px) 100vw, 33vw" className="object-contain p-6" /> : <span className="flex h-full items-center justify-center text-ink-400">Set artikala</span>}</div><div className="space-y-2 p-5"><h2 className="text-xl font-semibold">{set.name}</h2><p className="text-sm text-ink-500">{set.components.reduce((n, c) => n + c.quantity, 0)} komada u setu</p><p className="text-xl font-semibold text-walnut">{formatRsd(set.price)}</p><p className="text-sm">{set.stock ? set.supplier ? "Dostupno kod dobavljača" : "Dostupno" : "Trenutno nedostupno"}</p></div></Link>)}</div>}
  </main>;
}
