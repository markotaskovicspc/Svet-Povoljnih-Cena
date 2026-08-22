# Rabalux nedeljni lager za Srbiju

Rabalux stanje za prodavnicu dolazi isključivo iz kompletnog nedeljnog XLSX
izveštaja. XML/CSV feed ostaje izvor kataloga, cena, opisa, slika i tehničkih
podataka. Kombinovani stock feed više se ne izvršava iz cron-a i ne može da
prepiše stanje iz Srbije.

## Uvoz

1. Otvoriti `/admin/xml-import` i u Rabalux kartici izabrati XLSX.
2. Kliknuti **Proveri XLSX** i pregledati 0, 1–2, 3+, aktivacije,
   deaktivacije, trajna brisanja i šifre koje postoje samo u fajlu ili samo na sajtu.
3. Ponovo izabrati isti fajl, uneti razlog i potvrdu `RABALUX STANJE`.
4. Kliknuti **Primeni pregledani lager**.

Preview važi 10 minuta. Primena se odbija ako se promeni fajl, stanje proizvoda,
broj redova naglo padne ili je isti fajl već primenjen.

## Pravila

- Samo šifra са најмање 3 комада у XLSX-у остаје видљива када је одобрена и
  има категорију, активну малопродајну цену и спремну слику.
- `3+`: proizvod je dostupan za kupovinu.
- `0–2`: производ остаје сачуван за администрацију, али се не приказује у
  каталогу, претрази, feed-овима или филтеру „Нема на стању“.
- Šifra koja uopšte ne postoji u kompletnom XLSX-u trajno se briše iz `Product`
  tabele. Povezani kataloški redovi brišu se kaskadno, istorijski dokumenti
  zadržavaju svoje SKU/naziv snapshot-e, a upravljani storage fajlovi odlaze u
  retry red za trajno brisanje.
- Свака шифра из XLSX-а које још нема у бази повлачи се из каталошког feed-а,
  без обзира на количину. Непозната или немапирана шифра остаје евидентирана за
  административну обраду, али се на сајту приказује тек са најмање 3 комада.
- Ако шифре више нема у каталошком feed-у, она се ипак креира у бази са називом
  и стањем из XLSX-а. Остаје необјављена док не добије цену, категорију и слике.
- Дневни каталошки sync не сме да уклони шифру која постоји у последњем
  недељном XLSX-у; само следећи комплетан XLSX мења allow-list.
- DC stanje ostaje ERP podatak, ali ne može da zaobiđe Rabalux prag: za web
  kupovinu i dalje su potrebna najmanje 3 komada u nedeljnom XLSX-u.
- Rabalux stanje važi osam dana. Posle toga dobavljačko stanje se smatra
  zastarelim i ne ulazi u kupovinu.

Svaka primena pravi `ImportRun`, stavke pre/posle u `SupplierSyncChange` i
snapshot promene količine. Trajno brisanje proizvoda je označeno kao
nereverzibilno; porudžbine, fiskalni i drugi istorijski redovi zadržavaju svoje
tekstualne snapshot podatke bez veze ka obrisanom proizvodu.
