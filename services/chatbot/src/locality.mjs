import { normalizePlace } from './delivery.mjs';

// Loose locality resolution for addresses the exact matchers reject, for
// example "Borča, Beograd", "Staro Selo kod Velike Plane", "Petrovac na Mlavi"
// or "Zabela, Požarevac". Every answer is a real courier record returned by
// the lookup; nothing is guessed when two records remain equally plausible.

const key=value=>normalizePlace(value).replace(/dj/g,'d').replace(/[^a-z0-9]+/g,' ').trim();

// Belgrade municipalities in the X Express dictionary (urban boroughs and
// suburban municipalities). "Beograd" itself has no record of its own.
const BEOGRAD_MUNICIPALITIES=new Set([70106,70114,70149,70157,70181,70203,70211,70220,70246,70254,70122,71293,70092,70173,70190,70238,70165]);
const BEOGRAD_BOROUGHS={
 'cukarica':'Čukarica','novi beograd':'Novi Beograd','palilula':'Palilula','rakovica':'Rakovica','savski venac':'Savski Venac',
 'stari grad':'Stari Grad','vozdovac':'Voždovac','vracar':'Vračar','zemun':'Zemun','zvezdara':'Zvezdara',
};
// Belgrade neighbourhoods that the courier routes under the borough record.
const BEOGRAD_NEIGHBOURHOODS={
 'krnjaca':'Palilula','kotez':'Palilula','karaburma':'Palilula','visnjica':'Palilula','visnjicka banja':'Palilula','rospi cuprija':'Palilula','hadzipopovac':'Palilula','bogoslovija':'Palilula',
 'cerak':'Čukarica','cerak vinogradi':'Čukarica','zeleznik':'Čukarica','banovo brdo':'Čukarica','julino brdo':'Čukarica','bele vode':'Čukarica','golf naselje':'Čukarica','filmski grad':'Čukarica',
 'jajinci':'Voždovac','banjica':'Voždovac','medakovic':'Voždovac','brace jerkovic':'Voždovac','kumodraz':'Voždovac','dusanovac':'Voždovac','autokomanda':'Voždovac','sumice':'Voždovac','bubanj potok':'Voždovac',
 'mirijevo':'Zvezdara','konjarnik':'Zvezdara','mali mokri lug':'Zvezdara','mml':'Zvezdara','mmlug':'Zvezdara','veliki mokri lug':'Zvezdara','djeram':'Zvezdara','deram':'Zvezdara','lion':'Zvezdara','uciteljsko naselje':'Zvezdara','zeleno brdo':'Zvezdara',
 'vidikovac':'Rakovica','miljakovac':'Rakovica','kanarevo brdo':'Rakovica','labudovo brdo':'Rakovica','petlovo brdo':'Rakovica','kijevo':'Rakovica',
 'bezanijska kosa':'Novi Beograd','ledine':'Novi Beograd','tosin bunar':'Novi Beograd',
 'galenika':'Zemun','altina':'Zemun','kalvarija':'Zemun',
 'dorcol':'Stari Grad','senjak':'Savski Venac','dedinje':'Savski Venac','topcider':'Savski Venac',
};
// Names whose suffix identifies one of several same-named courier records.
const IMPLIED_POSTAL={'petrovac na mlavi':'12300','priboj na limu':'31330','aleksandrovac pozarevacki':'12370','raca kragujevacka':'34210'};
// Leading words only: "Novo Selo" keeps its "Selo".
const NOISE=/^(?:(?:opstina|opstine|op|grad|selo|naselje|mesto|zp|okolina)\b\.?\s*)+/;

function baseNames(name){
 const raw=String(name??'');
 const inner=[...raw.matchAll(/\(([^)]*)\)/g)].map(m=>m[1]).filter(s=>key(s)!=='selo');
 return [key(raw.replace(/\([^)]*\)/g,' ')),...inner.map(key)].filter(Boolean);
}
function variants(part){
 const k=key(part);const out=new Set([k]);
 const words=k.split(' ');
 // Serbian genitive after "kod": Velike Plane -> Velika Plana, Kragujevca -> Kragujevac.
 const gen=w=>[w,w.replace(/ke$/,'ka').replace(/ne$/,'na'),w.replace(/e$/,'a'),w.replace(/([bcdfghjklmnprstvz])ca$/,'$1ac'),w.replace(/([cč])ka$/,'$1ak'),w.replace(/a$/,''),w.replace(/ici$/,'ik')];
 const combos=words.reduce((acc,w)=>acc.flatMap(prefix=>[...new Set(gen(w))].map(g=>(prefix?prefix+' ':'')+g)),['']);
 for(const c of combos.slice(0,12))out.add(c.trim());
 const na=k.match(/^(.+?) na [a-z]+$/);if(na)out.add(na[1]);
 if(words.length>1&&/(ski|cki|ki)$/.test(words.at(-1)))out.add(words.slice(0,-1).join(' '));
 return [...out].filter(v=>v.length>=2);
}
export function splitLocality(city){
 return String(city??'').replace(/\(([^)]*)\)/g,', $1').split(/\s*[,;/]\s*|\s+[—–-]\s+|\s+kod\s+|\s+pored\s+/i)
  .map(s=>key(s).replace(/\b\d{5}\b/g,' ').replace(/\s+/g,' ').trim().replace(NOISE,'').trim()).filter(s=>s.length>=2);
}
const unique=list=>[...new Map(list.filter(t=>Number.isInteger(t?.townId)&&t.townId>0).map(t=>[t.townId,t])).values()];

export async function resolveLooseTown({city,postalCode},lookup){
 const parts=splitLocality(city);
 if(!parts.length)return {town:null,candidates:[]};
 const postal=/^\d{5}$/.test(String(postalCode??'').trim())?String(postalCode).trim():null;
 const cache=new Map();
 const find=async q=>{if(!cache.has(q))cache.set(q,lookup(q).catch(()=>[]));return cache.get(q);};
 const matchesFor=async part=>{
  const vs=variants(part);
  const found=(await Promise.all(vs.map(find))).flat();
  return unique(found.filter(t=>baseNames(t.name).some(b=>vs.includes(b))));
 };
 const beogradCtx=parts.some(p=>p==='beograd'||p==='bg'||p.startsWith('beograd '))||(postal?.startsWith('11')&&parts.some(p=>BEOGRAD_NEIGHBOURHOODS[p]||BEOGRAD_BOROUGHS[p]));
 const localityParts=parts.filter(p=>!(beogradCtx&&(p==='beograd'||p==='bg')));
 const perPart=await Promise.all(localityParts.map(async p=>({part:p,towns:(await matchesFor(p)).filter(t=>!beogradCtx||BEOGRAD_MUNICIPALITIES.has(t.municipalityId))})));

 if(beogradCtx){
  const records=unique(perPart.flatMap(x=>x.towns).filter(t=>!/^Beograd \(/.test(t.name)));
  if(records.length===1)return {town:records[0],candidates:[]};
  // "Zvezdara MMLug": also read the words of a part.
  const named=p=>{const w=p.split(' ');const grams=[p,...w,...w.slice(1).map((x,i)=>w[i]+' '+x)];
   return grams.map(g=>BEOGRAD_BOROUGHS[g]??BEOGRAD_NEIGHBOURHOODS[g]).filter(Boolean);};
  const boroughs=new Set(localityParts.flatMap(named));
  const cityItems=unique(await find('Beograd')).filter(t=>/^Beograd \(/.test(t.name));
  if(boroughs.size===1&&records.length===0){
   const [b]=boroughs;const town=cityItems.find(t=>key(t.name)===key(`Beograd (${b})`));
   if(town)return {town,candidates:[]};
  }
  return {town:null,candidates:cityItems.slice(0,10)};
 }

 const pick=list=>{const u=unique(list);if(u.length===1)return u[0];
  // Same municipality and postcode: prefer the main record over its "(selo)" twin.
  const main=u.filter(t=>!/\(selo\)/i.test(t.name));
  if(main.length===1&&u.every(t=>t.municipalityId===main[0].municipalityId&&t.postalCode===main[0].postalCode))return main[0];
  return null;};
 const impliedPostal=parts.map(p=>IMPLIED_POSTAL[p]).find(Boolean)??null;
 for(const [i,{towns}] of perPart.entries()){
  if(!towns.length)continue;
  const parents=new Set(perPart.filter((_,j)=>j!==i).flatMap(x=>x.towns).map(t=>t.municipalityId).filter(Number.isInteger));
  const steps=[
   postal&&towns.filter(t=>t.postalCode===postal),
   impliedPostal&&towns.filter(t=>t.postalCode===impliedPostal),
   parents.size&&towns.filter(t=>parents.has(t.municipalityId)),
  ];
  for(const step of steps){
   if(!step||!step.length)continue;
   const t=pick(step);if(t)return {town:t,candidates:[]};
   // Several records fit: the buyer's postcode prefix may still single one out.
   if(postal){const n=pick(step.filter(x=>String(x.postalCode).slice(0,3)===postal.slice(0,3)));if(n)return {town:n,candidates:[]};}
  }
 }
 // Unknown neighbourhood of a known town ("Zabela, Požarevac"): use the town
 // when the postcode (if given) confirms it.
 if(perPart.some(x=>!x.towns.length)){
  const known=perPart.filter(x=>x.towns.length);
  if(known.length===1){
   const towns=known[0].towns;const t=pick(postal?towns.filter(x=>x.postalCode===postal):towns);
   if(t&&!/\(/.test(t.name))return {town:t,candidates:[]};
   // A city split into boroughs (Niš): ask which borough, never pick one.
   return {town:null,candidates:towns.slice(0,8)};
  }
 }
 if(perPart.length===1&&perPart[0].towns.length){const t=pick(perPart[0].towns);if(t)return {town:t,candidates:[]};}
 return {town:null,candidates:perPart.flatMap(x=>x.towns).slice(0,8)};
}
