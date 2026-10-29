// Writes assets/chime.wav: two soft sine notes (E5 then A5), about 0.4 s, 16-bit mono 22.05 kHz.
// Run: node scripts/make-chime.mjs
import { writeFileSync, mkdirSync } from 'node:fs'

const rate = 22050
const notes = [
  { f: 659.25, start: 0, len: 0.22 },
  { f: 880, start: 0.12, len: 0.28 },
]
const total = Math.round(rate * 0.4)
const samples = new Float64Array(total)
for (const n of notes) {
  for (let i = 0; i < Math.round(n.len * rate); i++) {
    const t = i / rate
    const at = Math.round(n.start * rate) + i
    if (at >= total) break
    const attack = Math.min(1, t / 0.01)
    const decay = Math.exp(-t * 9)
    samples[at] += Math.sin(2 * Math.PI * n.f * t) * attack * decay * 0.28
  }
}
const data = Buffer.alloc(total * 2)
for (let i = 0; i < total; i++) data.writeInt16LE(Math.round(Math.max(-1, Math.min(1, samples[i])) * 32767), i * 2)
const head = Buffer.alloc(44)
head.write('RIFF', 0)
head.writeUInt32LE(36 + data.length, 4)
head.write('WAVEfmt ', 8)
head.writeUInt32LE(16, 16)
head.writeUInt16LE(1, 20)
head.writeUInt16LE(1, 22)
head.writeUInt32LE(rate, 24)
head.writeUInt32LE(rate * 2, 28)
head.writeUInt16LE(2, 32)
head.writeUInt16LE(16, 34)
head.write('data', 36)
head.writeUInt32LE(data.length, 40)
mkdirSync(new URL('../assets/', import.meta.url), { recursive: true })
writeFileSync(new URL('../assets/chime.wav', import.meta.url), Buffer.concat([head, data]))
