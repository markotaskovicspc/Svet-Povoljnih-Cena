"use client";

/**
 * Visual placeholder for an IPS NBS / generic payment QR code.
 * Renders a deterministic noise grid keyed off the payload string so different
 * orders produce visually different "QR codes" without pulling a heavy QR
 * library in Phase 2. The real `qrcode` lib is wired in Phase 4 once the WSPay
 * + IPS issuer string lands.
 */
export function FauxQrCode({
  payload,
  size = 220,
}: {
  payload: string;
  size?: number;
}) {
  const grid = 25;
  const cell = size / grid;
  const cells: { x: number; y: number }[] = [];
  // 32-bit FNV-1a hash → reproducible per payload.
  let h = 2166136261;
  for (let i = 0; i < payload.length; i++) {
    h ^= payload.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  // Quiet zone of 2 cells; finder-pattern squares in 3 corners.
  const isFinder = (x: number, y: number) => {
    const inBox = (ox: number, oy: number) =>
      x >= ox && x <= ox + 6 && y >= oy && y <= oy + 6;
    return inBox(2, 2) || inBox(grid - 9, 2) || inBox(2, grid - 9);
  };
  for (let y = 2; y < grid - 2; y++) {
    for (let x = 2; x < grid - 2; x++) {
      if (isFinder(x, y)) continue;
      h = Math.imul(h ^ (x * 31 + y), 16777619);
      if (((h >>> 0) % 100) < 48) cells.push({ x, y });
    }
  }
  const finder = (ox: number, oy: number) => (
    <g key={`f-${ox}-${oy}`}>
      <rect
        x={ox * cell}
        y={oy * cell}
        width={7 * cell}
        height={7 * cell}
        fill="#1A1714"
      />
      <rect
        x={(ox + 1) * cell}
        y={(oy + 1) * cell}
        width={5 * cell}
        height={5 * cell}
        fill="#FAF7F2"
      />
      <rect
        x={(ox + 2) * cell}
        y={(oy + 2) * cell}
        width={3 * cell}
        height={3 * cell}
        fill="#1A1714"
      />
    </g>
  );

  return (
    <svg
      role="img"
      aria-label="QR kod za plaćanje"
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="bg-canvas ring-border/60 rounded-xl ring-1"
    >
      <rect width={size} height={size} fill="#FAF7F2" />
      {finder(2, 2)}
      {finder(grid - 9, 2)}
      {finder(2, grid - 9)}
      {cells.map((c) => (
        <rect
          key={`${c.x}-${c.y}`}
          x={c.x * cell}
          y={c.y * cell}
          width={cell}
          height={cell}
          fill="#1A1714"
        />
      ))}
    </svg>
  );
}
