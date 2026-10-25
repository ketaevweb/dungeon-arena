/**
 * Пиксель-арт спрайты «Dungeon Arena».
 * Спрайты заданы как матрицы символов + палитра (в духе ассет-паков Dungeons).
 * Рендерятся один раз в offscreen-canvas и рисуются с scale (1 пиксель = SCALE px).
 */

export interface SpriteDef {
  rows: string[]
  pal: Record<string, string>
}

export const SPRITE_SCALE = 3

// ---------- Игрок: рыцарь ----------
const playerPal = {
  o: '#22160f', // контур
  s: '#c3ccd8', // сталь
  S: '#8892a0', // сталь тёмная
  r: '#d23b4e', // плюмаж
  f: '#e8b07a', // лицо
  a: '#9aa6b4', // броня
  g: '#e0a83f', // золото
  b: '#5c4632', // сапоги
  w: '#eef2f8', // клинок
  k: '#3a2c1e', // рукоять
}

const player1: SpriteDef = {
  pal: playerPal,
  rows: [
    '.....rr.....',
    '....rrr.....',
    '...sssss....',
    '..sssssss...',
    '..sfsssfs...',
    '..sssssss...',
    '...SSSSS....',
    '..aaaaaaa.w.',
    '.aaaagaaaa.w',
    '.aaaagaaa.sw',
    '.aaSaaSas.gw',
    '..aa.aa..gg.',
    '..bb.bb...k.',
    '..bb.bb.....',
  ],
}

const player2: SpriteDef = {
  pal: playerPal,
  rows: [
    '.....rr.....',
    '....rrr.....',
    '...sssss....',
    '..sssssss...',
    '..sfsssfs...',
    '..sssssss...',
    '...SSSSS....',
    '..aaaaaaa.w.',
    '.aaaagaaaa.w',
    '.aaaagaaa.sw',
    '.aaSaaSas.gw',
    '..aa.aa..gg.',
    '...bbbb...k.',
    '...bb.bb....',
  ],
}

// ---------- Слизень ----------
const slimePal = {
  o: '#173d1e',
  g: '#5cc460',
  G: '#3a8f44',
  w: '#f4fff4',
  k: '#143018',
}

const slime1: SpriteDef = {
  pal: slimePal,
  rows: [
    '............',
    '....oooo....',
    '..ooggggoo..',
    '.oggggggggo.',
    '.ogwggggwgo.',
    '.ogkggggkgo.',
    '.oggggggggo.',
    '.oGgggggggo.',
    '.oGGGGGGGGo.',
    '..oooooooo..',
  ],
}

const slime2: SpriteDef = {
  pal: slimePal,
  rows: [
    '............',
    '............',
    '...oooooo...',
    '.ooggggggoo.',
    'ogwggggggwgo',
    'ogkggggggkgo',
    'oGggggggggGo',
    'oGGGGGGGGGGo',
    '.oooooooooo.',
    '............',
  ],
}

// ---------- Летучая мышь ----------
const batPal = {
  o: '#241539',
  p: '#8a5fbf',
  P: '#5f3d8c',
  r: '#ff5b5b',
}

const bat1: SpriteDef = {
  pal: batPal,
  rows: [
    '.o........o.',
    'oppo....oppo',
    'opppo..opppo',
    '.opprpprppo.',
    '.oPppppppPo.',
    '..oPooooPo..',
    '............',
    '............',
  ],
}

const bat2: SpriteDef = {
  pal: batPal,
  rows: [
    '............',
    '............',
    'oppo....oppo',
    'oppporrppppo',
    '.oppppppppo.',
    '..oPooooPo..',
    '............',
    '............',
  ],
}

// ---------- Скелет (пак Dungeons II) ----------
const skeletonPal = {
  o: '#38352c',
  w: '#e8e4d4',
  W: '#b3ac97',
  k: '#171820',
  r: '#c23b3b',
}

const skeleton1: SpriteDef = {
  pal: skeletonPal,
  rows: [
    '...oooooo...',
    '..owwwwwwo..',
    '.owwwwwwwwo.',
    '.owkrwwkrwo.',
    '.owwwwwwwwo.',
    '..owWkkWwo..',
    '....oWWo....',
    '.owwoWWowwo.',
    '.owowwwwowo.',
    '.owoWwwWowo.',
    '..oWwoowWo..',
    '...ow.wo....',
    '...ow.wo....',
    '...oo.oo....',
  ],
}

const skeleton2: SpriteDef = {
  pal: skeletonPal,
  rows: [
    '...oooooo...',
    '..owwwwwwo..',
    '.owwwwwwwwo.',
    '.owkrwwkrwo.',
    '.owwwwwwwwo.',
    '..owWkkWwo..',
    '....oWWo....',
    'oww.oWW.oww.',
    'owo.wwww.owo',
    'oWo.WwwW.oWo',
    '..oWw.owWo..',
    '..ow...wo...',
    '..ow...wo...',
    '..oo...oo...',
  ],
}

// ---------- Гоблин (пак Dungeons II) ----------
const goblinPal = {
  o: '#1c2a14',
  g: '#6fae4a',
  G: '#4c7a33',
  r: '#e04a3a',
  b: '#7a5230',
  w: '#e8e4d4',
}

const goblin1: SpriteDef = {
  pal: goblinPal,
  rows: [
    '..o......o..',
    '.ogo....ogo.',
    '..oggggggo..',
    '.oggggggggo.',
    '.ogrggggrgo.',
    '.oggggggggo.',
    '..oggwwggo..',
    '..oGggggGo..',
    '..ogbbbggo..',
    '..oggggggo.w',
    '..ogo..ogo.w',
    '..oo....oo..',
  ],
}

const goblin2: SpriteDef = {
  pal: goblinPal,
  rows: [
    '.o........o.',
    'ogo......ogo',
    '..oggggggo..',
    '.oggggggggo.',
    '.ogrggggrgo.',
    '.oggggggggo.',
    '..oggwwggo..',
    '..oGggggGo..',
    '..ogbbbggo..',
    '..oggggggo.w',
    '...ogoogo.w.',
    '...oo..oo...',
  ],
}

// ---------- Гоблин-шаман (пак Dungeons II) ----------
const shamanPal = {
  o: '#1c1030',
  m: '#7a3a5a',
  M: '#52253c',
  g: '#6fae4a',
  r: '#ffb02e',
  k: '#4a3520',
  p: '#c95cd9',
}

const shaman1: SpriteDef = {
  pal: shamanPal,
  rows: [
    '.....oooo.....',
    '....ommmmo..p.',
    '...ommmmmmo.kp',
    '...omggggmo.ok',
    '...omrgrgmo.ok',
    '...omggggmo.ok',
    '....oMMMmo..kp',
    '...ommmmmo..p.',
    '..ommmmmmmo...',
    '..omMomMomo...',
    '..ommmmmmmo...',
    '...oMoMoMo....',
    '...omm.mmo....',
    '....oo.oo.....',
  ],
}

const shaman2: SpriteDef = {
  pal: shamanPal,
  rows: [
    '.....oooo.....',
    '....ommmmo..p.',
    '...ommmmmmo.kp',
    '...omggggmo.ok',
    '...omrgrgmo.ok',
    '...omggggmo.ok',
    '....oMMMmo..kp',
    '...ommmmmo..p.',
    '..ommmmmmmo...',
    '..omMomMomo...',
    '..ommmmmmmo...',
    '...oMoMoMo....',
    '...omm.mmo....',
    '....oo.oo.....',
  ],
}

// ---------- Скелет-рыцарь (пак Dungeons III) ----------
const knightPal = {
  o: '#221c14',
  w: '#e8e4d4',
  A: '#8d99a6',
  a: '#5c6672',
  r: '#b8353f',
  g: '#c9a03f',
  k: '#171820',
  W: '#b3ac97',
}

const knight1: SpriteDef = {
  pal: knightPal,
  rows: [
    '....oooo......',
    '...oAAAAo...w.',
    '..oAwAwAwo..w.',
    '..oAAAAAAo..w.',
    '..oAkAAkAo.gg.',
    '...oAAAAo..g..',
    '..oAArAAAo.g..',
    '.oAAAAAAAAog..',
    '.oAAaAAaAAo...',
    '.oAAAAgAAAo...',
    '.oAaAAAAaAo...',
    '..oAA..AAo....',
    '..oAw..wAo....',
    '..oo....oo....',
  ],
}

const knight2: SpriteDef = {
  pal: knightPal,
  rows: [
    '....oooo......',
    '...oAAAAo...w.',
    '..oAwAwAwo..w.',
    '..oAAAAAAo..w.',
    '..oAkAAkAo.gg.',
    '...oAAAAo..g..',
    '..oAArAAAo.g..',
    '.oAAAAAAAAog..',
    '.oAAaAAaAAo...',
    '.oAAAAgAAAo...',
    '.oAaAAAAaAo...',
    '..oAA..AAo....',
    '...oAwwAo.....',
    '...oo..oo.....',
  ],
}

// ---------- НЕКРОМАНТ (босс, пак Dungeons III) ----------
const necroPal = {
  o: '#140d22',
  P: '#4a2a6a',
  Q: '#33204d',
  p: '#c95cd9',
  w: '#e8e4d4',
  k: '#0d0a14',
  g: '#7fd94a',
}

const necro1: SpriteDef = {
  pal: necroPal,
  rows: [
    '.....oooooo.....',
    '....oPPPPPPo....',
    '...oPPPPPPPPo...',
    '...oPPppppPPo..g',
    '...oPpkpkpPPo.gk',
    '...oPPPPPPPPo..g',
    '....oPPPPPPo..gk',
    '...oPPPPPPPPo.g.',
    '..oPPPPPPPPPPo..',
    '..oPPQPPPPQPPo..',
    '..oPPPPPPPPPPo..',
    '..oPPQPPPPQPPo..',
    '...oPPoPPoPPo...',
    '...oPo.oo.oPo...',
    '...oPo....oPo...',
    '....o......o....',
  ],
}

const necro2: SpriteDef = {
  pal: necroPal,
  rows: [
    '.....oooooo.....',
    '....oPPPPPPo....',
    '...oPPPPPPPPo...',
    '...oPPppppPPo..g',
    '...oPpkpkpPPo.gk',
    '...oPPPPPPPPo..g',
    '....oPPPPPPo..gk',
    '...oPPPPPPPPo.g.',
    '..oPPPPPPPPPPo..',
    '..oPPQPPPPQPPo..',
    '..oPPPPPPPPPPo..',
    '..oPPQPPPPQPPo..',
    '...oPPoPPoPPo...',
    '...oPo.oo.oPo...',
    '..oPo......oPo..',
    '..o..........o..',
  ],
}

// ---------- Гемы и снаряды ----------
const gemPal = { o: '#7a4a08', y: '#ffd24a', Y: '#e09a26', w: '#fff8e0' }

const gem: SpriteDef = {
  pal: gemPal,
  rows: [
    '...o...',
    '..oyo..',
    '.oyyyo.',
    'oywyyYo',
    '.oyYYo.',
    '..oYo..',
    '...o...',
  ],
}

const boltPal = { w: '#fff8e0', y: '#ffb02e', o: '#e07a26' }

const bolt: SpriteDef = {
  pal: boltPal,
  rows: [
    '.ooo.',
    'oywyo',
    'ywwwy',
    'oywyo',
    '.ooo.',
  ],
}

const fireballPal = { o: '#8a2a1a', r: '#e35b3a', y: '#ffd24a' }

const fireball: SpriteDef = {
  pal: fireballPal,
  rows: [
    '..ooo..',
    '.orryo.',
    'oryyyyo',
    'oryyyyo',
    'orryyo.',
    '..ooo..',
  ],
}

// ---------- Реестр ----------

export type SpriteKey =
  | 'player' | 'slime' | 'bat' | 'skeleton' | 'goblin'
  | 'shaman' | 'knight' | 'necromancer' | 'gem' | 'bolt' | 'fireball'

export const SPRITES: Record<SpriteKey, SpriteDef[]> = {
  player: [player1, player2],
  slime: [slime1, slime2],
  bat: [bat1, bat2],
  skeleton: [skeleton1, skeleton2],
  goblin: [goblin1, goblin2],
  shaman: [shaman1, shaman2],
  knight: [knight1, knight2],
  necromancer: [necro1, necro2],
  gem: [gem],
  bolt: [bolt],
  fireball: [fireball],
}

// ---------- Сборка canvas ----------

const cache = new Map<string, { frames: HTMLCanvasElement[]; white: HTMLCanvasElement[] }>()

export function buildSpriteCanvas(def: SpriteDef, scale: number): HTMLCanvasElement {
  const w = Math.max(...def.rows.map((r) => r.length))
  const h = def.rows.length
  const c = document.createElement('canvas')
  c.width = Math.max(1, w * scale)
  c.height = Math.max(1, h * scale)
  const ctx = c.getContext('2d')!
  ctx.imageSmoothingEnabled = false
  def.rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const col = def.pal[row[x]]
      if (!col) continue
      ctx.fillStyle = col
      ctx.fillRect(x * scale, y * scale, scale, scale)
    }
  })
  return c
}

export function buildWhiteVersion(src: HTMLCanvasElement): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = src.width
  c.height = src.height
  const ctx = c.getContext('2d')!
  ctx.drawImage(src, 0, 0)
  ctx.globalCompositeOperation = 'source-in'
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, c.width, c.height)
  return c
}

/** Получить (и закэшировать) набор кадров спрайта. Только для клиента! */
export function getSpriteSet(key: SpriteKey, scale = SPRITE_SCALE) {
  const ck = `${key}:${scale}`
  let set = cache.get(ck)
  if (!set) {
    const defs = SPRITES[key]
    const frames = defs.map((d) => buildSpriteCanvas(d, scale))
    const white = frames.map((f) => buildWhiteVersion(f))
    set = { frames, white }
    cache.set(ck, set)
  }
  return set
}
