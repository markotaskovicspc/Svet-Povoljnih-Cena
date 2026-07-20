import { afterEach, describe, expect, it } from "vitest";
import {
  getManagedProductMediaStorageKey,
  getManagedProductMediaStorageKeys,
} from "../../src/lib/supabase/storage";

const previousUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const previousBucket = process.env.NEXT_PUBLIC_SUPABASE_PRODUCT_MEDIA_BUCKET;

afterEach(() => {
  if (previousUrl === undefined) delete process.env.NEXT_PUBLIC_SUPABASE_URL;
  else process.env.NEXT_PUBLIC_SUPABASE_URL = previousUrl;
  if (previousBucket === undefined) {
    delete process.env.NEXT_PUBLIC_SUPABASE_PRODUCT_MEDIA_BUCKET;
  } else {
    process.env.NEXT_PUBLIC_SUPABASE_PRODUCT_MEDIA_BUCKET = previousBucket;
  }
});

describe("managed product-media storage keys", () => {
  it("recognizes internal object keys", () => {
    expect(
      getManagedProductMediaStorageKey("products/test/photo.jpg"),
    ).toBe("products/test/photo.jpg");
    expect(getManagedProductMediaStorageKey("/logo.jpeg")).toBeNull();
    expect(
      getManagedProductMediaStorageKey("https://images.example.com/photo.jpg"),
    ).toBeNull();
  });

  it("extracts keys from this project's public Supabase URLs", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://project.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PRODUCT_MEDIA_BUCKET = "product-media";
    expect(
      getManagedProductMediaStorageKey(
        "https://project.supabase.co/storage/v1/object/public/product-media/products/test/photo%201.jpg",
      ),
    ).toBe("products/test/photo 1.jpg");
  });

  it("deduplicates original and variant storage keys", () => {
    expect(
      getManagedProductMediaStorageKeys({
        url: "products/test/photo.jpg",
        thumbUrl: "variants/thumb/photo.jpg",
        cardUrl: "variants/thumb/photo.jpg",
        pdpUrl: "/fallback.jpg",
      }),
    ).toEqual([
      "products/test/photo.jpg",
      "variants/thumb/photo.jpg",
    ]);
  });
});
