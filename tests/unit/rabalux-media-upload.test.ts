import { describe, expect, it } from "vitest";
import {
  directStorageOrigin,
  rabaluxMediaJobIdempotencyKey,
  toRabaluxMediaUploadBody,
} from "@/lib/rabalux/media-upload";

describe("Rabalux resumable media upload", () => {
  it("uses the direct Supabase Storage hostname for cloud projects", () => {
    expect(directStorageOrigin("https://project-ref.supabase.co/path?ignored=1")).toBe(
      "https://project-ref.storage.supabase.co",
    );
  });

  it("keeps custom and local storage origins unchanged", () => {
    expect(directStorageOrigin("http://127.0.0.1:54321/path")).toBe(
      "http://127.0.0.1:54321",
    );
  });

  it("copies binary bytes into an isolated ArrayBuffer", () => {
    const backing = new Uint8Array([9, 0x52, 0x80, 0xff, 0x00, 0x49, 8]);
    const source = backing.subarray(1, 6);

    expect(
      Array.from(new Uint8Array(toRabaluxMediaUploadBody(source))),
    ).toEqual([0x52, 0x80, 0xff, 0x00, 0x49]);
  });

  it("versions media jobs so corrupted legacy uploads can be rebuilt", () => {
    expect(rabaluxMediaJobIdempotencyKey("asset-1", "MEDIA")).toBe(
      "rabalux-binary-v2-asset:MEDIA:asset-1",
    );
    expect(rabaluxMediaJobIdempotencyKey("attachment-1", "ATTACHMENT")).toBe(
      "rabalux-binary-v2-asset:ATTACHMENT:attachment-1",
    );
  });
});
