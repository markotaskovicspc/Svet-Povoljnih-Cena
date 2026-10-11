"use client";
import { useState } from "react";
import Link from "next/link";
import { useCart } from "@/lib/hooks/use-cart";
export function AddSet({ sku, name, slug, price, image, available }: { sku: string; name: string; slug: string; price: number; image: string | null; available: boolean }) {
  const add = useCart(s => s.add);
  const [added, setAdded] = useState(false);
  return <div className="space-y-3"><button disabled={!available} onClick={() => { add({ sku, name, slug, unitPriceFull: price, unitPriceSale: price, thumbnailUrl: image ?? undefined }, 1); setAdded(true); }} className="w-full rounded-xl bg-walnut px-6 py-3 font-semibold text-white transition hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40">{available ? "Dodaj ceo set u korpu" : "Set trenutno nije dostupan"}</button>{added && <p role="status" className="text-sm">Set je dodat. <Link className="font-semibold underline" href="/korpa">Otvori korpu</Link></p>}</div>;
}
