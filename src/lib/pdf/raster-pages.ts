import "server-only";

export function rasterJpegPagesPdf(input: {
  pages: Buffer[];
  pixelWidth: number;
  pixelHeight: number;
  pdfWidth: number;
  pdfHeight: number;
}) {
  const objects: Buffer[] = [];
  const push = (body: Buffer | string) => {
    objects.push(typeof body === "string" ? Buffer.from(body, "binary") : body);
    return objects.length;
  };

  const pageObjectIds: number[] = [];
  for (const [index, jpeg] of input.pages.entries()) {
    const imageObject = push(
      Buffer.concat([
        Buffer.from(
          `<< /Type /XObject /Subtype /Image /Width ${input.pixelWidth} /Height ${input.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`,
          "binary",
        ),
        jpeg,
        Buffer.from("\nendstream", "binary"),
      ]),
    );
    const imageName = `/Im${index + 1}`;
    const stream = `q\n${input.pdfWidth} 0 0 ${input.pdfHeight} 0 0 cm\n${imageName} Do\nQ`;
    const contentObject = push(
      `<< /Length ${Buffer.byteLength(stream, "binary")} >>\nstream\n${stream}\nendstream`,
    );
    pageObjectIds.push(
      push(
        `<< /Type /Page /Parent __PARENT__ /MediaBox [0 0 ${input.pdfWidth} ${input.pdfHeight}] /Contents ${contentObject} 0 R /Resources << /XObject << ${imageName} ${imageObject} 0 R >> >> >>`,
      ),
    );
  }

  const pagesObject = push(
    `<< /Type /Pages /Kids [${pageObjectIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageObjectIds.length} >>`,
  );
  const catalogObject = push(`<< /Type /Catalog /Pages ${pagesObject} 0 R >>`);
  for (const pageObject of pageObjectIds) {
    objects[pageObject - 1] = Buffer.from(
      objects[pageObject - 1]!
        .toString("binary")
        .replace("__PARENT__", `${pagesObject} 0 R`),
      "binary",
    );
  }

  const header = Buffer.from("%PDF-1.4\n%\xE2\xE3\xCF\xD3\n", "binary");
  const blocks: Buffer[] = [header];
  const offsets: number[] = [];
  let offset = header.length;
  objects.forEach((object, index) => {
    offsets.push(offset);
    const block = Buffer.concat([
      Buffer.from(`${index + 1} 0 obj\n`, "binary"),
      object,
      Buffer.from("\nendobj\n", "binary"),
    ]);
    blocks.push(block);
    offset += block.length;
  });

  const xrefOffset = offset;
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const itemOffset of offsets) {
    xref += `${String(itemOffset).padStart(10, "0")} 00000 n \n`;
  }
  blocks.push(
    Buffer.from(
      `${xref}trailer\n<< /Size ${objects.length + 1} /Root ${catalogObject} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`,
      "binary",
    ),
  );
  return Buffer.concat(blocks);
}
