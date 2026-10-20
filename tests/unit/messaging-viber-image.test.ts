import { expect, it } from "vitest";
import sharp from "sharp";
import { viberImageUrl } from "@/lib/messaging/viber-image";
import { buildNthPayload } from "@/lib/viber/nth";
it("replaces the wide SPC logo in outgoing provider payloads, including existing campaigns", () => {
 const imageUrl="https://www.svetpovoljnihcena.rs/logo.svg";
 expect(viberImageUrl(imageUrl)).toBe("https://www.svetpovoljnihcena.rs/viber-logo.jpg");
 expect(buildNthPayload({to:"0637725045",text:"Test",imageUrl,cta:{label:"Ponuda",url:"https://www.svetpovoljnihcena.rs"}},"Svet povoljnih cena").viber.image).toBe(viberImageUrl(imageUrl));
 expect(viberImageUrl("https://example.com/logo.svg")).toBe("https://example.com/logo.svg");
});
it("ships a square opaque logo with safe white margins for Viber crop", async () => {
 const img=sharp("public/viber-logo.jpg");const meta=await img.metadata();
 expect(meta.width).toBe(1024);expect(meta.height).toBe(1024);expect(meta.hasAlpha).toBe(false);
 const edge=await sharp(await img.extract({left:0,top:0,width:100,height:1024}).toBuffer()).stats();
 expect(edge.channels.every(c=>c.mean>250)).toBe(true);
});
