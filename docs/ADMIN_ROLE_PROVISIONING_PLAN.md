# Plan za uvođenje CONTENT, OPS i ADS administratora

Status: pripremljeno, ali se nalozi sada ne kreiraju. Postojeći SUPER nalozi
ostaju nepromenjeni dok vlasnik ne imenuje konkretne osobe.

## Cilj

Svaka osoba dobija svoj nalog i samo ovlašćenja potrebna za svakodnevni posao:

| Uloga | Namenjena za | Nema pristup |
| --- | --- | --- |
| `CONTENT` | proizvodi, kategorije, cene, baneri, navigacija i sadržaj | porudžbine, lager, dostava, fiskalizacija i sistem |
| `OPS` | porudžbine, lager, dostava, reklamacije, checkout i fiskalizacija | CMS/baneri i marketing kampanje |
| `ADS` | newsletter, Viber, oglasi, feedovi i analitika | proizvodi, lager, porudžbine i fiskalizacija |
| `SUPER` | vlasnik sistema ili tehnički administrator za vanredne situacije | nema ograničenja |

SUPER nije podrazumevani svakodnevni nalog. Ne dele se email, lozinka ili
browser sesija između osoba.

## Podaci koje vlasnik treba da potvrdi

Za svaku osobu:

- ime i prezime;
- lična poslovna email adresa;
- jedna uloga: `CONTENT`, `OPS` ili `ADS`;
- datum od kada nalog važi;
- ko odobrava isključivanje ili promenu uloge.

Lozinka se generiše u password manager-u i ne upisuje se u dokument, issue,
commit, chat ili email.

## Postupak kreiranja jednog naloga

Iz root direktorijuma projekta privremeno postaviti:

```bash
export ADMIN_EMAIL="ime@firma.rs"
export ADMIN_PASSWORD="<jaka-jedinstvena-lozinka>"
export ADMIN_ROLE="CONTENT"
export ADMIN_FIRST_NAME="Ime"
export ADMIN_LAST_NAME="Prezime"
npm run admin:create
unset ADMIN_EMAIL ADMIN_PASSWORD ADMIN_ROLE ADMIN_FIRST_NAME ADMIN_LAST_NAME
```

Dozvoljene vrednosti za `ADMIN_ROLE` su `CONTENT`, `OPS` i `ADS`. Postojeća
skripta radi upsert: ponovljeno pokretanje za isti email menja lozinku, ulogu i
ponovo uključuje nalog. Zbog toga pre svakog pokretanja treba još jednom
proveriti email i ulogu.

Posle izvršavanja ukloniti privremene `ADMIN_*` vrednosti iz terminala i ne
čuvati ih u `.env.local`.

## Acceptance posle kreiranja

Za svaki nalog proveriti:

1. uspešnu prijavu na `/admin/prijava`;
2. da se vide samo dozvoljene stavke menija;
3. da direktan URL ka zabranjenom modulu vraća
   `/admin?forbidden=1`;
4. jednu bezopasnu dozvoljenu izmenu nad označenim fixture podatkom;
5. da se izmena pojavila u `/admin/audit-log` sa tačnim nalogom i akcijom;
6. odjavu i ponovnu prijavu;
7. da isključivanje naloga trenutno ukida postojeću sesiju.

Automatizovana matrica je u `tests/e2e/admin-roles.spec.ts`. Za finalnu proveru
koristiti posebne tagged test naloge, ne lozinke stvarnih zaposlenih.

## Rollback

Ako je email, uloga ili osoba pogrešna:

1. nalog odmah postaviti na `enabled=false`;
2. potvrditi da postojeća sesija više ne otvara nijednu admin stranicu;
3. ne brisati audit istoriju legitimnih izmena;
4. tek zatim kreirati ispravan lični nalog.

## Master prompt za kasnije

Kopirati sledeći tekst u novu Codex sesiju kada vlasnik dostavi osobe:

```text
U projektu „Svet povoljnih cena“ kreiraj role-specific admin naloge, bez
menjanja ili brisanja postojećih SUPER naloga.

Ulazni podaci:
- CONTENT: <ime>, <prezime>, <poslovni email>
- OPS: <ime>, <prezime>, <poslovni email>
- ADS: <ime>, <prezime>, <poslovni email>

Obavezna pravila:
1. Pročitaj AGENTS.md i docs/ADMIN_ROLE_PROVISIONING_PLAN.md.
2. Pre bilo kakve izmene pokaži sanitizovan plan: email + uloga, nikada
   lozinku.
3. Za svaku osobu generiši posebnu jaku lozinku kroz odobreni password
   manager/secret kanal; ne upisuj je u repo, chat, log ili .env.local.
4. Koristi postojeći npm run admin:create postupak, jedan nalog po
   pokretanju.
5. Ne dodeljuj SUPER i ne menjaj dva postojeća SUPER naloga.
6. Posle kreiranja pokreni admin role E2E matricu za CONTENT, OPS i ADS:
   dozvoljena ruta mora raditi, zabranjena mora završiti na
   /admin?forbidden=1.
7. Proveri da je svaki nalog enabled, da ima tačnu ulogu i da nema deljenih
   email adresa.
8. Ne menjaj katalog, porudžbine, lager, plaćanja, dostavu ili fiskalne
   podatke osim izolovanih QA fixture zapisa koji se potpuno čiste.
9. Na kraju prijavi samo email, ulogu, rezultat prijave/RBAC testa i potvrdu
   cleanup-a. Ne prikazuj lozinke ili tajne.
```
