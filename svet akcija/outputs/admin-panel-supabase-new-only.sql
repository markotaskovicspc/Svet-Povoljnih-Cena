-- Admin panel fixes: new-only Supabase SQL
-- Paste this on top of the existing schema/migrations.

-- 1) Supabase Storage bucket for reclamation uploads.
insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values (
  'reclamation-uploads',
  'reclamation-uploads',
  true,
  5242880,
  array['image/jpeg', 'image/png', 'image/webp']
)
on conflict (id) do update
set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public read reclamation uploads" on storage.objects;
create policy "Public read reclamation uploads"
on storage.objects
for select
using (bucket_id = 'reclamation-uploads');

-- 2) Real admin user for local/live admin login.
insert into "AdminUser" (
  "id",
  "email",
  "passwordHash",
  "firstName",
  "lastName",
  "role",
  "enabled",
  "createdAt",
  "updatedAt"
)
values (
  'admin-local-super',
  'admin@spc.local',
  '$2b$12$38BpoIlPFt4F.fHBY0XrG.v0AYoTpuEY.naS8UW8eslgjD44VopHu',
  'Admin',
  'SPC',
  'SUPER',
  true,
  now(),
  now()
)
on conflict ("email") do update
set
  "passwordHash" = excluded."passwordHash",
  "role" = 'SUPER',
  "enabled" = true,
  "updatedAt" = now();

-- 3) Default checkout payment-method config.
insert into "PaymentMethodConfig" ("method", "enabled", "label", "note", "updatedAt")
values
  ('IPS', true, 'IPS NBS', null, now()),
  ('KARTICA', false, 'Platna kartica', 'Kartično plaćanje aktivira se nakon WSPay/Raiffeisen podešavanja.', now()),
  ('GOOGLE_PAY', false, 'Google Pay', 'Google Pay se aktivira zajedno sa kartičnim plaćanjem.', now()),
  ('APPLE_PAY', false, 'Apple Pay', 'Apple Pay se aktivira zajedno sa kartičnim plaćanjem.', now()),
  ('UPLATA_NA_RACUN', true, 'Uplata na račun', null, now()),
  ('POUZECE_GOTOVINA', true, 'Pouzeće — gotovina', null, now()),
  ('POUZECE_KARTICA', true, 'Pouzeće — kartica', null, now())
on conflict ("method") do update
set
  "label" = coalesce("PaymentMethodConfig"."label", excluded."label"),
  "note" = coalesce("PaymentMethodConfig"."note", excluded."note"),
  "updatedAt" = now();

-- 4) Default delivery cities and one global price rule.
insert into "DeliveryCity" ("id", "name", "postalCode", "truckEnabled")
values
  ('delivery-city-beograd', 'Beograd', '11000', true),
  ('delivery-city-novi-sad', 'Novi Sad', '21000', true),
  ('delivery-city-nis', 'Niš', '18000', true),
  ('delivery-city-kragujevac', 'Kragujevac', '34000', true),
  ('delivery-city-subotica', 'Subotica', '24000', true),
  ('delivery-city-pancevo', 'Pančevo', '26000', true)
on conflict ("name") do update
set
  "postalCode" = excluded."postalCode",
  "truckEnabled" = excluded."truckEnabled";

do $$
begin
  if exists (
    select 1
    from "DeliveryPriceRule"
    where "scope" = 'GLOBAL'
      and "categoryId" is null
      and "productId" is null
      and "cityId" is null
  ) then
    update "DeliveryPriceRule"
    set
      "courierPrice" = coalesce("courierPrice", 990.00),
      "truckPrice" = coalesce("truckPrice", 4990.00),
      "assemblyPrice" = coalesce("assemblyPrice", 2990.00),
      "updatedAt" = now()
    where "scope" = 'GLOBAL'
      and "categoryId" is null
      and "productId" is null
      and "cityId" is null;
  else
    insert into "DeliveryPriceRule" (
      "id",
      "scope",
      "categoryId",
      "productId",
      "cityId",
      "courierPrice",
      "truckPrice",
      "assemblyPrice",
      "createdAt",
      "updatedAt"
    )
    values (
      'delivery-rule-global-default',
      'GLOBAL',
      null,
      null,
      null,
      990.00,
      4990.00,
      2990.00,
      now(),
      now()
    );
  end if;
end $$;

-- 5) Ad feed flags. Flags are disabled by default; product flags remain editorial.
insert into "AdFlag" ("id", "channel", "enabled", "budgetRsd", "updatedAt")
values
  ('ad-flag-google-merchant', 'GOOGLE_MERCHANT', false, null, now()),
  ('ad-flag-meta', 'META', false, null, now()),
  ('ad-flag-tiktok', 'TIKTOK', false, null, now())
on conflict ("channel") do update
set "updatedAt" = now();

-- Optional: uncomment to make Google + Meta feeds non-empty immediately by
-- flagging all active products that already have at least one image.
-- update "Product" p
-- set
--   "inGoogleMerchant" = true,
--   "inMetaCatalog" = true,
--   "updatedAt" = now()
-- where p."isActive" = true
--   and p."deletedAt" is null
--   and exists (
--     select 1
--     from "ProductMedia" pm
--     where pm."productId" = p."id"
--       and pm."kind" = 'IMAGE'
--   );
