import { expect,it } from "vitest";
import type { Product } from "@/types";
import { uniqueFamilyCards } from "@/lib/storefront/family-cards";
it("keeps the first matching offer per family and preserves unrelated SKUs",()=>{
 const cards=[{sku:"M",variantFamily:{id:"f",primarySku:"HIDDEN"}},{sku:"L",variantFamily:{id:"f"}},{sku:"OTHER"},{sku:"SINGLE"}] as Product[];
 expect(uniqueFamilyCards(cards,3).map(p=>p.sku)).toEqual(["M","OTHER","SINGLE"]);
 expect(uniqueFamilyCards(cards,1)[0]).toBe(cards[0]);
});
