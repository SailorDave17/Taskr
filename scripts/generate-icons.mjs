// Generates the PWA icons from scratch, with no dependencies and no source art.
//
// This script exists to satisfy AC 7 of #4: "no file, asset, or icon originates
// from the legacy tree — including the Dad/Bro/Sis/Mom icons, which are
// unclear-provenance". Generated art has provenance you can re-derive: run
// `npm run icons` and the bytes come back. That is a stronger claim than "I drew
// these myself", because it is checkable.
//
// The motif is three load bars of unequal length — spirit item 3 from the
// charter, "every member's load visible on one screen". Unequal on purpose:
// equal bars would depict the even split the product exists to replace.

import { deflateSync } from 'node:zlib'
import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const OUT_DIR = resolve(HERE, '..', 'public', 'icons')

const BG = [0x12, 0x17, 0x1c, 0xff] // --bg
const BAR = [0x1f, 0x6f, 0x5c, 0xff] // --accent
const BAR_LIGHT = [0x3f, 0xa8, 0x8c, 0xff]
const BAR_DIM = [0x17, 0x4f, 0x42, 0xff]

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function encodePng(width, height, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // colour type: RGBA
  ihdr[10] = 0 // deflate
  ihdr[11] = 0 // adaptive filtering
  ihdr[12] = 0 // no interlace

  // Each scanline is prefixed with filter byte 0 (None).
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4)
    raw[rowStart] = 0
    rgba.copy(raw, rowStart + 1, y * width * 4, (y + 1) * width * 4)
  }

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

function canvas(size, fill) {
  const buf = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i++) buf.set(fill, i * 4)
  return buf
}

function put(buf, size, x, y, colour) {
  if (x < 0 || y < 0 || x >= size || y >= size) return
  buf.set(colour, (y * size + x) * 4)
}

// A rounded rectangle, drawn by rejecting pixels outside the corner radii.
function roundedRect(buf, size, x0, y0, w, h, radius, colour) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      const dx = Math.min(x - x0, x0 + w - 1 - x)
      const dy = Math.min(y - y0, y0 + h - 1 - y)
      if (dx < radius && dy < radius) {
        const ox = radius - dx
        const oy = radius - dy
        if (ox * ox + oy * oy > radius * radius) continue
      }
      put(buf, size, x, y, colour)
    }
  }
}

// `inset` is the fraction of the canvas kept clear on every side. Maskable icons
// need their content inside the middle 80% or Android's mask can crop it.
function drawIcon(size, inset) {
  const buf = canvas(size, BG)

  const pad = Math.round(size * inset)
  const usable = size - pad * 2

  const barHeight = Math.round(usable * 0.17)
  const gap = Math.round(usable * 0.115)
  const block = barHeight * 3 + gap * 2
  const top = pad + Math.round((usable - block) / 2)
  const radius = Math.round(barHeight / 2)

  // Unequal by design: three members, three different real capacities.
  const bars = [
    { fraction: 1.0, colour: BAR_LIGHT },
    { fraction: 0.62, colour: BAR },
    { fraction: 0.34, colour: BAR_DIM },
  ]

  bars.forEach((bar, i) => {
    const w = Math.max(barHeight, Math.round(usable * bar.fraction))
    const y = top + i * (barHeight + gap)
    roundedRect(buf, size, pad, y, w, barHeight, radius, bar.colour)
  })

  return encodePng(size, size, buf)
}

mkdirSync(OUT_DIR, { recursive: true })

const targets = [
  { file: 'icon-192.png', size: 192, inset: 0.14 },
  { file: 'icon-512.png', size: 512, inset: 0.14 },
  // Maskable: content pulled well inside the safe zone.
  { file: 'icon-512-maskable.png', size: 512, inset: 0.22 },
]

for (const { file, size, inset } of targets) {
  const png = drawIcon(size, inset)
  writeFileSync(resolve(OUT_DIR, file), png)
  console.log(`wrote ${file} (${size}x${size}, ${png.length} bytes)`)
}
