import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { ProductAttachmentsEditor } from "@/components/admin/product-attachments-editor";

describe("PDP admin dokumenti", () => {
  it("renderuje uploader bez ugnježdene forme i bez ručnog naziva", () => {
    const markup = renderToStaticMarkup(
      <ProductAttachmentsEditor
        productId="product-1"
        productSku="110187"
        section="ASSEMBLY_INSTRUCTIONS"
        initialAttachments={[]}
      />,
    );

    expect(markup).not.toContain("<form");
    expect(markup).not.toContain("Naziv dokumenta");
    expect(markup).toContain("110187 uputstvo za sastavljanje");
    expect(markup).toContain("Dodaj dokument");
  });
});
