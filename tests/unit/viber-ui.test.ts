import { expect, it } from "vitest";
import { audienceFormFilter, audienceDescription } from "@/lib/viber/ui";
it("selects all opt-ins only without purchase filters, and never broadens a filtered audience",()=>{
 expect(audienceFormFilter({name:'Publika',everyone:true})).toEqual({includeNonCustomers:true});
 expect(audienceFormFilter({name:'Publika',everyone:true,cities:'Beograd, Novi Sad, Beograd'})).toEqual({includeNonCustomers:false,cities:['Beograd','Novi Sad']});
 expect(audienceFormFilter({name:'Publika',everyone:false})).toEqual({includeNonCustomers:false});
});
it("interprets calendar dates in Serbia across summer/winter time and rejects invalid ranges",()=>{
 expect(audienceFormFilter({name:'Kupci',from:'2026-01-10'}).lastPurchaseFrom).toBe('2026-01-09T23:00:00.000Z');
 expect(audienceFormFilter({name:'Kupci',from:'2026-07-10'}).lastPurchaseFrom).toBe('2026-07-09T22:00:00.000Z');
 expect(()=>audienceFormFilter({name:'Kupci',from:'2026-02-31'})).toThrow();
 expect(()=>audienceFormFilter({name:'Kupci',from:'2026-07-10',to:'2026-07-01'})).toThrow();
});
it("describes saved audiences without exposing configuration JSON",()=>{
 expect(audienceDescription({includeNonCustomers:true})).toBe('Svi brojevi telefona sa Viber saglasnošću');
 expect(audienceDescription({cities:['Beograd']})).toContain('Beograd');
});

it("all phones is an explicit mode that clears purchase restrictions",()=>{expect(audienceFormFilter({name:'Svi',allStoredPhones:true,cities:'Beograd'})).toEqual({allStoredPhones:true});expect(audienceDescription({allStoredPhones:true})).toContain('Svi brojevi telefona');});
