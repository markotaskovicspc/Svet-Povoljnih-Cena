-- Manual retail sales are a distinct ERP channel. WEB remains reserved for
-- customer-created storefront orders, while MP identifies admin-entered sales.
ALTER TYPE "SalesChannel" ADD VALUE IF NOT EXISTS 'MP' BEFORE 'VP';
