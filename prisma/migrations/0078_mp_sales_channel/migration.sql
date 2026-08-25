-- Launch support for manual retail (MP) sales orders.
ALTER TYPE "SalesChannel" ADD VALUE IF NOT EXISTS 'MP';
