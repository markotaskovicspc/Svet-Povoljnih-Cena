# CUBE / X DESK material refinement — 2026-09-12

Three free CC0 Blendkit materials were downloaded locally; exact authors, source pages, library revisions and SHA-256 hashes are recorded in `blendkit-sources.json`. Raw libraries live in the ignored `blendkit/` directory. An initial Warm Oak Wood candidate was downloaded but is not used in either export.

- CUBE: Ribbed Corduroy (Poly Haven; colormass / Rico Cilliers) supplies restrained microfiber normal and roughness variation. The source's average wale profile is removed so it does not add a conflicting second rib pattern. The brown photo atlas, visible rib spacing/direction and geometry remain unchanged.
- X DESK oak decor: Oak Wood Natural Clean supplies subdued roughness variation. The original photographed wood color and grain remain unchanged; no wood displacement is added.
- X DESK frame: Powder Coated Metal supplies baked coating normal and roughness over a 25 mm tile. The original black color remains unchanged. Only metal UVs change to establish this coating scale.

Surface response is an appearance estimate, not a measured scan of these products. Library colors are not used. Hidden product details remain the documented reconstruction in the original model notes.

## Delivery and verification

| Product | Web / Android GLB | iPhone USDZ | Triangles |
| --- | ---: | ---: | ---: |
| CUBE v6 | 1,648,864 bytes | 1,967,117 bytes | 20,736 |
| X DESK v2 | 475,856 bytes | 397,764 bytes | 2,584 |

New immutable versions live in the existing public `product-models` Storage bucket. The application manifest points to them. No database or AR interaction changes are included. Original product photos still load first, with the existing optional 3D warmup policy.

`glb-validation.json` verifies exact canonical triangle equality and original base-color JPEG SHA equality against the previously delivered models. Both products remain within 1 mm of their declared dimensions, rest on the floor and pass GLB validation with zero errors/warnings. Tangent vectors are included for consistent normal-map shading. `usdz-validation.json` records zero ARKit compliance errors, failed checks or warnings, embedded textures, Y up, metres and aligned uncompressed USDZ entries. `compression-report.json` records >42 dB PSNR for supplementary map compression; photographic base-color bytes are untouched.

Both delivered formats were reimported and rendered in the original Blender studio. The four renders under each product's local `renders/` directory were visually inspected for material/color consistency. Physical Android/iPhone camera tracking remains unverified; this material update does not resolve or establish support for the previously reported unidentified Xiaomi.

## Rebuild locally

The refined, packed sources are `assets/cube-210030/cube-blendkit.blend` and `assets/x-desk-210027/x-desk-blendkit.blend`. To re-export those sources:

```sh
/Applications/Blender.app/Contents/MacOS/Blender -b --disable-autoexec --python scripts/blender/export_blendkit_models.py
node scripts/blender/optimize-blendkit-delivery.mjs
/tmp/cube-usd-venv/bin/python scripts/blender/pack_blendkit_usdz.py
node scripts/blender/validate-blendkit-models.mjs
/tmp/cube-usd-venv/bin/python scripts/blender/validate_blendkit_usdz.py
/Applications/Blender.app/Contents/MacOS/Blender -b --disable-autoexec --python scripts/blender/render_blendkit_roundtrip.py
node scripts/blender/prepare-blendkit-posters.mjs
```

USD tooling uses usd-core 25.11 and the official shader resources restored by `bootstrap_cube_usd.py`. Validation comparisons require the previous GLB versions downloaded from Storage. Raw authoring can be repeated with `python3 scripts/blender/download-blendkit-materials.py`, followed by Blender `enhance_product_materials.py`; this also requires the original local `cube-corrected.blend` (reconstructable via `rebuild_cube_from_photos.py`), original photo atlas and `x-desk.blend`.

Publish scripts upload only reviewed delivery files and refuse to overwrite an existing version with different bytes. Choose new version names for further changes. Blender authoring files remain local/Git; only GLB, USDZ and posters are public delivery assets.
