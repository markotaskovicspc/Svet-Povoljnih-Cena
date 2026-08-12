ALTER TABLE "Product" ADD COLUMN "palletQty" INTEGER;
ALTER TABLE "DispatchNoteItem" ADD COLUMN "palletQty" INTEGER;

UPDATE "ContentPage"
SET "bodyMarkdown" = REPLACE(
  "bodyMarkdown",
  '1. Prijavite reklamaciju kroz formular u nalogu (*Moj nalog → Reklamacije*) ili e-poštom na [reklamacije@svetpovoljnihcena.rs](mailto:reklamacije@svetpovoljnihcena.rs).
2. Dobićete potvrdu prijema u roku od 24h, sa brojem reklamacije.',
  '1. Prijavite se i otvorite portal [Moj nalog → Reklamacije](/nalog/reklamacije). Izaberite porudžbinu i artikal, dodajte komentar i fotografije.
2. Broj reklamacije i svaku promenu statusa pratite u istom portalu.'
)
WHERE "slug" = 'reklamacije';

UPDATE "ContentPageRevision"
SET "bodyMarkdown" = REPLACE(
  "bodyMarkdown",
  '1. Prijavite reklamaciju kroz formular u nalogu (*Moj nalog → Reklamacije*) ili e-poštom na [reklamacije@svetpovoljnihcena.rs](mailto:reklamacije@svetpovoljnihcena.rs).
2. Dobićete potvrdu prijema u roku od 24h, sa brojem reklamacije.',
  '1. Prijavite se i otvorite portal [Moj nalog → Reklamacije](/nalog/reklamacije). Izaberite porudžbinu i artikal, dodajte komentar i fotografije.
2. Broj reklamacije i svaku promenu statusa pratite u istom portalu.'
)
WHERE "pageId" IN (
  SELECT "id" FROM "ContentPage" WHERE "slug" = 'reklamacije'
);
