# Admin obaveštenja o porudžbinama

Admini sa ulogom SUPER ili OPS mogu da uključe Web Push na svakom uređaju zasebno. Prijava sama ne uključuje obaveštenja. Poruke sadrže broj porudžbine i link, bez podataka kupca. Na iPhone-u (iOS 16.4+) prvo dodati administraciju na početni ekran iz Safarija, zatim otvoriti ikonicu, prijaviti se i uključiti obaveštenja.

## Podešavanje servera

Generisati jedan VAPID par pomoću `node scripts/setup-admin-push.mjs`. Skripta upisuje ključeve u ignorisani `.env.local` i ne ispisuje tajne. Iste vrednosti `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` preneti u Vercel Production environment. Ne menjati par pri svakom deploy-u: postojeći uređaji su vezani za javni ključ.

Primeniti novu migraciju standardnim `npm run db:deploy` (uključuje db:harden), pa objaviti aplikaciju. Vercel Production build već primenjuje migracije. Tabela pretplata ima RLS i nema grantove za anon/authenticated. Migracija je isključivo dodavanje tabele; stara verzija aplikacije može raditi sa njom. Za povratak objaviti prethodnu verziju i zadržati tabelu/ključeve.

## Provera posle objave

1. U admin zaglavlju otvoriti „Uključi obaveštenja o porudžbinama“.
2. Prihvatiti dozvolu na stvarnom telefonu/računaru.
3. Kliknuti „Pošalji probno obaveštenje“, zatvoriti aplikaciju i proveriti prikaz na uređaju.
4. Proveriti novu porudžbinu u test okruženju: dodir obaveštenja otvara odgovarajuću porudžbinu, uz postojeću proveru admin sesije.
5. Proveriti isključivanje na jednom uređaju i nastavak rada na drugom.

Checkout zadržava postojeću izolaciju: provider nije u checkout import stablu i slanje ne utiče na uspešno sačuvanu porudžbinu. Postojeći background-jobs cron ponavlja neuspele pokušaje; svaki uređaj dobija zaseban posao sa stabilnim idempotency ključem. Ako provider prihvati poruku, a radnik se prekine pre čuvanja uspeha, moguć je ponovljeni pokušaj; isti notification tag objedinjuje poruke za istu porudžbinu. Istekle pretplate (404/410) se brišu. Isključeni admini i admini bez OPS/SUPER pristupa se proveravaju pri slanju. Ne šalju se porudžbine starije od jednog sata niti uređajima uključenim nakon nastanka porudžbine. Prikaz i zvuk zavise od sistemskih dozvola, mreže i Focus režima.

Ne postoji offline keširanje administracije. Service worker služi samo za obaveštenja.
