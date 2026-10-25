/** Валидация спрайтов: все строки одной длины, палитра покрывает все символы. */
import { SPRITES, type SpriteKey } from '../src/lib/game/sprites'

let issues = 0
for (const [key, frames] of Object.entries(SPRITES) as [SpriteKey, typeof SPRITES[SpriteKey]][]) {
  frames.forEach((f, fi) => {
    const widths = f.rows.map((r) => r.length)
    const w = Math.max(...widths)
    const bad = f.rows.filter((r) => r.length !== w)
    const unknown = new Set<string>()
    for (const row of f.rows) for (const ch of row) if (!(ch in f.pal) && ch !== '.') unknown.add(ch)
    if (bad.length || unknown.size) {
      issues++
      console.log(`[FAIL] ${key}#${fi}: rows widths [${widths.join(',')}], unknown chars: ${[...unknown].join(' ')}`)
    } else {
      console.log(`[OK]   ${key}#${fi} ${w}x${f.rows.length}`)
    }
  })
}
console.log(issues === 0 ? 'ALL SPRITES OK' : `${issues} ISSUES`)
