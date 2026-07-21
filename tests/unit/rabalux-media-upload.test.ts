import { describe, expect, it } from "vitest";
import { directStorageOrigin } from "@/lib/rabalux/media-upload";

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
});
