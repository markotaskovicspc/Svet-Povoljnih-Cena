import { describe, expect, it } from "vitest";
import { isPlaceholderDescription, populatedCategoryPaths, productCategoryTrail, productSeoDescription, seoPlainText } from "@/lib/seo/catalog";

describe("catalog SEO", () => {
  it("decodes visible entity artifacts without interpreting text as HTML", () => {
    expect(seoPlainText('<p>Širina&nbsp;59&#160;cm</p><p>360&#xB0; &amp; &quot;crna&quot;</p>'))
      .toBe('Širina 59 cm 360° & "crna"');
    expect(seoPlainText('&#x110000; &#xD800;')).toBe('&#x110000; &#xD800;');
    expect(seoPlainText('&lt;img src=x&gt;')).toBe('<img src=x>');
  });
  it("recognizes exact editorial placeholders without hiding real copy", () => {
    expect(isPlaceholderDescription('<p>Dopuniti opis za sajt.</p>')).toBe(true);
    expect(isPlaceholderDescription('Novi model. Dopuniti opis za sajt.')).toBe(false);
  });
  it("builds model/variant metadata from structured data without price or unsupported promises", () => {
    const description = productSeoDescription({ name: 'Stolica FLEX SEAT', colorPrimary: 'CRNA', dimensionsCm: {w:59,d:61,h:117}, attributes:['ROTACIJA 360 STEPENI'] });
    expect(description).toContain('Stolica FLEX SEAT. Boja: crna.');
    expect(description).toContain('59 × 61 × 117 cm');
    expect(description).not.toContain('Rotacija');
    expect(description).not.toMatch(/RSD|popust|garancija|najbolj/i);
  });
  it("does not invent missing measurements or duplicate a named colour", () => {
    expect(productSeoDescription({name:'INVISIBLE, M, crne',colorPrimary:'crne',dimensionsCm:{w:1,d:1,h:1},attributes:[]}))
      .toBe('INVISIBLE, M, crne.');
    expect(productSeoDescription({name:'BELLA',dimensionsCm:{w:15,d:21,h:24},attributes:['ZAPREMINA 12L']})).not.toContain('12');
  });
  it("uses stored category paths, preserving slug suffixes and ancestry", () => {
    const categories=[
      {name:'Nameštaj',slug:'namestaj',path:'/namestaj'},
      {name:'Radna soba',slug:'radna-soba',path:'/namestaj/radna-soba'},
      {name:'Stolice',slug:'stolice-ab12',path:'/namestaj/radna-soba/stolice-ab12'},
      {name:'Drugo',slug:'drugo',path:'/namestaj/radna-soba-2'},
    ];
    expect(productCategoryTrail(['/namestaj/radna-soba/stolice-ab12'],categories)).toEqual([
      {label:'Nameštaj',href:'/k/namestaj'},
      {label:'Radna soba',href:'/k/namestaj/radna-soba'},
      {label:'Stolice',href:'/k/namestaj/radna-soba/stolice-ab12'},
    ]);
    expect(productCategoryTrail(['/unknown'],categories)).toEqual([]);
  });
  it("includes populated ancestors but not neighbouring category prefixes", () => {
    const paths=populatedCategoryPaths([{categories:[{category:{path:'/dom/lampe-led'}}]}]);
    expect([...paths]).toEqual(['/dom','/dom/lampe-led']);
    expect(paths.has('/dom/lampe')).toBe(false);
  });
});
