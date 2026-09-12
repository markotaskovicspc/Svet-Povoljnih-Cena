/*
 * QR Code generator library (TypeScript)
 *
 * Copyright (c) Project Nayuki. (MIT License)
 * https://www.nayuki.io/page/qr-code-generator-library
 *
 * Permission is hereby granted, free of charge, to any person obtaining a copy of
 * this software and associated documentation files (the "Software"), to deal in
 * the Software without restriction, including without limitation the rights to
 * use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of
 * the Software, and to permit persons to whom the Software is furnished to do so,
 * subject to the following conditions:
 * - The above copyright notice and this permission notice shall be included in
 *   all copies or substantial portions of the Software.
 * - The Software is provided "as is", without warranty of any kind, express or
 *   implied, including but not limited to the warranties of merchantability,
 *   fitness for a particular purpose and noninfringement. In no event shall the
 *   authors or copyright holders be liable for any claim, damages or other
 *   liability, whether in an action of contract, tort or otherwise, arising from,
 *   out of or in connection with the Software or the use or other dealings in the
 *   Software.
 */

/**
 * Zero-dependency QR Code generator (byte / UTF-8 mode).
 *
 * Ported and trimmed from Project Nayuki's "QR Code generator library"
 * (https://www.nayuki.io/page/qr-code-generator-library), MIT License.
 * Only byte-mode segments are supported, which is all we need for URLs.
 *
 * `encodeQr(text)` returns a square boolean matrix where `true` is a dark
 * module. Rendering is left to the caller (see components/QrCode.tsx).
 *
 * This runs fully offline — no third-party QR API — so customer/product URLs
 * are never sent to an external service.
 */

export type Ecc = "L" | "M" | "Q" | "H"

const ECC_ORDINAL: Record<Ecc, number> = { L: 0, M: 1, Q: 2, H: 3 }
// Format-info bit pattern per ECC level, indexed by ordinal above.
const ECC_FORMAT_BITS = [1, 0, 3, 2]

const MIN_VERSION = 1
const MAX_VERSION = 40

// Number of error-correction codewords per block, indexed [eccOrdinal][version].
const ECC_CODEWORDS_PER_BLOCK: number[][] = [
  // 0 is unused padding so the version number can index directly.
  [-1, 7, 10, 15, 20, 26, 18, 20, 24, 30, 18, 20, 24, 26, 30, 22, 24, 28, 30, 28, 28, 28, 28, 30, 30, 26, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28],
  [-1, 13, 22, 18, 26, 18, 24, 18, 22, 20, 24, 28, 26, 24, 20, 30, 24, 28, 28, 26, 30, 28, 30, 30, 30, 30, 28, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
  [-1, 17, 28, 22, 16, 22, 28, 26, 26, 24, 28, 24, 28, 22, 24, 24, 30, 28, 28, 26, 28, 30, 24, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30, 30],
]

// Number of error-correction blocks, indexed [eccOrdinal][version].
const NUM_ERROR_CORRECTION_BLOCKS: number[][] = [
  [-1, 1, 1, 1, 1, 1, 2, 2, 2, 2, 4, 4, 4, 4, 4, 6, 6, 6, 6, 7, 8, 8, 9, 9, 10, 12, 12, 12, 13, 14, 15, 16, 17, 18, 19, 19, 20, 21, 22, 24, 25],
  [-1, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23, 25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49],
  [-1, 1, 1, 2, 2, 4, 4, 6, 6, 8, 8, 8, 10, 12, 16, 12, 17, 16, 18, 21, 20, 23, 23, 25, 27, 29, 34, 34, 35, 38, 40, 43, 45, 48, 51, 53, 56, 59, 62, 65, 68],
  [-1, 1, 1, 2, 4, 4, 4, 5, 6, 8, 8, 11, 11, 16, 16, 18, 16, 19, 21, 25, 25, 25, 34, 30, 32, 35, 37, 40, 42, 45, 48, 51, 54, 57, 60, 63, 66, 70, 74, 77, 81],
]

function getNumRawDataModules(ver: number): number {
  let result = (16 * ver + 128) * ver + 64
  if (ver >= 2) {
    const numAlign = Math.floor(ver / 7) + 2
    result -= (25 * numAlign - 10) * numAlign - 55
    if (ver >= 7) result -= 36
  }
  return result
}

function getNumDataCodewords(ver: number, eccOrd: number): number {
  return (
    Math.floor(getNumRawDataModules(ver) / 8) -
    ECC_CODEWORDS_PER_BLOCK[eccOrd][ver] * NUM_ERROR_CORRECTION_BLOCKS[eccOrd][ver]
  )
}

// ---- Reed-Solomon error correction over GF(256), x^8 + x^4 + x^3 + x^2 + 1 ----

function reedSolomonMultiply(x: number, y: number): number {
  let z = 0
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d)
    z ^= ((y >>> i) & 1) * x
  }
  return z & 0xff
}

function reedSolomonComputeDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0)
  result[degree - 1] = 1
  let root = 1
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = reedSolomonMultiply(result[j], root)
      if (j + 1 < result.length) result[j] ^= result[j + 1]
    }
    root = reedSolomonMultiply(root, 0x02)
  }
  return result
}

function reedSolomonComputeRemainder(data: number[], divisor: number[]): number[] {
  const result = new Array<number>(divisor.length).fill(0)
  for (const b of data) {
    const factor = b ^ (result.shift() as number)
    result.push(0)
    for (let i = 0; i < divisor.length; i++) {
      result[i] ^= reedSolomonMultiply(divisor[i], factor)
    }
  }
  return result
}

// ---- Bit buffer ----

function appendBits(val: number, len: number, bits: number[]): void {
  for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1)
}

// ---- Main encoder ----

class QrMatrix {
  readonly size: number
  readonly modules: boolean[][]
  private readonly isFunction: boolean[][]

  constructor(
    readonly version: number,
    private readonly eccOrd: number,
    dataCodewords: number[],
  ) {
    this.size = version * 4 + 17
    this.modules = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false))
    this.isFunction = Array.from({ length: this.size }, () => new Array<boolean>(this.size).fill(false))

    this.drawFunctionPatterns()
    const allCodewords = this.addEccAndInterleave(dataCodewords)
    this.drawCodewords(allCodewords)

    // Pick the mask that minimises penalty.
    let minPenalty = Infinity
    let bestMask = 0
    for (let mask = 0; mask < 8; mask++) {
      this.applyMask(mask)
      this.drawFormatBits(mask)
      const penalty = this.getPenaltyScore()
      if (penalty < minPenalty) {
        bestMask = mask
        minPenalty = penalty
      }
      this.applyMask(mask) // XOR is its own inverse — undo.
    }
    this.applyMask(bestMask)
    this.drawFormatBits(bestMask)
  }

  private setFunctionModule(x: number, y: number, isDark: boolean): void {
    this.modules[y][x] = isDark
    this.isFunction[y][x] = true
  }

  private drawFunctionPatterns(): void {
    const size = this.size
    for (let i = 0; i < size; i++) {
      this.setFunctionModule(6, i, i % 2 === 0)
      this.setFunctionModule(i, 6, i % 2 === 0)
    }
    this.drawFinderPattern(3, 3)
    this.drawFinderPattern(size - 4, 3)
    this.drawFinderPattern(3, size - 4)

    const alignPositions = this.getAlignmentPatternPositions()
    const numAlign = alignPositions.length
    for (let i = 0; i < numAlign; i++) {
      for (let j = 0; j < numAlign; j++) {
        const skipCorner =
          (i === 0 && j === 0) ||
          (i === 0 && j === numAlign - 1) ||
          (i === numAlign - 1 && j === 0)
        if (!skipCorner) this.drawAlignmentPattern(alignPositions[i], alignPositions[j])
      }
    }

    this.drawFormatBits(0) // dummy; real value set after masking
    this.drawVersion()
  }

  private drawFinderPattern(x: number, y: number): void {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const dist = Math.max(Math.abs(dx), Math.abs(dy))
        const xx = x + dx
        const yy = y + dy
        if (xx >= 0 && xx < this.size && yy >= 0 && yy < this.size) {
          this.setFunctionModule(xx, yy, dist !== 2 && dist !== 4)
        }
      }
    }
  }

  private drawAlignmentPattern(x: number, y: number): void {
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        this.setFunctionModule(x + dx, y + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1)
      }
    }
  }

  private getAlignmentPatternPositions(): number[] {
    if (this.version === 1) return []
    const numAlign = Math.floor(this.version / 7) + 2
    const step = Math.floor((this.version * 8 + numAlign * 3 + 5) / (numAlign * 4 - 4)) * 2
    const result = [6]
    for (let pos = this.size - 7; result.length < numAlign; pos -= step) {
      result.splice(1, 0, pos)
    }
    return result
  }

  private drawFormatBits(mask: number): void {
    const data = (ECC_FORMAT_BITS[this.eccOrd] << 3) | mask
    let rem = data
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537)
    const bits = ((data << 10) | rem) ^ 0x5412

    for (let i = 0; i <= 5; i++) this.setFunctionModule(8, i, getBit(bits, i))
    this.setFunctionModule(8, 7, getBit(bits, 6))
    this.setFunctionModule(8, 8, getBit(bits, 7))
    this.setFunctionModule(7, 8, getBit(bits, 8))
    for (let i = 9; i < 15; i++) this.setFunctionModule(14 - i, 8, getBit(bits, i))

    const size = this.size
    for (let i = 0; i < 8; i++) this.setFunctionModule(size - 1 - i, 8, getBit(bits, i))
    for (let i = 8; i < 15; i++) this.setFunctionModule(8, size - 15 + i, getBit(bits, i))
    this.setFunctionModule(8, size - 8, true) // always-dark module
  }

  private drawVersion(): void {
    if (this.version < 7) return
    let rem = this.version
    for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25)
    const bits = (this.version << 12) | rem

    for (let i = 0; i < 18; i++) {
      const bit = getBit(bits, i)
      const a = this.size - 11 + (i % 3)
      const b = Math.floor(i / 3)
      this.setFunctionModule(a, b, bit)
      this.setFunctionModule(b, a, bit)
    }
  }

  private addEccAndInterleave(data: number[]): number[] {
    const ver = this.version
    const eccOrd = this.eccOrd
    const numBlocks = NUM_ERROR_CORRECTION_BLOCKS[eccOrd][ver]
    const blockEccLen = ECC_CODEWORDS_PER_BLOCK[eccOrd][ver]
    const rawCodewords = Math.floor(getNumRawDataModules(ver) / 8)
    const numShortBlocks = numBlocks - (rawCodewords % numBlocks)
    const shortBlockLen = Math.floor(rawCodewords / numBlocks)

    const blocks: number[][] = []
    const rsDiv = reedSolomonComputeDivisor(blockEccLen)
    let k = 0
    for (let i = 0; i < numBlocks; i++) {
      const datLen = shortBlockLen - blockEccLen + (i < numShortBlocks ? 0 : 1)
      const dat = data.slice(k, k + datLen)
      k += datLen
      const ecc = reedSolomonComputeRemainder(dat, rsDiv)
      if (i < numShortBlocks) dat.push(0)
      blocks.push(dat.concat(ecc))
    }

    const result: number[] = []
    for (let i = 0; i < blocks[0].length; i++) {
      for (let j = 0; j < blocks.length; j++) {
        // Skip the padding cell in short blocks' data region.
        if (i !== shortBlockLen - blockEccLen || j >= numShortBlocks) {
          result.push(blocks[j][i])
        }
      }
    }
    return result
  }

  private drawCodewords(data: number[]): void {
    let i = 0
    for (let right = this.size - 1; right >= 1; right -= 2) {
      if (right === 6) right = 5
      for (let vert = 0; vert < this.size; vert++) {
        for (let j = 0; j < 2; j++) {
          const x = right - j
          const upward = ((right + 1) & 2) === 0
          const y = upward ? this.size - 1 - vert : vert
          if (!this.isFunction[y][x] && i < data.length * 8) {
            this.modules[y][x] = getBit(data[i >>> 3], 7 - (i & 7))
            i++
          }
        }
      }
    }
  }

  private applyMask(mask: number): void {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        if (this.isFunction[y][x]) continue
        let invert: boolean
        switch (mask) {
          case 0: invert = (x + y) % 2 === 0; break
          case 1: invert = y % 2 === 0; break
          case 2: invert = x % 3 === 0; break
          case 3: invert = (x + y) % 3 === 0; break
          case 4: invert = (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0; break
          case 5: invert = ((x * y) % 2) + ((x * y) % 3) === 0; break
          case 6: invert = (((x * y) % 2) + ((x * y) % 3)) % 2 === 0; break
          case 7: invert = (((x + y) % 2) + ((x * y) % 3)) % 2 === 0; break
          default: invert = false
        }
        if (invert) this.modules[y][x] = !this.modules[y][x]
      }
    }
  }

  private getPenaltyScore(): number {
    const size = this.size
    const mod = this.modules
    let result = 0
    const P3 = 40

    // Rule 1 + 3: rows
    for (let y = 0; y < size; y++) {
      let runColor = false
      let runX = 0
      const runHistory = [0, 0, 0, 0, 0, 0, 0]
      for (let x = 0; x < size; x++) {
        if (mod[y][x] === runColor) {
          runX++
          if (runX === 5) result += 3
          else if (runX > 5) result++
        } else {
          this.finderPenaltyAddHistory(runX, runHistory)
          if (!runColor) result += this.finderPenaltyCountPatterns(runHistory) * P3
          runColor = mod[y][x]
          runX = 1
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runX, runHistory) * P3
    }
    // Rule 1 + 3: columns
    for (let x = 0; x < size; x++) {
      let runColor = false
      let runY = 0
      const runHistory = [0, 0, 0, 0, 0, 0, 0]
      for (let y = 0; y < size; y++) {
        if (mod[y][x] === runColor) {
          runY++
          if (runY === 5) result += 3
          else if (runY > 5) result++
        } else {
          this.finderPenaltyAddHistory(runY, runHistory)
          if (!runColor) result += this.finderPenaltyCountPatterns(runHistory) * P3
          runColor = mod[y][x]
          runY = 1
        }
      }
      result += this.finderPenaltyTerminateAndCount(runColor, runY, runHistory) * P3
    }

    // Rule 2: 2x2 blocks of same colour
    for (let y = 0; y < size - 1; y++) {
      for (let x = 0; x < size - 1; x++) {
        const c = mod[y][x]
        if (c === mod[y][x + 1] && c === mod[y + 1][x] && c === mod[y + 1][x + 1]) result += 3
      }
    }

    // Rule 4: proportion of dark modules
    let dark = 0
    for (const row of mod) for (const cell of row) if (cell) dark++
    const total = size * size
    let k = 0
    while (dark * 20 < (9 - k) * total || dark * 20 > (11 + k) * total) k++
    result += k * 10

    return result
  }

  private finderPenaltyCountPatterns(rh: number[]): number {
    const n = rh[1]
    const core = n > 0 && rh[2] === n && rh[3] === n * 3 && rh[4] === n && rh[5] === n
    return (
      (core && rh[0] >= n * 4 && rh[6] >= n ? 1 : 0) +
      (core && rh[6] >= n * 4 && rh[0] >= n ? 1 : 0)
    )
  }

  private finderPenaltyTerminateAndCount(currentColor: boolean, currentRun: number, rh: number[]): number {
    if (currentColor) {
      this.finderPenaltyAddHistory(currentRun, rh)
      currentRun = 0
    }
    currentRun += this.size
    this.finderPenaltyAddHistory(currentRun, rh)
    return this.finderPenaltyCountPatterns(rh)
  }

  private finderPenaltyAddHistory(currentRun: number, rh: number[]): void {
    if (rh[0] === 0) currentRun += this.size // add light border to first run
    rh.pop()
    rh.unshift(currentRun)
  }
}

function getBit(value: number, index: number): boolean {
  return ((value >>> index) & 1) !== 0
}

function utf8Bytes(text: string): number[] {
  return Array.from(new TextEncoder().encode(text))
}

/**
 * Encode `text` (UTF-8, byte mode) into a QR code module matrix.
 * Picks the smallest version that fits at the given ECC level (default "M").
 */
export function encodeQr(text: string, ecl: Ecc = "M"): boolean[][] {
  const eccOrd = ECC_ORDINAL[ecl]
  const bytes = utf8Bytes(text)

  // Find smallest version that fits a single byte-mode segment.
  let version = MIN_VERSION
  let dataCapacityBits = 0
  for (; ; version++) {
    if (version > MAX_VERSION) {
      throw new Error("Data too long for a QR code")
    }
    dataCapacityBits = getNumDataCodewords(version, eccOrd) * 8
    const ccBits = version < 10 ? 8 : 16
    const usedBits = 4 + ccBits + bytes.length * 8
    if (usedBits <= dataCapacityBits) break
  }

  const bits: number[] = []
  appendBits(0x4, 4, bits) // byte mode indicator
  appendBits(bytes.length, version < 10 ? 8 : 16, bits)
  for (const b of bytes) appendBits(b, 8, bits)

  // Terminator + bit/byte padding.
  appendBits(0, Math.min(4, dataCapacityBits - bits.length), bits)
  appendBits(0, (8 - (bits.length % 8)) % 8, bits)
  for (let pad = 0xec; bits.length < dataCapacityBits; pad ^= 0xec ^ 0x11) {
    appendBits(pad, 8, bits)
  }

  const dataCodewords: number[] = new Array(bits.length >>> 3).fill(0)
  bits.forEach((bit, i) => {
    if (bit) dataCodewords[i >>> 3] |= 1 << (7 - (i & 7))
  })

  return new QrMatrix(version, eccOrd, dataCodewords).modules
}
