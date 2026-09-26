import {LOYALTY_CONSENT_SECTIONS,LOYALTY_CONSENT_VERSION} from '@/lib/loyalty/shared';

export const metadata={title:'Loyalty saglasnost | Svet Povoljnih Cena'};
export default function LoyaltyTerms(){
 return <main className="mx-auto max-w-3xl px-5 py-10"><h1 className="mb-6 text-3xl font-bold">Loyalty program — izjava o saglasnosti</h1>{LOYALTY_CONSENT_SECTIONS.map(section=><section key={section.title} className="mb-6"><h2 className="mb-2 text-xl font-semibold">{section.title}</h2><p className="leading-relaxed">{section.body}</p></section>)}<p className="text-sm">Verzija: {LOYALTY_CONSENT_VERSION}</p></main>;
}
