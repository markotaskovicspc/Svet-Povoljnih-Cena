# Odgovaranje iz ERP inboxa

U /admin/razgovori zaposleni sa OPS pristupom bira razgovor, klikne **Preuzmi razgovor**, upiše odgovor i klikne dugme za slanje. Bot ostaje pauziran dok zaposleni ne klikne **Vrati botu**. Tokom preuzimanja prepiska se osvežava svakih 10 sekundi u vidljivom tabu.

Mutacije zahtevaju ERP prijavu i audit pre poziva zaštićenog Railway /operator/action endpointa. Integracioni ključ ostaje na serveru. Endpoint dozvoljava samo pause, resume i reply. Poruke imaju jedinstveni identifikator pokušaja: retry posle prekida veze koristi isti identifikator i ne pravi novi odgovor. Nepotvrđen ishod slanja vidljiv je u prepisci; nije označen kao uspešna dostava.

Preuzimanje koristi isti lock kao worker, briše automatski handoff marker i potiskuje preostale bot odgovore. Povratak botu preskače stare neobrađene poruke i uklanja prethodnu nepotvrđenu ponudu. Ako je upis porudžbine ili reklamacije neizvestan, povratak je blokiran dok se ishod ne proveri. Web razgovori nemaju Meta vremensko ograničenje; Facebook/Instagram odgovori zahtevaju važeći prozor od poslednje poruke kupca.

Testovi: services/chatbot/test/operator-action.test.mjs, operator-reader.test.mjs i tests/unit/chat-operator-actions.test.ts. Nema promene šeme baze.
