"use client"

import * as React from "react"
import { encodeQr, type Ecc } from "@/lib/ar-qr"

type QrCodeProps = {
  /** The text/URL to encode. */
  value: string
  /** Rendered pixel size of the QR (square). Default 220. */
  size?: number
  /** Error-correction level. "M" balances density and resilience. */
  ecl?: Ecc
  /** Quiet-zone width in modules (spec minimum is 4). */
  margin?: number
  dark?: string
  light?: string
  className?: string
}

/**
 * Renders a QR code as a single crisp SVG path — no canvas, no images, no
 * network. The whole dark layer is one `<path>` so it stays sharp at any size
 * and prints cleanly.
 */
export function QrCode({
  value,
  size = 220,
  ecl = "M",
  margin = 4,
  dark = "#0b1f17",
  light = "#ffffff",
  className,
}: QrCodeProps) {
  const { path, dimension } = React.useMemo(() => {
    const modules = encodeQr(value, ecl)
    const count = modules.length
    const dim = count + margin * 2

    let d = ""
    for (let y = 0; y < count; y++) {
      for (let x = 0; x < count; x++) {
        if (modules[y][x]) {
          d += `M${x + margin} ${y + margin}h1v1h-1z`
        }
      }
    }
    return { path: d, dimension: dim }
  }, [value, ecl, margin])

  return (
    <svg
      className={className}
      width={size}
      height={size}
      viewBox={`0 0 ${dimension} ${dimension}`}
      role="img"
      aria-label="QR kod za prikaz proizvoda u vašoj sobi"
      shapeRendering="crispEdges"
    >
      <rect width={dimension} height={dimension} fill={light} />
      <path d={path} fill={dark} />
    </svg>
  )
}
