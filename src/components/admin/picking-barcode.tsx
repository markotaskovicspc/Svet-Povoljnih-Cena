import JsBarcode from "jsbarcode";

/** Render on the server so the bars are ready even for immediate auto-print. */
export function PickingBarcode({ value }: { value: string | null }) {
  if (!value) return <span>—</span>;

  // Code 128 preserves numeric identifiers (including leading zeros) and the
  // alphanumeric identifiers already present in the product catalogue.
  const encoded: { encodings?: Array<{ data: string }> } = {};
  let valid = false;
  JsBarcode(encoded, value, {
    format: "CODE128",
    displayValue: false,
    valid: (result) => { valid = result; },
  });
  const bits = valid ? encoded.encodings?.map((part) => part.data).join("") : null;
  const quietZone = 10;
  const width = (bits?.length ?? 0) + quietZone * 2;

  return (
    <div className="inline-flex break-inside-avoid flex-col items-center gap-1">
      {bits ? (
        <svg
          xmlns="http://www.w3.org/2000/svg"
          role="img"
          aria-label={`Bar kod ${value}`}
          width={width}
          height={60}
          viewBox={`0 0 ${width} 60`}
          className="block max-w-none"
          shapeRendering="crispEdges"
        >
          <rect width={width} height={60} fill="white" />
          {Array.from(bits, (bit, x) => bit === "1" ? (
            <rect key={x} x={x + quietZone} y={4} width={1} height={52} fill="black" />
          ) : null)}
        </svg>
      ) : (
        <span className="text-xs">Bar kod nije moguće prikazati</span>
      )}
      <span className="whitespace-nowrap font-mono text-xs">{value}</span>
    </div>
  );
}
