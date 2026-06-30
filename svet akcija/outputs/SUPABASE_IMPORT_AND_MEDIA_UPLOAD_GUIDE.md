# Svet Akcija Supabase Import And Image Upload Guide

This guide is for loading the enriched Svet Akcija catalog into Supabase.

You will do two big things:

1. Upload all original product images in one batch.
2. Generate and upload optimized WebP variants for thumbnails, product cards, and PDP galleries.
3. Paste one SQL file into Supabase to create/update products, descriptions, and image records.

The important files are:

- SQL to paste into Supabase: `outputs/Svet_akcija_supabase_import.sql`
- Image upload manifest: `outputs/svet-akcija-product-media-upload-manifest.json`
- Variant image manifest: `outputs/svet-akcija-product-media-variants.json`
- Variant image folder: `outputs/product-media-variants`
- Bulk image uploader: `outputs/upload-product-media-to-supabase.mjs`

Current catalog numbers:

- 209 products total
- 116 products have image folders and DOCX descriptions
- 93 products do not have matching image folders yet
- 892 image files will be uploaded
- 2,676 optimized variant files will be generated and uploaded after the originals

## Before You Start

You need:

- Supabase project opened in your browser
- Your Supabase project URL
- Your Supabase `service_role` key
- Node.js available on this computer

Important: the `service_role` key is powerful. Do not send it to anyone. Do not paste it into chat.

## Step 1: Create The Storage Bucket

1. Open Supabase.
2. Choose your project.
3. In the left menu, click `Storage`.
4. Click `New bucket`.
5. Bucket name: `product-media`
6. Make the bucket `Public`.
7. Click `Create bucket`.

Use exactly `product-media` unless you also change the upload command.

## Step 2: Find Your Supabase URL And Key

1. In Supabase, click `Project Settings`.
2. Click `API`.
3. Copy the `Project URL`.
4. Copy the `service_role` key.

Keep this page open. You need both values in Step 3.

## Step 3: Upload All Images In One Batch

Open Terminal in this project folder:

```bash
cd "/Users/luka/svet povoljnih cena/svet akcija"
```

Run this command, but replace the two placeholder values:

```bash
SUPABASE_URL="https://YOUR_PROJECT_ID.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY" \
SUPABASE_STORAGE_BUCKET="product-media" \
node outputs/upload-product-media-to-supabase.mjs
```

If Terminal says `node: command not found`, use this version instead:

```bash
SUPABASE_URL="https://YOUR_PROJECT_ID.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY" \
SUPABASE_STORAGE_BUCKET="product-media" \
"/Users/luka/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node" outputs/upload-product-media-to-supabase.mjs
```

What should happen:

- Terminal says it is uploading 892 files.
- It prints progress every 25 files.
- At the end it should say:

```text
Done. Uploaded: 892. Failed: 0.
```

If it says some files failed, run the same command again. The uploader uses upsert, so re-running is okay.

## Step 4: Generate And Upload Optimized Variants

Generate the three storefront variants:

```bash
npm run media:variants
```

This creates:

- `thumb` variants at 160px for search, cart, wishlist, and admin previews.
- `card` variants at 640px for product cards and listing grids.
- `pdp` variants at 1280px for product detail galleries.

Upload the generated variant manifest:

```bash
SUPABASE_URL="https://YOUR_PROJECT_ID.supabase.co" \
SUPABASE_SERVICE_ROLE_KEY="YOUR_SERVICE_ROLE_KEY" \
SUPABASE_STORAGE_BUCKET="product-media" \
node outputs/upload-product-media-to-supabase.mjs outputs/svet-akcija-product-media-variants.json
```

If Terminal says `node: command not found`, use the bundled Node path from Step 3 and keep the same manifest argument.

## Step 5: Check Images In Supabase

1. Go back to Supabase.
2. Click `Storage`.
3. Click the `product-media` bucket.
4. Open the `products` folder.
5. You should see folders like `1003`, `1081`, `1144`, `210025`.

Quick spot-check:

- `products/1081/001-1.png`
- `products/1144/001-1.png`
- `products/210025/001-210-025.png`
- `variants/thumb/products/1081/001-1-160.webp`
- `variants/card/products/1081/001-1-640.webp`
- `variants/pdp/products/1081/001-1-1280.webp`

If those exist, the image upload worked.

## Step 6: Paste The Catalog SQL Into Supabase

1. In Supabase, click `SQL Editor`.
2. Click `New query`.
3. Open this file on your computer:

```text
outputs/Svet_akcija_supabase_import.sql
```

4. Select everything inside that SQL file.
5. Copy it.
6. Paste it into the Supabase SQL Editor.
7. Click `Run`.

This SQL is idempotent. That means you can run it again later and it updates the same products instead of creating duplicates.

## Step 7: Check The SQL Results

After the SQL runs, Supabase should show result rows at the bottom.

You want to see roughly:

- `raw_rows` = 209
- `products_seeded` = 209
- `products_with_generated_media` = 116
- `generated_media_rows` = 892

There may also be a duplicate barcode review result. That is expected from the source catalog and is already handled by the import.

## Step 8: What This Import Does

The SQL does this:

- Creates/updates product rows.
- Uses DOCX text as the full product description when available.
- Keeps the original short product `Opis` as the short description.
- Creates product image rows in `ProductMedia`.
- Stores original image paths like `products/1081/001-1.png`.
- Stores variant paths in `thumbUrl`, `cardUrl`, and `pdpUrl`.
- Replaces only generated image rows with IDs like `sa-media-1081-001`.

It does not delete manually uploaded media unless the media ID starts with `sa-media-{sku}-`.

## Step 9: If Something Goes Wrong

If image upload fails:

- Check that the bucket exists.
- Check that the bucket name is `product-media`.
- Check that your `SUPABASE_URL` is correct.
- Check that you used the `service_role` key, not the anonymous key.
- Run the upload command again.

If variant generation fails:

- Check that dependencies are installed.
- Re-run `npm run media:variants`.
- Upload `outputs/svet-akcija-product-media-variants.json` again after generation succeeds.

If SQL fails:

- Do not panic.
- Copy the red error text from Supabase.
- Check whether the schema has already been created from `supabase-prisma-schema.sql`.
- Run the SQL again only after fixing the error.

## The Simple Order

Do it in this order:

1. Create bucket `product-media`.
2. Upload all original images with the terminal command.
3. Run `npm run media:variants`.
4. Upload `outputs/svet-akcija-product-media-variants.json`.
5. Confirm originals and variants are visible in Storage.
6. Paste and run `outputs/Svet_akcija_supabase_import.sql`.
7. Check that Supabase reports 209 products and 892 media rows.

That is the whole flow.
