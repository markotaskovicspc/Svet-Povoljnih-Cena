-- Repair missing Supabase schema objects from the Phase 1 audit.
-- Run in Supabase SQL Editor after reviewing the duplicate-invoice preflight below.
-- This script is intended for the audited DB state where 0001 exists, many
-- 0002-0007 objects already exist, and 0004/0008/0009 are only partially present.

begin;

do $$
begin
  if to_regclass('public._prisma_migrations') is null then
    raise exception 'public._prisma_migrations is missing. Stop here and inspect the database before marking Prisma migrations.';
  end if;
end $$;

-- Stop before changing schema if existing invoices would block the new
-- Invoice(orderId, kind) unique constraint. Resolve duplicates manually first.
do $$
declare
  has_kind boolean;
  has_duplicates boolean;
begin
  select exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'Invoice'
      and column_name = 'kind'
  ) into has_kind;

  if has_kind then
    execute 'select exists (
      select 1
      from public."Invoice"
      group by "orderId", "kind"
      having count(*) > 1
    )' into has_duplicates;
  else
    execute 'select exists (
      select 1
      from public."Invoice"
      group by "orderId"
      having count(*) > 1
    )' into has_duplicates;
  end if;

  if has_duplicates then
    raise exception 'Invoice duplicates found. Cannot create Invoice_orderId_kind_key until duplicate invoices per order are cleaned up.';
  end if;
end $$;

-- 0002 / 0003 safety re-apply: product Excel fields and PDP/admin fields.
alter table public."Product"
  add column if not exists "barcode" text,
  add column if not exists "sizeLabel" text,
  add column if not exists "colorPrimary" text,
  add column if not exists "colorSecondary" text,
  add column if not exists "loyaltyPrice" decimal(12,2),
  add column if not exists "loyaltyDiscountPct" integer,
  add column if not exists "pdpDeliveryTerms" text,
  add column if not exists "declaration" text,
  add column if not exists "assemblyInstructions" text,
  add column if not exists "maintenance" text;

alter table public."Action"
  add column if not exists "isPermanent" boolean not null default false,
  add column if not exists "sortOrder" integer not null default 0;

create unique index if not exists "Product_barcode_key"
  on public."Product" ("barcode");

-- 0005 safety re-apply: homepage sections.
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'BannerPlacement'
  ) then
    create type public."BannerPlacement" as enum ('HERO', 'HOME_AFTER_SECOND_ROW', 'HOME_AFTER_FOURTH_ROW');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'HomeSectionSlotKey'
  ) then
    create type public."HomeSectionSlotKey" as enum ('FIRST', 'SECOND', 'THIRD', 'FOURTH', 'FIFTH', 'SIXTH');
  end if;

  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'HomeSectionSourceType'
  ) then
    create type public."HomeSectionSourceType" as enum ('ACTION', 'LANDING_PAGE');
  end if;
end $$;

alter table public."Banner"
  add column if not exists "placement" public."BannerPlacement" not null default 'HERO';

create table if not exists public."HomeSectionSlot" (
  "id" text not null,
  "slotKey" public."HomeSectionSlotKey" not null,
  "sourceType" public."HomeSectionSourceType" not null,
  "actionId" text,
  "landingPageKey" text,
  "titleOverride" text,
  "productLimit" integer not null default 12,
  "enabled" boolean not null default true,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,
  constraint "HomeSectionSlot_pkey" primary key ("id")
);

create index if not exists "Banner_enabled_placement_order_idx"
  on public."Banner" ("enabled", "placement", "order");
create unique index if not exists "HomeSectionSlot_slotKey_key"
  on public."HomeSectionSlot" ("slotKey");
create index if not exists "HomeSectionSlot_enabled_slotKey_idx"
  on public."HomeSectionSlot" ("enabled", "slotKey");
create index if not exists "HomeSectionSlot_actionId_idx"
  on public."HomeSectionSlot" ("actionId");

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'HomeSectionSlot_actionId_fkey') then
    alter table public."HomeSectionSlot"
      add constraint "HomeSectionSlot_actionId_fkey"
      foreign key ("actionId") references public."Action"("id")
      on delete set null on update cascade;
  end if;
end $$;

-- 0004: payment provider state.
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'PaymentProvider'
  ) then
    create type public."PaymentProvider" as enum ('IPS', 'RAIFFEISEN_CARD', 'MANUAL', 'COD');
  end if;
end $$;

alter table public."Payment"
  add column if not exists "provider" public."PaymentProvider" not null default 'MANUAL',
  add column if not exists "paymentReference" text,
  add column if not exists "redirectUrl" text,
  add column if not exists "rawRequest" jsonb,
  add column if not exists "paidAt" timestamp(3),
  add column if not exists "expiresAt" timestamp(3);

update public."Payment"
set "provider" = case
  when "method"::text = 'IPS' then 'IPS'::public."PaymentProvider"
  when "method"::text in ('KARTICA', 'GOOGLE_PAY', 'APPLE_PAY') then 'RAIFFEISEN_CARD'::public."PaymentProvider"
  when "method"::text in ('POUZECE_GOTOVINA', 'POUZECE_KARTICA') then 'COD'::public."PaymentProvider"
  else 'MANUAL'::public."PaymentProvider"
end
where "provider" is null
   or "provider" = 'MANUAL'::public."PaymentProvider";

create index if not exists "Payment_paymentReference_idx"
  on public."Payment" ("paymentReference");
create index if not exists "Payment_provider_status_idx"
  on public."Payment" ("provider", "status");

-- 0008: checkout sessions.
do $$
begin
  if not exists (
    select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace
    where n.nspname = 'public' and t.typname = 'CheckoutSessionStatus'
  ) then
    create type public."CheckoutSessionStatus" as enum ('ACTIVE', 'CONVERTED', 'ABANDONED');
  end if;
end $$;

create table if not exists public."CheckoutSession" (
  "id" text not null,
  "userId" text,
  "guestEmail" text,
  "identity" text,
  "step" text not null,
  "status" public."CheckoutSessionStatus" not null default 'ACTIVE',
  "lineCount" integer not null default 0,
  "itemQty" integer not null default 0,
  "cartTotal" decimal(12,2) not null default 0,
  "shippingCity" text,
  "shippingMethod" public."ShippingMethod",
  "paymentMethod" public."PaymentMethod",
  "orderId" text,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,
  constraint "CheckoutSession_pkey" primary key ("id")
);

create index if not exists "CheckoutSession_status_updatedAt_idx"
  on public."CheckoutSession" ("status", "updatedAt");
create index if not exists "CheckoutSession_userId_updatedAt_idx"
  on public."CheckoutSession" ("userId", "updatedAt");
create index if not exists "CheckoutSession_guestEmail_idx"
  on public."CheckoutSession" ("guestEmail");
create index if not exists "CheckoutSession_orderId_idx"
  on public."CheckoutSession" ("orderId");

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'CheckoutSession_userId_fkey') then
    alter table public."CheckoutSession"
      add constraint "CheckoutSession_userId_fkey"
      foreign key ("userId") references public."User"("id")
      on delete set null on update cascade;
  end if;

  if not exists (select 1 from pg_constraint where conname = 'CheckoutSession_orderId_fkey') then
    alter table public."CheckoutSession"
      add constraint "CheckoutSession_orderId_fkey"
      foreign key ("orderId") references public."Order"("id")
      on delete set null on update cascade;
  end if;
end $$;

-- 0009: checkout hardening, receipts, XML diagnostics, ERP foundation, CMS pages.
do $$
begin
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'InvoiceKind') then
    create type public."InvoiceKind" as enum ('PROFORMA', 'BUYER_RECEIPT');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'InvoiceStatus') then
    create type public."InvoiceStatus" as enum ('ISSUED', 'EMAIL_SENT', 'EMAIL_FAILED', 'CANCELLED');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'ErpCurrency') then
    create type public."ErpCurrency" as enum ('RSD', 'EUR', 'USD');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'PurchaseOrderStatus') then
    create type public."PurchaseOrderStatus" as enum ('DRAFT', 'SENT', 'CONFIRMED', 'RECEIVED', 'CANCELLED');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'InboundInvoiceType') then
    create type public."InboundInvoiceType" as enum ('DOM', 'INO', 'COGS');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'InboundInvoiceStatus') then
    create type public."InboundInvoiceStatus" as enum ('DRAFT', 'RECEIVED', 'POSTED', 'CANCELLED');
  end if;
  if not exists (select 1 from pg_type t join pg_namespace n on n.oid = t.typnamespace where n.nspname = 'public' and t.typname = 'CogsStatus') then
    create type public."CogsStatus" as enum ('PENDING', 'CALCULATED', 'LOCKED');
  end if;
end $$;

alter table public."Order"
  add column if not exists "publicAccessTokenHash" text,
  add column if not exists "publicAccessTokenCreatedAt" timestamp(3),
  add column if not exists "expiresAt" timestamp(3),
  add column if not exists "stockRestoredAt" timestamp(3),
  add column if not exists "cancelledAt" timestamp(3);

create unique index if not exists "Order_publicAccessTokenHash_key"
  on public."Order" ("publicAccessTokenHash");
create index if not exists "Order_expiresAt_idx"
  on public."Order" ("expiresAt");

alter table public."Product"
  add column if not exists "syncOverrides" jsonb;

alter table public."ImportRun"
  add column if not exists "dryRun" boolean not null default false,
  add column if not exists "errors" jsonb;

alter table public."Invoice"
  add column if not exists "kind" public."InvoiceKind" not null default 'PROFORMA',
  add column if not exists "status" public."InvoiceStatus" not null default 'ISSUED',
  add column if not exists "pdfObjectKey" text,
  add column if not exists "recipientEmail" text,
  add column if not exists "emailedAt" timestamp(3),
  add column if not exists "emailError" text,
  add column if not exists "snapshot" jsonb,
  add column if not exists "updatedAt" timestamp(3) not null default current_timestamp;

create unique index if not exists "Invoice_orderId_kind_key"
  on public."Invoice" ("orderId", "kind");
create index if not exists "Invoice_kind_issuedAt_idx"
  on public."Invoice" ("kind", "issuedAt");
create index if not exists "Invoice_status_issuedAt_idx"
  on public."Invoice" ("status", "issuedAt");

create table if not exists public."PurchasePrice" (
  "id" text not null,
  "productId" text,
  "supplierId" text,
  "sku" text not null,
  "name" text,
  "attributes" text,
  "pattern" text,
  "price" decimal(12,2) not null,
  "currency" public."ErpCurrency" not null default 'RSD',
  "parity" text,
  "validFrom" timestamp(3) not null,
  "validTo" timestamp(3),
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,
  constraint "PurchasePrice_pkey" primary key ("id")
);

create index if not exists "PurchasePrice_sku_idx"
  on public."PurchasePrice" ("sku");
create index if not exists "PurchasePrice_supplierId_validFrom_idx"
  on public."PurchasePrice" ("supplierId", "validFrom");
create index if not exists "PurchasePrice_productId_validFrom_idx"
  on public."PurchasePrice" ("productId", "validFrom");

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'PurchasePrice_productId_fkey') then
    alter table public."PurchasePrice"
      add constraint "PurchasePrice_productId_fkey"
      foreign key ("productId") references public."Product"("id")
      on delete set null on update cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'PurchasePrice_supplierId_fkey') then
    alter table public."PurchasePrice"
      add constraint "PurchasePrice_supplierId_fkey"
      foreign key ("supplierId") references public."Supplier"("id")
      on delete set null on update cascade;
  end if;
end $$;

create table if not exists public."PurchaseOrder" (
  "id" text not null,
  "number" text not null,
  "status" public."PurchaseOrderStatus" not null default 'DRAFT',
  "supplierId" text,
  "orderDate" timestamp(3),
  "loadingDate" timestamp(3),
  "deliveryDate" timestamp(3),
  "totalVolume" decimal(12,3),
  "totalWeight" decimal(12,3),
  "totalPrice" decimal(12,2) not null default 0,
  "currency" public."ErpCurrency" not null default 'RSD',
  "transportType" text,
  "parity" text,
  "bmPct" decimal(8,2),
  "pdfUrl" text,
  "notes" text,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,
  constraint "PurchaseOrder_pkey" primary key ("id")
);

create unique index if not exists "PurchaseOrder_number_key"
  on public."PurchaseOrder" ("number");
create index if not exists "PurchaseOrder_supplierId_createdAt_idx"
  on public."PurchaseOrder" ("supplierId", "createdAt");
create index if not exists "PurchaseOrder_status_createdAt_idx"
  on public."PurchaseOrder" ("status", "createdAt");

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'PurchaseOrder_supplierId_fkey') then
    alter table public."PurchaseOrder"
      add constraint "PurchaseOrder_supplierId_fkey"
      foreign key ("supplierId") references public."Supplier"("id")
      on delete set null on update cascade;
  end if;
end $$;

create table if not exists public."PurchaseOrderItem" (
  "id" text not null,
  "purchaseOrderId" text not null,
  "productId" text,
  "sku" text not null,
  "name" text not null,
  "attributes" text,
  "pattern" text,
  "purchasePrice" decimal(12,2) not null,
  "currency" public."ErpCurrency" not null default 'RSD',
  "parity" text,
  "moq" integer,
  "packQty" integer,
  "qty" integer not null,
  "receivedQty" integer not null default 0,
  "totalVolume" decimal(12,3),
  "totalWeight" decimal(12,3),
  "customsRate" decimal(8,2),
  "calcRetailPrice" decimal(12,2),
  "bmPct" decimal(8,2),
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,
  constraint "PurchaseOrderItem_pkey" primary key ("id")
);

create index if not exists "PurchaseOrderItem_purchaseOrderId_idx"
  on public."PurchaseOrderItem" ("purchaseOrderId");
create index if not exists "PurchaseOrderItem_sku_idx"
  on public."PurchaseOrderItem" ("sku");
create index if not exists "PurchaseOrderItem_productId_idx"
  on public."PurchaseOrderItem" ("productId");

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'PurchaseOrderItem_purchaseOrderId_fkey') then
    alter table public."PurchaseOrderItem"
      add constraint "PurchaseOrderItem_purchaseOrderId_fkey"
      foreign key ("purchaseOrderId") references public."PurchaseOrder"("id")
      on delete cascade on update cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'PurchaseOrderItem_productId_fkey') then
    alter table public."PurchaseOrderItem"
      add constraint "PurchaseOrderItem_productId_fkey"
      foreign key ("productId") references public."Product"("id")
      on delete set null on update cascade;
  end if;
end $$;

create table if not exists public."PurchaseOrderStatusEvent" (
  "id" text not null,
  "purchaseOrderId" text not null,
  "status" public."PurchaseOrderStatus" not null,
  "note" text,
  "actorId" text,
  "createdAt" timestamp(3) not null default current_timestamp,
  constraint "PurchaseOrderStatusEvent_pkey" primary key ("id")
);

create index if not exists "PurchaseOrderStatusEvent_purchaseOrderId_createdAt_idx"
  on public."PurchaseOrderStatusEvent" ("purchaseOrderId", "createdAt");

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'PurchaseOrderStatusEvent_purchaseOrderId_fkey') then
    alter table public."PurchaseOrderStatusEvent"
      add constraint "PurchaseOrderStatusEvent_purchaseOrderId_fkey"
      foreign key ("purchaseOrderId") references public."PurchaseOrder"("id")
      on delete cascade on update cascade;
  end if;
end $$;

create table if not exists public."InboundInvoice" (
  "id" text not null,
  "number" text not null,
  "type" public."InboundInvoiceType" not null,
  "supplierId" text,
  "status" public."InboundInvoiceStatus" not null default 'DRAFT',
  "invoiceDate" timestamp(3),
  "currency" public."ErpCurrency" not null default 'RSD',
  "value" decimal(12,2) not null default 0,
  "cogsStatus" public."CogsStatus" not null default 'PENDING',
  "notes" text,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,
  constraint "InboundInvoice_pkey" primary key ("id")
);

create unique index if not exists "InboundInvoice_number_key"
  on public."InboundInvoice" ("number");
create index if not exists "InboundInvoice_supplierId_invoiceDate_idx"
  on public."InboundInvoice" ("supplierId", "invoiceDate");
create index if not exists "InboundInvoice_status_invoiceDate_idx"
  on public."InboundInvoice" ("status", "invoiceDate");

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'InboundInvoice_supplierId_fkey') then
    alter table public."InboundInvoice"
      add constraint "InboundInvoice_supplierId_fkey"
      foreign key ("supplierId") references public."Supplier"("id")
      on delete set null on update cascade;
  end if;
end $$;

create table if not exists public."InboundInvoiceItem" (
  "id" text not null,
  "inboundInvoiceId" text not null,
  "productId" text,
  "sku" text,
  "name" text not null,
  "qty" integer not null default 1,
  "unitPrice" decimal(12,2) not null,
  "total" decimal(12,2) not null,
  "createdAt" timestamp(3) not null default current_timestamp,
  constraint "InboundInvoiceItem_pkey" primary key ("id")
);

create index if not exists "InboundInvoiceItem_inboundInvoiceId_idx"
  on public."InboundInvoiceItem" ("inboundInvoiceId");
create index if not exists "InboundInvoiceItem_sku_idx"
  on public."InboundInvoiceItem" ("sku");
create index if not exists "InboundInvoiceItem_productId_idx"
  on public."InboundInvoiceItem" ("productId");

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'InboundInvoiceItem_inboundInvoiceId_fkey') then
    alter table public."InboundInvoiceItem"
      add constraint "InboundInvoiceItem_inboundInvoiceId_fkey"
      foreign key ("inboundInvoiceId") references public."InboundInvoice"("id")
      on delete cascade on update cascade;
  end if;
  if not exists (select 1 from pg_constraint where conname = 'InboundInvoiceItem_productId_fkey') then
    alter table public."InboundInvoiceItem"
      add constraint "InboundInvoiceItem_productId_fkey"
      foreign key ("productId") references public."Product"("id")
      on delete set null on update cascade;
  end if;
end $$;

create table if not exists public."ContentPage" (
  "id" text not null,
  "slug" text not null,
  "title" text not null,
  "lead" text,
  "bodyMarkdown" text not null,
  "seoTitle" text,
  "seoDescription" text,
  "published" boolean not null default true,
  "createdAt" timestamp(3) not null default current_timestamp,
  "updatedAt" timestamp(3) not null,
  constraint "ContentPage_pkey" primary key ("id")
);

create unique index if not exists "ContentPage_slug_key"
  on public."ContentPage" ("slug");
create index if not exists "ContentPage_published_updatedAt_idx"
  on public."ContentPage" ("published", "updatedAt");

-- Record Prisma migrations as applied so future prisma migrate deploy does not
-- try to rerun migrations whose objects are already present in this Supabase DB.
-- Checksums are SHA-256 hashes from the committed migration.sql files.
insert into public._prisma_migrations (
  id,
  checksum,
  finished_at,
  migration_name,
  logs,
  rolled_back_at,
  started_at,
  applied_steps_count
)
select
  concat(
    substr(md5(v.migration_name), 1, 8), '-',
    substr(md5(v.migration_name), 9, 4), '-',
    substr(md5(v.migration_name), 13, 4), '-',
    substr(md5(v.migration_name), 17, 4), '-',
    substr(md5(v.migration_name), 21, 12)
  ),
  v.checksum,
  now(),
  v.migration_name,
  null,
  null,
  now(),
  1
from (
  values
    ('0002_product_excel_fields', 'd87c8ee16138b3e63095de0c051c6465b799800ad787a45556318a7da62cf129'),
    ('0003_mobile_comments_v3_product_fields', '2d7ff039056df514d8dc4757bb06954f2871e1d03fc5a1401cd984d217e89fce'),
    ('0004_payment_provider_state', '395e3af63d6589a6922172133959447fe3ac1882bfc5e0d3fc21b680d042a7a6'),
    ('0005_homepage_sections', '6d598dfc87abd26af98ccbb9c88434f9ec635d891399c422080e21ff374a431f'),
    ('0006_resend_email_system', '6e06cc030fa196450b01561c1b23d5b5e374f86188af7328c3a59f922fe0685a'),
    ('0007_x_express_courier', '21287486d1c66be2f8575c89c9cced7bf902adc4f769c94ded170ce267ce276d'),
    ('0008_checkout_sessions', '2f73a805913e36775d6deb766d84d641fb260090e0fd88fd987189c96da99d19'),
    ('0009_checkout_receipts_erp_foundation', '1991a2e576b96d2cb444ade0f324eb7712dafdf43c44f19c184ec18823df4434')
) as v(migration_name, checksum)
where not exists (
  select 1
  from public._prisma_migrations m
  where m.migration_name = v.migration_name
);

commit;
