# Picking po pozicijama

## Priprema

U ERP → Picking pozicije izabrati magacin. Skica prati 240 numerisanih pozicija iz dokumenta „Magacin picking pozicije.pdf“. Zelena polja imaju dodeljene artikle ili dobavljače. Svaki magacin ima zaseban raspored.

Raspored prati i prolaze iz PDF-a: širok središnji prolaz, razmake između pojedinačnih redova, širi poslednji prolaz i obris magacina sa crnim oznakama na vrhu i dnu. Na užem ekranu skica se pomera vodoravno kako bi brojevi ostali čitljivi.

Klik na poziciju otvara unos više SKU (novi red, zarez ili tačka-zarez), više dobavljača, napomene i redosleda obilaska. Konkretna SKU dodela ima prednost nad dodelom dobavljača. Početni redosled je numerički; prilagoditi stvarnom početku obilaska i mestu pakovanja. Pozicije ne predstavljaju količine na lageru.

## Odvajanje

Otvoriti Picking i preuzimanja → nalog → Digitalni picking / skeniraj. Jedan nalog može obuhvatiti više porudžbina. Prikaz sabira aktivne sadržaje paketa po SKU i magacinu, sortira ih prema pozicijama i čuva raspodelu po porudžbinama. Povrati, odloženi paketi i otkazane porudžbine se ne odvajaju za slanje. Rezervni delovi su posebno označeni, bez barkoda celog artikla.

- Ručni skener: fokusirati polje, očitati barkod ili SKU i poslati Enter. Podrazumevana količina je 1.
- Kamera: dozvoliti kameru na picking ekranu, očitati kod i potvrditi količinu. Kamera se zatvara posle očitavanja.
- Ručno: +1 potvrđuje odvojenu jedinicu, −1 ispravlja grešku.
- Ako je isti SKU u više magacina, najpre izabrati odgovarajući red.
- Nedostaje / napomena beleži razlog bez menjanja odvojene količine.
- Štampaj putanju daje isti redosled i raspodelu na papiru.

Sve promene imaju vreme i korisnika. Ponovljen mrežni zahtev ne povećava količinu drugi put. Dva korisnika ne mogu odvojiti više od potrebne količine. Posle izmene sadržaja naloga potrebna je nova provera; raniji zapisi ostaju u istoriji.

Odvajanje ne knjiži lager niti pokreće kurira. Kada je sva roba odvojena, otvoriti Nalog i pakovanje i završiti postojeću proveru paketa i dimenzija. Kada je kreiranje adresnica započeto ili nalog zaključen, skeniranje je samo za pregled.

## Kontrolna tabla i loyalty

Porudžbine danas i Porudžbine u periodu sabiraju lokalne i uvezene Ananas porudžbine, uz isključivanje otkazanih i uklanjanje duplikata po Ananas broju. Dan koristi postojeći Europe/Belgrade kalendar. Ovo je vrednost porudžbina, ne fiskalni promet. Ananas API porudžbine ulaze u kontekst „Svi magacini“, jer nemaju potvrđenu vezu sa lokalnim magacinom.

U Prodajnim nalozima prečac „Gosti sa loyalty saglasnošću“ filtrira sačuvanu saglasnost. Broj i zbir svih filtriranih porudžbina prikazani su ispod tabele; datum i status mogu se dodatno filtrirati. Kolone Loyalty / kupac, Loyalty saglasnost i Popust za prvu kupovinu mogu se uključiti u sačuvani pogled. Stare kupovine bez zabeležene saglasnosti nisu retroaktivno klasifikovane prema ceni.
