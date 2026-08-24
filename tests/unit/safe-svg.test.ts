import { describe, expect, it } from "vitest";
import { validateSafeSvgBytes } from "@/lib/media/safe-svg";

const bytes = (source: string) => new TextEncoder().encode(source);

describe("safe SVG uploads", () => {
  it("accepts self-contained SVG artwork", () => {
    expect(
      validateSafeSvgBytes(
        bytes(
          '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#003579" d="M0 0h24v24H0z"/></svg>',
        ),
      ),
    ).toContain("<path");
  });

  it("accepts internal paint references and embedded raster images", () => {
    const embeddedPng =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
    expect(
      validateSafeSvgBytes(
        bytes(
          `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><linearGradient id="paint"><stop stop-color="#fff"/></linearGradient></defs><rect fill="url(#paint)" width="1" height="1"/><image xlink:href="data:image/png;base64,${embeddedPng}" width="1" height="1"/></svg>`,
        ),
      ),
    ).toContain("<image");
  });

  it("accepts benign generator metadata processing instructions", () => {
    expect(
      validateSafeSvgBytes(
        bytes(
          '<?xpacket begin="metadata"?><svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg><?xpacket end="w"?>',
        ),
      ),
    ).toContain("xpacket");
  });

  it("accepts and removes a standard external SVG doctype", () => {
    const output = validateSafeSvgBytes(
      bytes(
        '<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd"><svg xmlns="http://www.w3.org/2000/svg"><path d="M0 0h1v1z"/></svg>',
      ),
    );

    expect(output).toContain("<path");
    expect(output).not.toContain("<!DOCTYPE");
    expect(output).not.toContain("svg11.dtd");
  });

  it("removes unused internal entity declarations", () => {
    const output = validateSafeSvgBytes(
      bytes(
        '<!DOCTYPE svg [<!ENTITY unused "safe metadata">]><svg xmlns="http://www.w3.org/2000/svg"/>',
      ),
    );

    expect(output).toBe('<svg xmlns="http://www.w3.org/2000/svg"/>');
  });

  it("normalizes legacy Illustrator namespaces and removes PGF fallbacks", () => {
    const output = validateSafeSvgBytes(
      bytes(
        `<?xml version="1.0"?><!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd" [<!ENTITY ns_ai "http://ns.adobe.com/AdobeIllustrator/10.0/">]><svg xmlns="http://www.w3.org/2000/svg" xmlns:i="&ns_ai;" xmlns:xlink="http://www.w3.org/1999/xlink"><switch><foreignObject requiredExtensions="&ns_ai;"><i:aipgfRef xlink:href="#adobe_pgf"/></foreignObject><g i:extraneous="self"><path d="M0 0h1v1z"/></g></switch><i:aipgf id="adobe_pgf"><![CDATA[generator payload]]></i:aipgf></svg>`,
      ),
    );

    expect(output).toContain("<path");
    expect(output).not.toContain("<!DOCTYPE");
    expect(output).not.toContain("foreignObject");
    expect(output).not.toContain("aipgf");
    expect(output).not.toContain("&ns_ai;");
  });

  it("rejects custom entity references instead of resolving them", () => {
    expect(() =>
      validateSafeSvgBytes(
        bytes(
          '<!DOCTYPE svg [<!ENTITY external SYSTEM "file:///etc/passwd">]><svg xmlns="http://www.w3.org/2000/svg">&external;</svg>',
        ),
      ),
    ).toThrow("Fajl nije ispravan SVG dokument.");
  });

  it("still rejects stylesheet processing instructions", () => {
    expect(() =>
      validateSafeSvgBytes(
        bytes(
          '<?xml-stylesheet href="https://evil.example/a.css"?><svg xmlns="http://www.w3.org/2000/svg"/>',
        ),
      ),
    ).toThrow("spoljne deklaracije");
  });

  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="../slika.png"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="https://evil.example/a.png"/></svg>',
  ])("rejects linked raster images with an actionable message", (source) => {
    expect(() => validateSafeSvgBytes(bytes(source))).toThrow(
      "Ugradite je u SVG (Embed)",
    );
  });

  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/svg+xml;base64,PHN2Zy8+"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,PHN2Zy8+"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><rect fill="url(https://evil.example/a.svg)"/></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg"><style>@import "https://evil.example/a.css"</style></svg>',
  ])("rejects unsafe embedded or CSS resources", (source) => {
    expect(() => validateSafeSvgBytes(bytes(source))).toThrow();
  });

  it.each([
    '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
    '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    '<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div>HTML</div></foreignObject></svg>',
  ])("rejects active or externally loaded markup", (source) => {
    expect(() => validateSafeSvgBytes(bytes(source))).toThrow();
  });
});
