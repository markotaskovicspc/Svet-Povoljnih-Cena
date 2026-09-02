import sharp from "sharp";
import { describe, expect, it } from "vitest";
import {
  buildProductImageRenditions,
  productImageVariantKey,
  PRODUCT_IMAGE_VARIANTS,
} from "@/lib/product-media/image-variants";

describe("product image variants", () => {
  it("builds bounded WebP renditions and immutable storage keys", async () => {
    const source = await sharp({
      create: {
        width: 2000,
        height: 1000,
        channels: 3,
        background: { r: 80, g: 120, b: 160 },
      },
    })
      .jpeg()
      .toBuffer();
    const sourceKey = "products/product-1/photo.original.jpg";

    const result = await buildProductImageRenditions(source, sourceKey);

    expect(result).toMatchObject({ width: 2000, height: 1000 });
    expect(result.variants.map(({ name, width, key }) => ({ name, width, key })))
      .toEqual([
        {
          name: "thumb",
          width: 160,
          key: "variants/thumb/products/product-1/photo.original-160.webp",
        },
        {
          name: "card",
          width: 640,
          key: "variants/card/products/product-1/photo.original-640.webp",
        },
        {
          name: "pdp",
          width: 1280,
          key: "variants/pdp/products/product-1/photo.original-1280.webp",
        },
      ]);
    const dimensions = await Promise.all(
      result.variants.map(async (variant) => {
        const metadata = await sharp(variant.buffer).metadata();
        return [metadata.format, metadata.width, metadata.height];
      }),
    );
    expect(dimensions).toEqual([
      ["webp", 160, 80],
      ["webp", 640, 320],
      ["webp", 1280, 640],
    ]);
  });

  it("does not enlarge small originals", async () => {
    const source = await sharp({
      create: {
        width: 100,
        height: 50,
        channels: 3,
        background: "white",
      },
    })
      .png()
      .toBuffer();

    const result = await buildProductImageRenditions(
      source,
      "products/product-1/small.png",
    );

    for (const variant of result.variants) {
      const metadata = await sharp(variant.buffer).metadata();
      expect([metadata.width, metadata.height]).toEqual([100, 50]);
    }
  });

  it("rejects malformed input and generates the same keys deterministically", async () => {
    await expect(
      buildProductImageRenditions(
        Buffer.from("not-an-image"),
        "products/product-1/bad.jpg",
      ),
    ).rejects.toThrow("čitljiva slika");
    expect(
      productImageVariantKey(
        "products/product-1/photo.jpg",
        PRODUCT_IMAGE_VARIANTS[1],
      ),
    ).toBe("variants/card/products/product-1/photo-640.webp");
  });
});
