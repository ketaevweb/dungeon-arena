/**
 * Dungeon Arena — общий конфиг (клиент + сервер).
 * Чистые данные и функции, без импортов.
 */

export const ARENA = {
  w: 2400,
  h: 1800,
  wall: 56, // толщина стен
}

export const TICK_MS = 50 // 20 Hz симуляция на сервере

// ---------- Игрок ----------

export const PLAYER_BASE = {
  hp: 100,
  speed: 220,
  radius: 15,
  damage: 12,
  attackInterval: 0.55, // сек между выстрелами
  attackRange: 270,
  projSpeed: 460,
  regen: 0,
  critChance: 0.03,
  lifesteal: 0,
  magnet: 125, // радиус притяжения гемов
  armor: 0, // снижение урона (0..0.6)
  xpMult: 1,
  projCount: 1,
  pierce: 0,
  dashCooldown: 2.5,
  dashTime: 0.16,
  dashMult: 3.2,
}

// ---------- Враги (паки Dungeons) ----------

export type EnemyKind =
  | 'slime'
  | 'bat'
  | 'skeleton'
  | 'goblin'
  | 'shaman'
  | 'knight'
  | 'necromancer'

export interface EnemyDef {
  name: string
  pack: string
  hp: number
  speed: number
  dmg: number
  xp: number
  radius: number
  attack: 'melee' | 'ranged' | 'boss'
  range?: number // дальность атаки шамана
  projSpeed?: number
  cd?: number // кулдаун атаки
  fromWave: number
  weight: number // вес в спавне
  boss?: boolean
}

export const ENEMIES: Record<EnemyKind, EnemyDef> = {
  slime: {
    name: 'Слизень', pack: 'Dungeons I',
    hp: 22, speed: 55, dmg: 8, xp: 3, radius: 14,
    attack: 'melee', fromWave: 1, weight: 10,
  },
  bat: {
    name: 'Летучая мышь', pack: 'Dungeons I',
    hp: 16, speed: 135, dmg: 6, xp: 4, radius: 11,
    attack: 'melee', fromWave: 2, weight: 7,
  },
  skeleton: {
    name: 'Скелет', pack: 'Dungeons II',
    hp: 38, speed: 78, dmg: 12, xp: 6, radius: 14,
    attack: 'melee', fromWave: 2, weight: 9,
  },
  goblin: {
    name: 'Гоблин', pack: 'Dungeons II',
    hp: 26, speed: 115, dmg: 10, xp: 6, radius: 13,
    attack: 'melee', fromWave: 3, weight: 9,
  },
  shaman: {
    name: 'Гоблин-шаман', pack: 'Dungeons II',
    hp: 50, speed: 62, dmg: 14, xp: 13, radius: 14,
    attack: 'ranged', range: 330, projSpeed: 190, cd: 2.4,
    fromWave: 5, weight: 4,
  },
  knight: {
    name: 'Скелет-рыцарь', pack: 'Dungeons III',
    hp: 140, speed: 52, dmg: 22, xp: 20, radius: 17,
    attack: 'melee', fromWave: 7, weight: 3,
  },
  necromancer: {
    name: 'НЕКРОМАНТ', pack: 'Dungeons III — босс',
    hp: 700, speed: 46, dmg: 18, xp: 120, radius: 22,
    attack: 'boss', cd: 3.2, range: 420, projSpeed: 210,
    fromWave: 5, weight: 0, boss: true,
  },
}

/** Состав волны: список типов для спавна. */
export function buildWave(wave: number): EnemyKind[] {
  const list: EnemyKind[] = []
  if (wave % 5 === 0) {
    // Боссовая волна: некромант + свита
    list.push('necromancer')
    const adds = 4 + wave
    for (let i = 0; i < adds; i++) {
      list.push(i % 3 === 0 ? 'skeleton' : i % 3 === 1 ? 'goblin' : 'bat')
    }
    if (wave >= 10) {
      for (let i = 0; i < Math.floor(wave / 5); i++) list.push('necromancer')
    }
    return list
  }
  let budget = Math.round(4 + wave * 2.2)
  const pool = (Object.keys(ENEMIES) as EnemyKind[]).filter(
    (k) => !ENEMIES[k].boss && ENEMIES[k].fromWave <= wave
  )
  // гарантируем присутствие новых типов паков Dungeons
  if (wave >= 2) list.push('skeleton')
  if (wave >= 3) list.push('goblin')
  if (wave >= 7) list.push('knight')
  if (wave >= 5) list.push('shaman')
  for (const _t of list) budget -= 2
  let guard = 0
  while (budget > 0 && guard++ < 500) {
    const t = pool[Math.floor(Math.random() * pool.length)]
    list.push(t)
    budget -= Math.max(1, Math.round(ENEMIES[t].weight / 3))
  }
  return list
}

/** Масштабирование врагов по волне. */
export function waveScale(wave: number) {
  return {
    hp: 1 + 0.16 * (wave - 1),
    dmg: 1 + 0.04 * (wave - 1),
    xp: 1 + 0.06 * (wave - 1),
    speed: Math.min(1.5, 1 + 0.012 * (wave - 1)),
  }
}

// ---------- Прокачка ----------

export interface UpgradeDef {
  id: string
  name: string
  desc: string
  max: number
  icon: string // 1-3 символа для иконки
  color: string
}

export const UPGRADES: UpgradeDef[] = [
  { id: 'damage', name: 'Мастерство меча', desc: '+25% к урону', max: 8, icon: 'AT', color: '#e35b5b' },
  { id: 'attackspeed', name: 'Боевой темп', desc: '+15% к скорости атаки', max: 8, icon: 'SP', color: '#e3a15b' },
  { id: 'multishot', name: 'Залп', desc: '+1 снаряд за выстрел', max: 3, icon: 'x3', color: '#d9c95c' },
  { id: 'pierce', name: 'Пробивание', desc: 'Снаряды пробивают +1 врага', max: 3, icon: '→+', color: '#9fd95c' },
  { id: 'speed', name: 'Прыть', desc: '+12% к скорости бега', max: 5, icon: 'BT', color: '#5cd97c' },
  { id: 'maxhp', name: 'Стойкость', desc: '+25 к макс. HP и лечение', max: 8, icon: 'HP', color: '#5cd9b0' },
  { id: 'regen', name: 'Регенерация', desc: '+0.8 HP/сек', max: 5, icon: 'RG', color: '#5cc4d9' },
  { id: 'crit', name: 'Точный удар', desc: '+8% шанс крита (x2 урона)', max: 5, icon: 'CR', color: '#5c8ed9' },
  { id: 'lifesteal', name: 'Вампиризм', desc: '4% урона возвращается в HP', max: 4, icon: 'VP', color: '#8e5cd9' },
  { id: 'magnet', name: 'Магнетизм', desc: '+40% к радиусу сбора опыта', max: 4, icon: 'MG', color: '#c45cd9' },
  { id: 'armor', name: 'Броня', desc: '-10% получаемого урона', max: 4, icon: 'AR', color: '#9aa4b0' },
  { id: 'xpboost', name: 'Жажда знаний', desc: '+15% получаемого опыта', max: 4, icon: 'XP', color: '#d95c9f' },
]

export const UPGRADE_MAP: Record<string, UpgradeDef> = Object.fromEntries(
  UPGRADES.map((u) => [u.id, u])
)

export type UpgradeLevels = Record<string, number>

export interface PlayerStats {
  maxhp: number
  speed: number
  damage: number
  attackInterval: number
  attackRange: number
  projSpeed: number
  projCount: number
  pierce: number
  regen: number
  critChance: number
  lifesteal: number
  magnet: number
  armor: number
  xpMult: number
  dashCooldown: number
}

export function computeStats(up: UpgradeLevels): PlayerStats {
  const L = (id: string) => up[id] ?? 0
  const b = PLAYER_BASE
  return {
    maxhp: b.hp + 25 * L('maxhp'),
    speed: b.speed * (1 + 0.12 * L('speed')),
    damage: b.damage * (1 + 0.25 * L('damage')),
    attackInterval: b.attackInterval / (1 + 0.15 * L('attackspeed')),
    attackRange: b.attackRange,
    projSpeed: b.projSpeed,
    projCount: 1 + L('multishot'),
    pierce: L('pierce'),
    regen: 0.8 * L('regen'),
    critChance: b.critChance + 0.08 * L('crit'),
    lifesteal: 0.04 * L('lifesteal'),
    magnet: b.magnet * (1 + 0.4 * L('magnet')),
    armor: Math.min(0.55, 0.1 * L('armor')),
    xpMult: 1 + 0.15 * L('xpboost'),
    dashCooldown: b.dashCooldown,
  }
}

/** Опыт, необходимый для перехода на следующий уровень. */
export function xpNeeded(level: number): number {
  return Math.round(20 + (level - 1) * 14 + Math.pow(level - 1, 1.35) * 4)
}

// ---------- Формат снапшота (S→C) ----------

export interface SnapPlayer {
  id: string
  n: string // name
  x: number
  y: number
  f: number // facing: 1 right, -1 left
  hp: number
  mhp: number
  lvl: number
  xpv: number // текущий опыт
  xpn: number // опыта до следующего уровня
  dead: boolean
  ready?: boolean
  host?: boolean
  rev?: number // секунд до возрождения
}

export interface SnapEnemy {
  id: number
  t: EnemyKind
  x: number
  y: number
  hp: number
  mhp: number
  f: number
}

export interface SnapProj {
  id: number
  x: number
  y: number
  a: number // угол
  own: boolean // свой (игрок) или вражеский
}

export interface SnapGem {
  id: number
  x: number
  y: number
  v: number
}

export interface SnapFx {
  k: 'hit' | 'crit' | 'death' | 'pick' | 'hurt'
  x: number
  y: number
  d?: number // цифра урона
  t?: EnemyKind
}

export interface Snapshot {
  time: number // секунд с начала игры
  wave: number
  waveState: 'spawning' | 'clearing' | 'intermission'
  interLeft: number
  left: number // врагов осталось (живых + очередь)
  players: SnapPlayer[]
  enemies: SnapEnemy[]
  projs: SnapProj[]
  gems: SnapGem[]
  fx: SnapFx[]
}
