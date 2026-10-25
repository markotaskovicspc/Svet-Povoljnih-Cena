import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PdpAttributes } from "@/components/product/pdp-attributes";
import { projectGroupedAttributes, type GroupedAttribute } from "@/lib/grouped-attributes";
import type { Product } from "@/types";

const mocks = vi.hoisted(() => ({ product: vi.fn() }));
vi.mock("@/lib/api/catalog", () => ({
  getProductBySlug: mocks.product,
  listProductRail: vi.fn().mockResolvedValue({ items: [] }),
}));
vi.mock("@/lib/cms/pages", () => ({ getPublishedContentPage: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/seo/catalog.server", () => ({ getSeoCatalog: vi.fn().mockResolvedValue(null) }));
import ProductPage from "@/app/(shop)/p/[slug]/page";

const power: GroupedAttribute = {
  sectionId: "power", sectionName: "Snaga", sectionOrder: 1,
  optionId: "1200w", value: "1200 W", order: 0,
};
const capacity: GroupedAttribute = {
  sectionId: "capacity", sectionName: "Zapremina", sectionOrder: 0,
  optionId: "12l", value: "12 L", order: 0,
};

const product: Product = {
  sku: "210007", slug: "rerna-bake-master", name: "Rerna BAKE MASTER",
  group: "", categoryPath: [], description: "Električna rerna",
  dimensionsCm: { w: 33, d: 18, h: 20 },
  attributes: ["STARI ATRIBUT 1", "STARI ATRIBUT 2"],
  groupedAttributes: [power, capacity],
  materials: [], pictograms: [], stock: 5, incomingStock: 0,
  fullPrice: 4284, deliveryDays: { min: 1, max: 2 }, allowsAssembly: false,
  assemblyCities: [], media: { images: [] }, recommendedSkus: [], frequentlyBoughtSkus: [],
};

function findAttributes(node: ReactNode): ReactElement<{ attributes?: GroupedAttribute[] }> | null {
  for (const child of Children.toArray(node)) {
    if (!isValidElement<{ children?: ReactNode }>(child)) continue;
    if (child.type === PdpAttributes) return child as ReactElement<{ attributes?: GroupedAttribute[] }>;
    const found = findAttributes(child.props.children);
    if (found) return found;
  }
  return null;
}

async function renderPageAttributes(value: Product) {
  mocks.product.mockResolvedValue(value);
  const page = await ProductPage({ params: Promise.resolve({ slug: value.slug }) });
  const attributes = findAttributes(page);
  expect(attributes, "The product page must render the new attribute component").not.toBeNull();
  return renderToStaticMarkup(attributes);
}

beforeEach(() => vi.clearAllMocks());

describe("novi atributi na stranici proizvoda", () => {
  it("prikazuje nazive i vrednosti novih atributa čak i kada artikal ima stare", async () => {
    const html = await renderPageAttributes(product);
    expect(html).toContain('aria-label="Atributi proizvoda"');
    for (const text of ["Snaga", "1200 W", "Zapremina", "12 L"]) expect(html).toContain(text);
    expect(html).not.toContain("STARI ATRIBUT");
    expect(html.indexOf("Zapremina")).toBeLessThan(html.indexOf("Snaga"));
  });

  it.each([undefined, []])("ne vraća stare atribute kada novih nema (%j)", async (groupedAttributes) => {
    expect(await renderPageAttributes({ ...product, groupedAttributes })).toBe("");
  });

  it("prikazuje više vrednosti po grupi samo jednom, u redosledu iz administracije", () => {
    const stronger = { ...power, optionId: "1500w", value: "1500 W", order: 1 };
    const attributes = [stronger, power, power, capacity];
    const html = renderToStaticMarkup(<PdpAttributes attributes={attributes} />);
    expect(html.match(/1200 W/g)).toHaveLength(1);
    expect(html.match(/Snaga/g)).toHaveLength(1);
    expect(html.indexOf("1200 W")).toBeLessThan(html.indexOf("1500 W"));
    expect(attributes).toEqual([stronger, power, power, capacity]);
  });

  it("ne prikazuje deaktivirane opcije i grupe niti prelazi na stare atribute", async () => {
    const section = { id: "power", name: "Snaga", order: 0, active: true };
    const option = { id: "1200w", value: "1200 W", order: 0, active: true, section };
    const groupedAttributes = projectGroupedAttributes([
      { option: { ...option, active: false } },
      { option: { ...option, section: { ...section, active: false } } },
    ]);
    expect(await renderPageAttributes({ ...product, groupedAttributes })).toBe("");
  });

  it("ne prikazuje prazan blok kada nema ni starih ni novih atributa", async () => {
    expect(await renderPageAttributes({ ...product, attributes: [], groupedAttributes: [] })).toBe("");
  });
});
