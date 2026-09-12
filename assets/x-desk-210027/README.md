# X DESK 210027 — 100010-9ce68e

Photo-based Blender 5.2 model of the assembled light-oak / black desk. Retailer dimensions: **70 × 48 × 74 cm**. Local source: `x-desk.blend`. Authoring uses metres, Z up, floor Z=0; both delivery formats use Y up and metres.

## Sources and reconstruction

Original product photographs are in `references/`; exact public URLs and product identity are recorded in `references/sources.json`. Studio photos 01, 03 and 04 establish the geometry. Lifestyle photo 02 is contextual only. No generated references, synthesized wood grain or invented relief were used.

The 1024² JPEG atlas is perspective-rectified from the original desktop in 01 and the reinforcing panel / edge band in 04. Sampling quadrilaterals are recorded in `model-report.json`. The source photographs limit the amount of visible detail; magnification cannot reveal grain not present in them. The sloped reinforcing panel follows the broad diagonal legs, with separate thin cross braces and four levelling feet.

Only the outer dimensions are published measurements. Member sections, panel thickness, fasteners and obscured joints are estimated from photos. Unphotographed underside / reverse panel reuse the original oak decor. Paint and laminate roughness are estimates, not measured material scans. No normal map is fabricated from photographic illumination.

## Repeatable local build

From the application root:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/build_x_desk.py
node scripts/blender/validate-x-desk.mjs
/tmp/cube-usd-venv/bin/python scripts/blender/validate_x_desk_usdz.py
/Applications/Blender.app/Contents/MacOS/Blender -b --python scripts/blender/render_x_desk_roundtrip.py
node scripts/blender/prepare-x-desk.mjs
node scripts/blender/publish-x-desk-storage.mjs
```

USD validation uses usd-core 25.11 with the official shader resources restored by `scripts/blender/bootstrap_cube_usd.py` when needed. Render outputs stay local. The compact packed `.blend`, repeatable script, original references, atlas and validation reports are kept in Git.

## Delivery

- GLB: `public/models/x-desk-210027/x-desk-v1.glb`, web / Android.
- USDZ: `public/models/x-desk-210027/x-desk-v1.usdz`, iPhone Quick Look.
- Poster: `public/models/x-desk-210027/poster-v1.webp`.
- Public immutable copies: the `x-desk-210027/` folder in the existing `product-models` Supabase Storage bucket; exact URLs in `src/lib/product-ar-storage.json`.
- Original photo remains first. Existing gallery supplies on-demand 3D, idle warmup on eligible connections, full screen, the lower camera limit, QR and fixed-scale native AR.

The validators check the 1 mm dimension tolerance, floor contact, embedded JPEG, Y up, size / geometry budgets and GLB / ARKit USDZ compliance. Browser tests verify model loading, dimensions, full screen and both native launch URLs. Actual camera launch, tracking and floor placement require a physical supported Android / iPhone test and remain **unverified**. The previously reported Xiaomi / Google Lens issue is not resolved by adding this desk model.
