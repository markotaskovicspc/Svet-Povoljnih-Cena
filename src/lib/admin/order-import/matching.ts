import type { ImportDraft, ImportProduct } from "./schema";

export type ImportCatalogProduct = ImportProduct & {
  shortName?: string | null; barcode?: string | null; shortDescription?: string | null;
  colorPrimary?: string | null; colorSecondary?: string | null; sizeLabel?: string | null;
  attribute1?: string | null; attribute2?: string | null; attribute3?: string | null; attribute4?: string | null;
};
export type ImportCandidate = ImportProduct & { matchKind: "exact" | "suggested"; confidence: "high" | "medium" | "low"; reason: string; score: number };
const cyrillic: Record<string, string> = Object.fromEntries(Array.from("абвгдђежзијклљмнњопрстћуфхцчџш").map((c,i)=>[c,["a","b","v","g","d","dj","e","z","z","i","j","k","l","lj","m","n","nj","o","p","r","s","t","c","u","f","h","c","c","dz","s"][i]]));
const aliases: Record<string,string> = {
  rerna:"oven", pecnica:"oven", oven:"oven", stolica:"chair", stolice:"chair", seat:"chair", chair:"chair",
  sto:"table", stol:"table", table:"table", bela:"white", belo:"white", beli:"white", white:"white",
  crna:"black", crno:"black", crni:"black", black:"black", siva:"gray", sivo:"gray", sivi:"gray", grey:"gray", gray:"gray",
  ciscenje:"clean", cleaning:"clean", usisivac:"vacuum", usisivaci:"vacuum", vacuum:"vacuum",
  sijalica:"bulb", sijalice:"bulb", bulb:"bulb", sofa:"sofa", trosed:"sofa", garnitura:"sofa",
};
const stop = new Set(["za","sa","od","i","je","u","na","kom","komad","komada","kupujem","zelim","narucujem","porudzbina","mini"]);
const units = new Set(["w","kw","l","ml","cm","mm","kg","g","v"]);
const colors = new Set(["white","black","gray","crvena","plava","zelena","braon","bez","zuta","pink"]);
export const normalizeImportText = (text: string) => text.toLowerCase().replace(/[а-яђјљњћџ]/g,c=>cyrillic[c]??c).normalize("NFD").replace(/\p{M}/gu,"").replace(/đ/g,"dj");
function tokens(text: string) {
  return [...new Set((normalizeImportText(text).replace(/(?<=[a-z])0(?=[a-z])/g,"o").replace(/(\d)([a-z])|([a-z])(\d)/g,"$1$3 $2$4").match(/[a-z0-9]+/g)??[]).filter(t=>!stop.has(t)&&!units.has(t)).map(t=>aliases[t]??t))];
}
function distance(a: string, b: string) {
  let row=Array.from({length:b.length+1},(_,i)=>i);
  for(let i=1;i<=a.length;i++){const next=[i];for(let j=1;j<=b.length;j++)next[j]=Math.min(next[j-1]+1,row[j]+1,row[j-1]+(a[i-1]===b[j-1]?0:1));row=next;}
  return row[b.length];
}
function similarity(a: string,b: string) {
  if(a===b)return 1;
  if(/^\d+$/.test(a)||/^\d+$/.test(b))return 0;
  if(a.length>=4&&b.length>=4&&Math.abs(a.length-b.length)<=1&&distance(a,b)<=1)return .78;
  if(a.length>=7&&b.length>=7&&Math.abs(a.length-b.length)<=2&&distance(a,b)<=2)return .65;
  return 0;
}
function specs(text: string) {
  const normalized=normalizeImportText(text);
  const result=[...normalized.matchAll(/(\d+(?:[.,]\d+)?)\s*(kw|ml|cm|mm|kg|w|l|g|v)\b/g)].map(m=>[m[2],m[1].replace(",",".")]);
  for(const m of normalized.matchAll(/(\d+(?:[.,]\d+)?)\s*(w|kw)\s*\+\s*(\d+(?:[.,]\d+)?)\s*\2\b/g)) result.push([m[2],String(Number(m[1].replace(",","."))+Number(m[3].replace(",",".")))]);
  return result;
}
export function createImportMatcher(catalog: ImportCatalogProduct[]) {
  const prepared=catalog.map(product=>({product,name:tokens([product.name,product.shortName].filter(Boolean).join(" ")),details:tokens([product.shortDescription,product.colorPrimary,product.colorSecondary,product.sizeLabel,product.attribute1,product.attribute2,product.attribute3,product.attribute4].filter(Boolean).join(" ")),specs:specs([product.name,product.sizeLabel,product.attribute1,product.attribute2,product.attribute3,product.attribute4].filter(Boolean).join(" "))}));
  const frequencies=new Map<string,number>();
  for(const p of prepared)for(const t of new Set([...p.name,...p.details]))frequencies.set(t,(frequencies.get(t)??0)+1);
  const vocabulary = [...new Set(prepared.flatMap(p => [...p.name,...p.details]))];
  const similarities = new Map<string, Map<string, number>>();
  return (line: ImportDraft["lines"][number]): ImportCandidate[] => {
    const query=tokens(line.name), querySpecs=specs(line.name);
    for (const token of query) if (!similarities.has(token)) {
      similarities.set(token, new Map(vocabulary.map(word => [word, similarity(token,word)] as const).filter(([,strength]) => strength > 0)));
    }
    const weights=query.map(t=>1+Math.log(1+catalog.length/((frequencies.get(t)??0)+1)));
    const totalWeight=weights.reduce((a,b)=>a+b,0)||1;
    const queryColors=query.filter(t=>colors.has(t));
    const ranked=prepared.map(p=>{
      const exactSku=[line.sku,line.name].filter(Boolean).some(value=>[p.product.sku,p.product.barcode].some(s=>s&&normalizeImportText(s)===normalizeImportText(value.trim())));
      const exactName=!line.sku&&!!line.name&&normalizeImportText(p.product.name).replace(/[^a-z0-9]/g,"")===normalizeImportText(line.name).replace(/[^a-z0-9]/g,"");
      let hits=0, coverage=0; const matched:string[]=[];
      for(let i=0;i<query.length;i++){
        const nameMatch=Math.max(0,...p.name.map(t=>similarities.get(query[i])?.get(t)??0));
        const detailMatch=Math.max(0,...p.details.map(t=>similarities.get(query[i])?.get(t)??0))*.72;
        const strength=Math.max(nameMatch,detailMatch);
        if(strength){hits++;coverage+=weights[i]*strength;matched.push(query[i]);}
      }
      coverage/=totalWeight;
      const compactQuery=query.join("");
      const compactNames=[p.name,tokens(p.product.shortName??"")].filter(t=>t.length>=2).map(t=>t.join(""));
      const modelMatch=compactNames.some(name=>name.length>=6&&compactQuery.includes(name));
      if(modelMatch){coverage=Math.max(coverage,.85);hits=Math.max(hits,2);}
      const titleCoverage=p.name.filter(t=>query.includes(t)).length/(p.name.length||1);
      const colorConflict=!!queryColors.length&&[...p.name,...p.details].some(t=>colors.has(t)&&!queryColors.includes(t));
      const specConflict=querySpecs.some(([unit,value])=>p.specs.some(([u,v])=>u===unit&&v!==value)&&!p.specs.some(([u,v])=>u===unit&&v===value));
      const queryNumbers=query.filter(t=>/^\d+$/.test(t));
      const modelNumberConflict=!!queryNumbers.length&&p.name.some(t=>/^\d+$/.test(t)&&!queryNumbers.includes(t));
      const conflict=colorConflict||specConflict||modelNumberConflict;
      const unknownSku=!!line.sku&&!exactSku;
      const score=exactSku?100:exactName?98:Math.max(0,Math.round((coverage*.8+titleCoverage*.2)*90)-(conflict?45:0));
      const confidence: ImportCandidate["confidence"] = exactSku||exactName?"high":!conflict&&!unknownSku&&coverage>=.8&&hits>=2?"high":!conflict&&coverage>=.4?"medium":"low";
      const reason=exactSku?(conflict?"Tačna šifra, ali razlika u boji ili karakteristikama — proverite":"Tačna šifra / barkod"):exactName?"Tačan naziv":conflict?"Razlika u boji ili karakteristikama — proverite":unknownSku?"Šifra nije potvrđena; predlog prema nazivu":matched.length?"Poklapanje naziva, modela ili atributa":"";
      return {sku:p.product.sku,name:p.product.name,score,matchKind:exactSku||exactName?"exact" as const:"suggested" as const,confidence,reason,hits};
    }).filter(p=>p.matchKind==="exact"||(p.hits>0&&p.score>=15)).sort((a,b)=>b.score-a.score||a.name.localeCompare(b.name,"sr"));
    if(ranked[0] && ranked[1] && ranked[0].score === ranked[1].score && ranked[0].matchKind === "exact") {
      for(const result of ranked.filter(p=>p.score===ranked[0].score)) {
        result.matchKind="suggested";result.confidence="low";result.reason="Više artikala sa istim nazivom ili barkodom — proverite varijantu";
      }
    }
    // A close alternative means that even the first result needs review.
    if(ranked[0]?.matchKind==="suggested"&&ranked[1]&&ranked[0].score-ranked[1].score<8)ranked[0].confidence="low";
    return ranked.slice(0,12).map(({hits,...p})=>p);
  };
}
