/**
 * Dungeon Arena — авторитарный игровой сервер (socket.io, порт 3010).
 * Симуляция: волны, враги (паки Dungeons), снаряды, гемы, прокачка, кооп.
 */
import { createServer } from 'http'
import { Server, Socket } from 'socket.io'
import {
  ARENA, TICK_MS, ENEMIES, buildWave, waveScale, computeStats, xpNeeded,
  UPGRADES, UPGRADE_MAP,
  type EnemyKind, type UpgradeLevels, type PlayerStats,
  type Snapshot, type SnapFx, type SnapPlayer, type SnapEnemy, type SnapProj, type SnapGem,
} from '../../src/lib/game/config'
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient({
  datasourceUrl: process.env.DATABASE_URL || 'file:/home/z/my-project/db/custom.db',
})

const httpServer = createServer()
const io = new Server(httpServer, {
  path: '/', // НЕ менять: используется Caddy для проксирования
  cors: { origin: '*', methods: ['GET', 'POST'] },
  pingTimeout: 60000,
  pingInterval: 25000,
})

const MAX_PLAYERS = 6
const REVIVE_SECONDS = 20
const GEM_CAP = 250
const ENEMY_CAP = 95

let nextEnemyId = 1
let nextProjId = 1
let nextGemId = 1

interface Player {
  id: string
  socket: Socket
  name: string
  x: number; y: number; f: number
  hp: number
  dead: boolean
  reviveAt: number // ms timestamp, 0 = нет
  contactCdUntil: number // кулдаун контактного урона на игрока
  level: number; xp: number
  upgrades: UpgradeLevels
  stats: PlayerStats
  kills: number
  ready: boolean
  attackCd: number
  pendingChoices: number
  hasOffer: boolean
  lastSeenMove: number
}

interface Enemy {
  id: number
  kind: EnemyKind
  x: number; y: number; f: number
  hp: number; maxhp: number
  speed: number; dmg: number; xp: number
  radius: number
  atkCd: number
  summonCd: number
  wobble: number
  hitCdUntil: number
  flash: number
}

interface Proj {
  id: number
  x: number; y: number; vx: number; vy: number
  dmg: number
  fromPlayer: boolean
  ownerId: string
  pierce: number
  life: number
  crit: boolean
}

interface Gem { id: number; x: number; y: number; value: number; bornAt: number }

type WaveState = 'spawning' | 'clearing' | 'intermission'

interface Room {
  code: string
  state: 'lobby' | 'playing' | 'over'
  players: Map<string, Player> // по socket.id
  enemies: Map<number, Enemy>
  projs: Proj[]
  gems: Gem[]
  wave: number
  waveState: WaveState
  interLeft: number
  spawnQueue: { kind: EnemyKind; at: number }[]
  time: number
  hostId: string
  fx: SnapFx[]
  loop: ReturnType<typeof setInterval> | null
  emptySince: number | null
  saving: boolean
}

const rooms = new Map<string, Room>()
const socketRoom = new Map<string, string>()

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
function makeCode(): string {
  for (let tries = 0; tries < 50; tries++) {
    let c = ''
    for (let i = 0; i < 4; i++) c += CODE_CHARS[Math.floor(Math.random() * CODE_CHARS.length)]
    if (!rooms.has(c)) return c
  }
  return 'R' + Date.now().toString(36).toUpperCase().slice(-4)
}

function clampPos(x: number, y: number) {
  const m = ARENA.wall + 24
  return {
    x: Math.max(m, Math.min(ARENA.w - m, x)),
    y: Math.max(m, Math.min(ARENA.h - m, y)),
  }
}

function createPlayer(socket: Socket, name: string): Player {
  const pos = spawnPointFor(null)
  return {
    id: socket.id,
    socket,
    name: (name || 'Игрок').slice(0, 16),
    x: pos.x, y: pos.y, f: 1,
    hp: 100, dead: false, reviveAt: 0,
    contactCdUntil: 0,
    level: 1, xp: 0,
    upgrades: {},
    stats: computeStats({}),
    kills: 0,
    ready: false,
    attackCd: 0.5,
    pendingChoices: 0,
    hasOffer: false,
    lastSeenMove: Date.now(),
  }
}

function spawnPointFor(_near: Player | null): { x: number; y: number } {
  return {
    x: ARENA.w / 2 + (Math.random() - 0.5) * 120,
    y: ARENA.h / 2 + (Math.random() - 0.5) * 120,
  }
}

function edgeSpawnPoint(room: Room): { x: number; y: number } {
  const alive = Array.from(room.players.values()).filter((p) => !p.dead)
  const m = ARENA.wall + 40
  if (alive.length === 0) return { x: ARENA.w / 2, y: ARENA.h / 2 }
  const anchor = alive[Math.floor(Math.random() * alive.length)]
  // кольцо вокруг случайного живого игрока: бой приходит к игрокам
  for (let tries = 0; tries < 10; tries++) {
    const a = Math.random() * Math.PI * 2
    const dist = 470 + Math.random() * 280
    const x = anchor.x + Math.cos(a) * dist
    const y = anchor.y + Math.sin(a) * dist
    if (x > m && x < ARENA.w - m && y > m && y < ARENA.h - m) return { x, y }
  }
  return {
    x: Math.max(m, Math.min(ARENA.w - m, anchor.x)),
    y: Math.max(m, Math.min(ARENA.h - m, anchor.y - 500)),
  }
}

// ---------- Комнаты ----------

function createRoom(hostSocket: Socket, name: string): Room {
  const code = makeCode()
  const player = createPlayer(hostSocket, name)
  const room: Room = {
    code, state: 'lobby',
    players: new Map([[hostSocket.id, player]]),
    enemies: new Map(), projs: [], gems: [],
    wave: 0, waveState: 'intermission', interLeft: 0, spawnQueue: [],
    time: 0, hostId: hostSocket.id, fx: [], loop: null, emptySince: null,
    saving: false,
  }
  rooms.set(code, room)
  return room
}

function joinRoom(socket: Socket, room: Room, name: string): boolean {
  if (room.players.size >= MAX_PLAYERS) {
    socket.emit('err', { msg: 'Комната заполнена' })
    return false
  }
  if (room.state !== 'lobby') {
    socket.emit('err', { msg: 'Игра уже идёт — попросите хоста нажать «Ещё раз»' })
    return false
  }
  const player = createPlayer(socket, name)
  room.players.set(socket.id, player)
  return true
}

function leaveRoom(socket: Socket) {
  const code = socketRoom.get(socket.id)
  if (!code) return
  socketRoom.delete(socket.id)
  const room = rooms.get(code)
  if (!room) return
  const p = room.players.get(socket.id)
  room.players.delete(socket.id)
  if (room.players.size === 0) {
    destroyRoom(code)
    return
  }
  if (room.hostId === socket.id) {
    room.hostId = room.players.keys().next().value as string
    const hp = room.players.get(room.hostId)
    if (hp) hp.ready = true
  }
  if (room.state === 'playing' && p && !p.dead) {
    // вышедший игрок считается погибшим
    p.dead = true
  }
  if (room.state === 'playing' && aliveCount(room) === 0 && room.players.size > 0) {
    gameOver(room)
  }
  if (room.state === 'lobby') broadcastLobby(room)
}

function destroyRoom(code: string) {
  const room = rooms.get(code)
  if (!room) return
  if (room.loop) clearInterval(room.loop)
  room.loop = null
  rooms.delete(code)
  console.log(`[room] ${code} destroyed`)
}

function aliveCount(room: Room): number {
  let n = 0
  for (const p of room.players.values()) if (!p.dead) n++
  return n
}

function lobbyPayload(room: Room) {
  return {
    code: room.code,
    hostId: room.hostId,
    state: room.state,
    players: Array.from(room.players.values()).map((p) => ({
      id: p.id, n: p.name, ready: p.ready, host: p.id === room.hostId,
    })),
  }
}

function broadcastLobby(room: Room) {
  io.to(room.code).emit('lobby', lobbyPayload(room))
}

function announce(room: Room, text: string, kind: string) {
  io.to(room.code).emit('announce', { text, kind })
}

// ---------- Старт игры / волны ----------

function startGame(room: Room) {
  if (room.state !== 'lobby') return
  room.state = 'playing'
  room.time = 0
  room.wave = 1
  for (const p of room.players.values()) {
    p.hp = p.stats.maxhp
    p.dead = false
    p.reviveAt = 0
    p.level = 1
    p.xp = 0
    p.upgrades = {}
    p.stats = computeStats({})
    p.kills = 0
    p.pendingChoices = 0
    p.hasOffer = false
    p.attackCd = 0.6
    const pos = spawnPointFor(null)
    p.x = pos.x; p.y = pos.y
    p.socket.emit('forcePos', { x: p.x, y: p.y })
  }
  beginWave(room, 1)
  announce(room, 'Волна 1', 'wave')
  io.to(room.code).emit('gameStarted', { wave: 1 })
  if (room.loop) clearInterval(room.loop)
  room.loop = setInterval(() => tickRoom(room), TICK_MS)
}

function beginWave(room: Room, wave: number) {
  room.wave = wave
  room.waveState = 'spawning'
  const list = buildWave(wave)
  const interval = Math.max(0.3, 1.1 - wave * 0.04)
  room.spawnQueue = list.map((kind, i) => ({ kind, at: room.time + i * interval }))
  const hasBoss = list.some((k) => ENEMIES[k].boss)
  announce(room, hasBoss ? 'НЕКРОМАНТ ПРОБУЖДАЕТСЯ!' : `Волна ${wave}`, hasBoss ? 'boss' : 'wave')
}

function spawnEnemy(room: Room, kind: EnemyKind, x?: number, y?: number) {
  if (room.enemies.size >= ENEMY_CAP) return
  const def = ENEMIES[kind]
  const sc = waveScale(room.wave)
  const pos = x !== undefined && y !== undefined ? { x, y } : edgeSpawnPoint(room)
  const e: Enemy = {
    id: nextEnemyId++,
    kind,
    x: pos.x, y: pos.y, f: 1,
    hp: Math.round(def.hp * sc.hp), maxhp: Math.round(def.hp * sc.hp),
    speed: def.speed * sc.speed,
    dmg: Math.round(def.dmg * sc.dmg),
    xp: Math.round(def.xp * sc.xp),
    radius: def.radius,
    atkCd: (def.cd ?? 1) * (0.5 + Math.random() * 0.5),
    summonCd: 4,
    wobble: Math.random() * Math.PI * 2,
    hitCdUntil: 0,
    flash: 0,
  }
  room.enemies.set(e.id, e)
}

// ---------- Урон и смерть ----------

function damagePlayer(room: Room, p: Player, dmg: number) {
  if (p.dead) return
  const real = Math.max(1, Math.round(dmg * (1 - p.stats.armor)))
  p.hp -= real
  room.fx.push({ k: 'hurt', x: p.x, y: p.y - 10, d: real })
  if (p.hp <= 0) {
    p.hp = 0
    p.dead = true
    p.hasOffer = false
    const anyAlive = aliveCount(room) >= 1
    p.reviveAt = anyAlive ? Date.now() + REVIVE_SECONDS * 1000 : 0
    announce(room, `${p.name} пал`, 'death')
    if (!anyAlive) gameOver(room)
  }
}

function killEnemy(room: Room, e: Enemy, killerId: string | null) {
  room.enemies.delete(e.id)
  room.fx.push({ k: 'death', x: e.x, y: e.y, t: e.kind })
  // дроп гема
  if (room.gems.length >= GEM_CAP) {
    const g = room.gems[Math.floor(Math.random() * room.gems.length)]
    if (g) g.value += e.xp
  } else {
    room.gems.push({ id: nextGemId++, x: e.x, y: e.y, value: e.xp, bornAt: Date.now() })
  }
  if (killerId) {
    const kp = room.players.get(killerId)
    if (kp) kp.kills++
  }
  if (e.kind === 'necromancer') {
    announce(room, 'Некромант повержен!', 'info')
  }
}

function gameOver(room: Room) {
  if (room.state === 'over') return
  room.state = 'over'
  const results = Array.from(room.players.values())
    .map((p) => ({ name: p.name, wave: room.wave, kills: p.kills, level: p.level }))
    .sort((a, b) => b.kills - a.kills)
  io.to(room.code).emit('over', { results, time: Math.round(room.time), wave: room.wave })
  // сохранение в базу (лидерборд)
  if (!room.saving && results.length > 0) {
    room.saving = true
    const rows = results.map((r) => ({
      playerName: r.name, wave: room.wave, kills: r.kills,
      level: r.level, seconds: Math.round(room.time), players: results.length,
    }))
    prisma.gameResult.createMany({ data: rows })
      .then(() => console.log(`[db] saved ${rows.length} results (room ${room.code})`))
      .catch((err) => console.error('[db] save failed:', err))
  }
  if (room.loop) clearInterval(room.loop)
  room.loop = null
}

// ---------- Прокачка ----------

function offerUpgrade(socket: Socket, p: Player) {
  // доступны все усиления, у которых не исчерпан лимит стеков
  const avail = UPGRADES.filter((u) => (p.upgrades[u.id] ?? 0) < u.max).map((u) => u.id)
  const healAvail = p.hp < p.stats.maxhp * 0.6
  const choices: { id: string; name: string; desc: string; icon: string; color: string; cur: number; max: number }[] = []
  const pool = [...avail]
  while (choices.length < 3 && pool.length > 0) {
    const idx = Math.floor(Math.random() * pool.length)
    const id = pool.splice(idx, 1)[0]
    const def = UPGRADES.find((u) => u.id === id)!
    choices.push({ id, name: def.name, desc: def.desc, icon: def.icon, color: def.color, cur: p.upgrades[id] ?? 0, max: def.max })
  }
  if (choices.length < 3 || (healAvail && Math.random() < 0.25)) {
    choices.splice(Math.floor(Math.random() * (choices.length + 1)), 0, {
      id: 'heal', name: 'Зелье лечения', desc: 'Мгновенно восстановить 50% HP', icon: 'HL', color: '#6fdc7f', cur: 0, max: 1,
    })
  }
  p.hasOffer = true
  socket.emit('levelup', { lvl: p.level, choices: choices.slice(0, 3) })
}

function applyUpgrade(socket: Socket, room: Room, p: Player, id: string) {
  if (id === 'heal') {
    p.hp = Math.min(p.stats.maxhp, p.hp + p.stats.maxhp * 0.5)
  } else {
    const def = UPGRADES.find((u) => u.id === id)
    if (def && (p.upgrades[id] ?? 0) < def.max) {
      const before = p.stats.maxhp
      p.upgrades[id] = (p.upgrades[id] ?? 0) + 1
      p.stats = computeStats(p.upgrades)
      if (p.stats.maxhp > before) p.hp += p.stats.maxhp - before
    }
  }
  p.pendingChoices = Math.max(0, p.pendingChoices - 1)
  p.hasOffer = false
  if (p.pendingChoices > 0) offerUpgrade(socket, p)
}

function gainXp(room: Room, p: Player, amount: number) {
  p.xp += amount
  let leveled = false
  while (p.xp >= xpNeeded(p.level)) {
    p.xp -= xpNeeded(p.level)
    p.level++
    p.pendingChoices++
    leveled = true
  }
  if (leveled && !p.hasOffer && !p.dead) offerUpgrade(p.socket, p)
}

// ---------- Основной тик комнаты ----------

function tickRoom(room: Room) {
  const dt = TICK_MS / 1000
  const now = Date.now()
  room.fx = []

  if (room.state !== 'playing') {
    sendSnapshot(room)
    return
  }
  room.time += dt
  const players = Array.from(room.players.values())
  const alive = players.filter((p) => !p.dead)

  // --- игроки: регенерация, возрождение ---
  for (const p of players) {
    if (p.dead) {
      if (p.reviveAt && now >= p.reviveAt && alive.length > 0) {
        const anchor = alive[Math.floor(Math.random() * alive.length)]
        p.dead = false
        p.hp = p.stats.maxhp * 0.5
        p.x = anchor.x + (Math.random() - 0.5) * 60
        p.y = anchor.y + (Math.random() - 0.5) * 60
        const cp = clampPos(p.x, p.y)
        p.x = cp.x; p.y = cp.y
        p.reviveAt = 0
        p.attackCd = 0.5
        p.socket.emit('forcePos', { x: p.x, y: p.y })
        announce(room, `${p.name} возрождается!`, 'info')
      }
      continue
    }
    if (p.stats.regen > 0) p.hp = Math.min(p.stats.maxhp, p.hp + p.stats.regen * dt)
  }

  const aliveNow = players.filter((p) => !p.dead)

  // --- автоатака игроков ---
  for (const p of aliveNow) {
    p.attackCd -= dt
    if (p.attackCd > 0) continue
    let best: Enemy | null = null
    let bestD = p.stats.attackRange
    for (const e of room.enemies.values()) {
      const d = Math.hypot(e.x - p.x, e.y - p.y)
      if (d < bestD) { bestD = d; best = e }
    }
    if (!best) { p.attackCd = 0.08; continue }
    p.attackCd = p.stats.attackInterval
    const baseA = Math.atan2(best.y - p.y, best.x - p.x)
    p.f = Math.cos(baseA) >= 0 ? 1 : -1
    const n = p.stats.projCount
    for (let i = 0; i < n; i++) {
      const spread = (i - (n - 1) / 2) * 0.14
      const a = baseA + spread
      const crit = Math.random() < p.stats.critChance
      room.projs.push({
        id: nextProjId++,
        x: p.x + Math.cos(a) * 18, y: p.y + Math.sin(a) * 18,
        vx: Math.cos(a) * p.stats.projSpeed, vy: Math.sin(a) * p.stats.projSpeed,
        dmg: p.stats.damage * (crit ? 2 : 1),
        fromPlayer: true, ownerId: p.id,
        pierce: p.stats.pierce, life: 1.6, crit,
      })
    }
  }

  // --- снаряды ---
  for (let i = room.projs.length - 1; i >= 0; i--) {
    const pr = room.projs[i]
    pr.x += pr.vx * dt
    pr.y += pr.vy * dt
    pr.life -= dt
    let dead = pr.life <= 0
    const m = ARENA.wall
    if (pr.x < m || pr.x > ARENA.w - m || pr.y < m || pr.y > ARENA.h - m) dead = true
    if (!dead && pr.fromPlayer) {
      for (const e of room.enemies.values()) {
        if (Math.hypot(e.x - pr.x, e.y - pr.y) < e.radius + 6) {
          e.hp -= pr.dmg
          e.flash = 0.12
          room.fx.push({ k: pr.crit ? 'crit' : 'hit', x: e.x, y: e.y - e.radius, d: Math.round(pr.dmg) })
          const owner = room.players.get(pr.ownerId)
          if (owner && owner.stats.lifesteal > 0 && !owner.dead) {
            owner.hp = Math.min(owner.stats.maxhp, owner.hp + pr.dmg * owner.stats.lifesteal)
          }
          if (e.hp <= 0) killEnemy(room, e, pr.ownerId)
          if (pr.pierce > 0) { pr.pierce-- } else { dead = true }
          break
        }
      }
    } else if (!dead) {
      for (const p of aliveNow) {
        if (Math.hypot(p.x - pr.x, p.y - pr.y) < 18) {
          damagePlayer(room, p, pr.dmg)
          dead = true
          break
        }
      }
    }
    if (dead) room.projs.splice(i, 1)
  }

  // --- враги: ИИ, движение, атаки ---
  for (const e of room.enemies.values()) {
    if (e.flash > 0) e.flash -= dt
    let target: Player | null = null
    let bestD = Infinity
    for (const p of aliveNow) {
      const d = Math.hypot(p.x - e.x, p.y - e.y)
      if (d < bestD) { bestD = d; target = p }
    }
    if (!target) continue
    const def = ENEMIES[e.kind]
    const dx = target.x - e.x, dy = target.y - e.y
    const dist = Math.hypot(dx, dy) || 1
    const ux = dx / dist, uy = dy / dist
    e.f = ux >= 0 ? 1 : -1
    let mvx = 0, mvy = 0

    if (def.attack === 'ranged') {
      const range = def.range ?? 300
      if (dist > range) { mvx = ux; mvy = uy }
      else if (dist < range * 0.55) { mvx = -ux; mvy = -uy }
      e.atkCd -= dt
      if (e.atkCd <= 0 && dist < range + 40) {
        e.atkCd = def.cd ?? 2.4
        const a = Math.atan2(dy, dx)
        room.projs.push({
          id: nextProjId++, x: e.x, y: e.y,
          vx: Math.cos(a) * (def.projSpeed ?? 190), vy: Math.sin(a) * (def.projSpeed ?? 190),
          dmg: e.dmg, fromPlayer: false, ownerId: 'enemy', pierce: 0, life: 3, crit: false,
        })
      }
    } else if (def.attack === 'boss') {
      // некромант: держит дистанцию, призывает скелетов, стреляет веером
      const range = def.range ?? 400
      if (dist > range * 0.8) { mvx = ux * 0.7; mvy = uy * 0.7 }
      else if (dist < range * 0.45) { mvx = -ux; mvy = -uy }
      e.summonCd -= dt
      if (e.summonCd <= 0) {
        e.summonCd = 6.5
        const cnt = 2 + (room.wave >= 10 ? 1 : 0)
        for (let i = 0; i < cnt; i++) {
          const a = Math.random() * Math.PI * 2
          spawnEnemy(room, 'skeleton', e.x + Math.cos(a) * 70, e.y + Math.sin(a) * 70)
        }
        room.fx.push({ k: 'hit', x: e.x, y: e.y - 20 })
      }
      e.atkCd -= dt
      if (e.atkCd <= 0) {
        e.atkCd = def.cd ?? 3.2
        const baseA = Math.atan2(dy, dx)
        for (let i = -1; i <= 1; i++) {
          const a = baseA + i * 0.22
          room.projs.push({
            id: nextProjId++, x: e.x, y: e.y,
            vx: Math.cos(a) * (def.projSpeed ?? 210), vy: Math.sin(a) * (def.projSpeed ?? 210),
            dmg: e.dmg, fromPlayer: false, ownerId: 'enemy', pierce: 0, life: 3, crit: false,
          })
        }
      }
    } else {
      mvx = ux; mvy = uy
      if (e.kind === 'bat') {
        e.wobble += dt * 6
        mvx += Math.cos(e.wobble) * 0.6
        mvy += Math.sin(e.wobble * 1.3) * 0.6
      }
    }

    // сепарация (расталкивание врагов)
    let sx = 0, sy = 0
    for (const o of room.enemies.values()) {
      if (o === e) continue
      const ddx = e.x - o.x, ddy = e.y - o.y
      const dd = Math.hypot(ddx, ddy)
      const minD = e.radius + o.radius
      if (dd > 0.001 && dd < minD) {
        sx += (ddx / dd) * (minD - dd) * 2.4
        sy += (ddy / dd) * (minD - dd) * 2.4
      }
    }

    const len = Math.hypot(mvx, mvy)
    if (len > 0.001) {
      e.x += (mvx / len) * e.speed * dt
      e.y += (mvy / len) * e.speed * dt
    }
    e.x += sx * dt
    e.y += sy * dt
    const cp = clampPos(e.x, e.y)
    e.x = cp.x; e.y = cp.y

    // контактный урон: не чаще одного попадания по игроку в 0.55с, сколько бы врагов ни касалось
    if (def.attack !== 'ranged' && def.attack !== 'boss' && now >= e.hitCdUntil) {
      for (const p of aliveNow) {
        if (now < p.contactCdUntil) continue
        if (Math.hypot(p.x - e.x, p.y - e.y) < e.radius + 16) {
          damagePlayer(room, p, e.dmg)
          e.hitCdUntil = now + 800
          p.contactCdUntil = now + 550
          break
        }
      }
    }
  }

  // --- гемы: старые гемы сами летят к ближайшему игроку ---
  const now2 = Date.now()
  for (let i = room.gems.length - 1; i >= 0; i--) {
    const g = room.gems[i]
    const aged = now2 - g.bornAt > 8000
    let taken = false
    for (const p of aliveNow) {
      const d = Math.hypot(p.x - g.x, p.y - g.y)
      if (d < p.stats.magnet || (aged && d < 2000)) {
        const pull = (aged ? 330 : 300 + 900 * (1 - d / Math.max(1, p.stats.magnet))) * dt
        const nx = p.x - g.x, ny = p.y - g.y
        const nl = Math.hypot(nx, ny) || 1
        g.x += (nx / nl) * pull
        g.y += (ny / nl) * pull
        if (d < 20) {
          room.gems.splice(i, 1)
          room.fx.push({ k: 'pick', x: g.x, y: g.y })
          gainXp(room, p, Math.round(g.value * p.stats.xpMult))
          taken = true
        }
        break
      }
    }
    if (taken) continue
  }

  // --- менеджер волн ---
  if (room.waveState === 'spawning') {
    while (room.spawnQueue.length && room.spawnQueue[0].at <= room.time) {
      const item = room.spawnQueue.shift()!
      spawnEnemy(room, item.kind)
    }
    if (room.spawnQueue.length === 0) room.waveState = 'clearing'
  } else if (room.waveState === 'clearing') {
    if (room.enemies.size === 0) {
      room.waveState = 'intermission'
      room.interLeft = 4
      announce(room, `Волна ${room.wave} зачищена!`, 'info')
    }
  } else if (room.waveState === 'intermission') {
    room.interLeft -= dt
    if (room.interLeft <= 0) {
      beginWave(room, room.wave + 1)
    }
  }

  // --- проверка конца игры ---
  if (aliveNow.length === 0 && room.state === 'playing') gameOver(room)

  sendSnapshot(room)
}

// ---------- Снапшот ----------

function sendSnapshot(room: Room) {
  const players: SnapPlayer[] = Array.from(room.players.values()).map((p) => ({
    id: p.id, n: p.name,
    x: Math.round(p.x), y: Math.round(p.y), f: p.f,
    hp: Math.round(p.hp), mhp: Math.round(p.stats.maxhp),
    lvl: p.level, xpv: Math.round(p.xp), xpn: xpNeeded(p.level),
    dead: p.dead,
    ready: p.ready, host: p.id === room.hostId,
    rev: p.dead && p.reviveAt ? Math.max(0, Math.ceil((p.reviveAt - Date.now()) / 1000)) : 0,
  }))
  const enemies: SnapEnemy[] = []
  for (const e of room.enemies.values()) {
    enemies.push({
      id: e.id, t: e.kind,
      x: Math.round(e.x), y: Math.round(e.y), f: e.f,
      hp: Math.max(0, Math.round(e.hp)), mhp: e.maxhp,
    })
  }
  const projs: SnapProj[] = room.projs.map((p) => ({
    id: p.id, x: Math.round(p.x), y: Math.round(p.y),
    a: Math.round(Math.atan2(p.vy, p.vx) * 100) / 100, own: p.fromPlayer,
  }))
  const gems: SnapGem[] = room.gems.map((g) => ({
    id: g.id, x: Math.round(g.x), y: Math.round(g.y), v: g.value,
  }))
  const snap: Snapshot = {
    time: Math.round(room.time * 10) / 10,
    wave: room.wave,
    waveState: room.waveState,
    interLeft: Math.max(0, Math.round(room.interLeft * 10) / 10),
    left: room.enemies.size + room.spawnQueue.length,
    players, enemies, projs, gems,
    fx: room.fx.slice(0, 40),
  }
  io.to(room.code).emit('snap', snap)
}

// ---------- Socket API ----------

io.on('connection', (socket) => {
  console.log(`[conn] ${socket.id}`)

  socket.on('solo', ({ name }: { name: string }) => {
    leaveRoom(socket)
    const room = createRoom(socket, name)
    socketRoom.set(socket.id, room.code)
    socket.join(room.code)
    socket.emit('joined', { code: room.code, id: socket.id, ...lobbyPayload(room) })
    startGame(room)
  })

  socket.on('create', ({ name }: { name: string }) => {
    leaveRoom(socket)
    const room = createRoom(socket, name)
    socketRoom.set(socket.id, room.code)
    socket.join(room.code)
    socket.emit('joined', { code: room.code, id: socket.id, ...lobbyPayload(room) })
    broadcastLobby(room)
  })

  socket.on('join', ({ name, code }: { name: string; code: string }) => {
    leaveRoom(socket)
    const room = rooms.get((code || '').toUpperCase().trim())
    if (!room) { socket.emit('err', { msg: 'Комната не найдена' }); return }
    if (!joinRoom(socket, room, name)) return
    socketRoom.set(socket.id, room.code)
    socket.join(room.code)
    socket.emit('joined', { code: room.code, id: socket.id, ...lobbyPayload(room) })
    broadcastLobby(room)
  })

  socket.on('ready', () => {
    const code = socketRoom.get(socket.id)
    if (!code) return
    const room = rooms.get(code)
    const p = room?.players.get(socket.id)
    if (room && p && room.state === 'lobby') {
      p.ready = !p.ready
      broadcastLobby(room)
    }
  })

  socket.on('start', () => {
    const code = socketRoom.get(socket.id)
    if (!code) return
    const room = rooms.get(code)
    if (room && room.state === 'lobby' && room.hostId === socket.id) {
      startGame(room)
    }
  })

  socket.on('move', ({ x, y, dx }: { x: number; y: number; dx: number }) => {
    const code = socketRoom.get(socket.id)
    if (!code) return
    const room = rooms.get(code)
    const p = room?.players.get(socket.id)
    if (!room || !p || room.state !== 'playing') return
    const cp = clampPos(Number(x) || p.x, Number(y) || p.y)
    p.x = cp.x; p.y = cp.y
    if (dx === 1 || dx === -1) p.f = dx
    p.lastSeenMove = Date.now()
  })

  socket.on('pick', ({ id }: { id: string }) => {
    const code = socketRoom.get(socket.id)
    if (!code) return
    const room = rooms.get(code)
    const p = room?.players.get(socket.id)
    if (room && p && p.hasOffer) applyUpgrade(socket, room, p, String(id))
  })

  socket.on('again', () => {
    const code = socketRoom.get(socket.id)
    if (!code) return
    const room = rooms.get(code)
    if (!room || room.state !== 'over' || room.hostId !== socket.id) return
    room.state = 'lobby'
    room.enemies.clear()
    room.projs = []
    room.gems = []
    room.wave = 0
    room.spawnQueue = []
    room.time = 0
    if (room.loop) { clearInterval(room.loop); room.loop = null }
    for (const p of room.players.values()) {
      p.ready = p.id === room.hostId
      p.dead = false
      p.reviveAt = 0
    }
    broadcastLobby(room)
  })

  socket.on('leave', () => {
    const code = socketRoom.get(socket.id)
    if (!code) return
    const room = rooms.get(code)
    socket.leave(code)
    leaveRoom(socket)
    if (room && room.state === 'playing') broadcastLobby(room)
  })

  socket.on('disconnect', () => {
    console.log(`[disc] ${socket.id}`)
    leaveRoom(socket)
  })
})

// очистка пустых комнат
setInterval(() => {
  const now = Date.now()
  for (const [code, room] of rooms) {
    if (room.players.size === 0) {
      if (room.emptySince === null) room.emptySince = now
      else if (now - room.emptySince > 60000) destroyRoom(code)
    } else {
      room.emptySince = null
    }
  }
}, 30000)

httpServer.listen(3010, () => {
  console.log('Dungeon Arena game server running on port 3010')
})

process.on('SIGTERM', () => { httpServer.close(() => process.exit(0)) })
process.on('SIGINT', () => { httpServer.close(() => process.exit(0)) })
