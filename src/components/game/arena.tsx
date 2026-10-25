'use client'

/**
 * Canvas-движок Dungeon Arena.
 * Локальное предсказание своего героя, интерполяция снапшотов сервера,
 * ввод (WASD + тач-джойстик), рывок, HUD, эффекты.
 */

import { useEffect, useRef } from 'react'
import {
  ARENA, ENEMIES, computeStats, xpNeeded,
  type EnemyKind, type Snapshot, type SnapFx, type UpgradeLevels,
} from '@/lib/game/config'
import { getSpriteSet, SPRITE_SCALE, type SpriteKey } from '@/lib/game/sprites'
import {
  ensureAudio, sfxShoot, sfxHit, sfxCrit, sfxPickup, sfxHurt,
  sfxDash, sfxDeath, sfxLevel, sfxBoss,
} from '@/lib/game/audio'
import type { Socket } from 'socket.io-client'

export interface SnapEntry { t: number; s: Snapshot }
export interface AnnEntry { text: string; kind: string; t0: number }

interface ArenaProps {
  socketRef: React.MutableRefObject<Socket | null>
  myIdRef: React.MutableRefObject<string>
  upgradesRef: React.MutableRefObject<UpgradeLevels>
  localPosRef: React.MutableRefObject<{ x: number; y: number }>
  snapBufRef: React.MutableRefObject<SnapEntry[]>
  fxQueueRef: React.MutableRefObject<SnapFx[]>
  annRef: React.MutableRefObject<AnnEntry[]>
}

interface Floater { x: number; y: number; vy: number; life: number; max: number; text: string; color: string; size: number }
interface Particle { x: number; y: number; vx: number; vy: number; life: number; max: number; color: string; size: number }

const KIND_COLOR: Record<EnemyKind, string> = {
  slime: '#5cc460', bat: '#8a5fbf', skeleton: '#e8e4d4', goblin: '#6fae4a',
  shaman: '#c95cd9', knight: '#8d99a6', necromancer: '#4a2a6a',
}

const ENEMY_SPRITE: Record<EnemyKind, SpriteKey> = {
  slime: 'slime', bat: 'bat', skeleton: 'skeleton', goblin: 'goblin',
  shaman: 'shaman', knight: 'knight', necromancer: 'necromancer',
}

function makeFloorPattern(): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = 128; c.height = 128
  const g = c.getContext('2d')!
  for (let ty = 0; ty < 2; ty++) {
    for (let tx = 0; tx < 2; tx++) {
      const ox = tx * 64, oy = ty * 64
      g.fillStyle = '#2c2935'
      g.fillRect(ox, oy, 64, 64)
      g.fillStyle = '#232029'
      g.fillRect(ox, oy, 64, 2)
      g.fillRect(ox, oy, 2, 64)
      g.fillStyle = '#332f3d'
      g.fillRect(ox + 2, oy + 2, 60, 1)
      for (let i = 0; i < 7; i++) {
        g.fillStyle = Math.random() < 0.12 ? '#3d5c3a' : '#262330'
        g.fillRect(ox + 4 + Math.floor(Math.random() * 56), oy + 4 + Math.floor(Math.random() * 56), 2, 2)
      }
      if (Math.random() < 0.6) {
        g.strokeStyle = '#1c1a24'
        g.lineWidth = 1
        g.beginPath()
        const sx = ox + 8 + Math.random() * 40, sy = oy + 8 + Math.random() * 40
        g.moveTo(sx, sy)
        g.lineTo(sx + (Math.random() - 0.5) * 30, sy + (Math.random() - 0.5) * 30)
        g.stroke()
      }
    }
  }
  return c
}

function makeVignette(w: number, h: number): HTMLCanvasElement {
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.36, w / 2, h / 2, Math.max(w, h) * 0.72)
  grad.addColorStop(0, 'rgba(0,0,0,0)')
  grad.addColorStop(1, 'rgba(5,3,10,0.55)')
  g.fillStyle = grad
  g.fillRect(0, 0, w, h)
  return c
}

export default function Arena(props: ArenaProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)

  // ввод
  const keysRef = useRef<Set<string>>(new Set())
  const joyRef = useRef({ active: false, id: -1, ox: 0, oy: 0, dx: 0, dy: 0 })
  const facingRef = useRef(1)
  const dashRef = useRef({ until: 0, readyAt: 0, dirX: 1, dirY: 0 })
  const lastMoveSentRef = useRef(0)

  // камера и эффекты
  const camRef = useRef({ x: ARENA.w / 2, y: ARENA.h / 2 })
  const zoomRef = useRef(1)
  const floatersRef = useRef<Floater[]>([])
  const partsRef = useRef<Particle[]>([])
  const flashRef = useRef<Map<number, number>>(new Map())
  const hurtUntilRef = useRef(0)
  const shakeUntilRef = useRef(0)
  const lastPickSfxRef = useRef(0)
  const lastDeathSfxRef = useRef(0)
  const lastHurtSfxRef = useRef(0)
  const prevOwnProjRef = useRef(0)

  // offscreen
  const floorRef = useRef<HTMLCanvasElement | null>(null)
  const vignetteRef = useRef<HTMLCanvasElement | null>(null)
  const sizeRef = useRef({ w: 0, h: 0, dpr: 1 })

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap) return
    const ctx = canvas.getContext('2d')!

    floorRef.current = makeFloorPattern()

    const resize = () => {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const w = wrap.clientWidth, h = wrap.clientHeight
      sizeRef.current = { w, h, dpr }
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      canvas.style.width = w + 'px'
      canvas.style.height = h + 'px'
      zoomRef.current = Math.max(0.62, Math.min(1, Math.min(w, h) / 760))
      vignetteRef.current = makeVignette(w, h)
    }
    resize()
    const ro = new ResizeObserver(resize)
    ro.observe(wrap)

    // ---------- клавиатура ----------
    const down = (e: KeyboardEvent) => {
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault()
      keysRef.current.add(e.code)
      if (e.code === 'Space') tryDash()
      ensureAudio()
    }
    const up = (e: KeyboardEvent) => keysRef.current.delete(e.code)
    window.addEventListener('keydown', down)
    window.addEventListener('keyup', up)

    // ---------- тач ----------
    const findTouch = (list: TouchList, id: number): Touch | null => {
      for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i]
      return null
    }
    const tStart = (e: TouchEvent) => {
      e.preventDefault()
      ensureAudio()
      const rect = canvas.getBoundingClientRect()
      for (let i = 0; i < e.changedTouches.length; i++) {
        const t = e.changedTouches[i]
        const x = t.clientX - rect.left, y = t.clientY - rect.top
        if (!joyRef.current.active && x < rect.width * 0.55) {
          joyRef.current = { active: true, id: t.identifier, ox: x, oy: y, dx: 0, dy: 0 }
        } else {
          tryDash()
        }
      }
    }
    const tMove = (e: TouchEvent) => {
      e.preventDefault()
      if (!joyRef.current.active) return
      const rect = canvas.getBoundingClientRect()
      const t = findTouch(e.changedTouches, joyRef.current.id)
      if (!t) return
      let dx = t.clientX - rect.left - joyRef.current.ox
      let dy = t.clientY - rect.top - joyRef.current.oy
      const len = Math.hypot(dx, dy)
      const max = 46
      if (len > max) { dx = (dx / len) * max; dy = (dy / len) * max }
      joyRef.current.dx = dx / max
      joyRef.current.dy = dy / max
    }
    const tEnd = (e: TouchEvent) => {
      if (joyRef.current.active && findTouch(e.changedTouches, joyRef.current.id)) {
        joyRef.current = { active: false, id: -1, ox: 0, oy: 0, dx: 0, dy: 0 }
      }
    }
    canvas.addEventListener('touchstart', tStart, { passive: false })
    canvas.addEventListener('touchmove', tMove, { passive: false })
    canvas.addEventListener('touchend', tEnd)
    canvas.addEventListener('touchcancel', tEnd)

    // ---------- рывок ----------
    function tryDash() {
      const now = performance.now()
      if (now < dashRef.current.readyAt) return
      const self = selfInfo()
      if (self?.dead) return
      let dx = 0, dy = 0
      const keys = keysRef.current
      if (keys.has('KeyW') || keys.has('ArrowUp')) dy -= 1
      if (keys.has('KeyS') || keys.has('ArrowDown')) dy += 1
      if (keys.has('KeyA') || keys.has('ArrowLeft')) dx -= 1
      if (keys.has('KeyD') || keys.has('ArrowRight')) dx += 1
      if (joyRef.current.active) { dx = joyRef.current.dx; dy = joyRef.current.dy }
      if (dx === 0 && dy === 0) { dx = facingRef.current; dy = 0 }
      const len = Math.hypot(dx, dy) || 1
      dashRef.current = { until: now + 160, readyAt: now + 2500, dirX: dx / len, dirY: dy / len }
      sfxDash()
    }

    function selfInfo() {
      const buf = props.snapBufRef.current
      const latest = buf.length ? buf[buf.length - 1].s : null
      if (!latest) return null
      return latest.players.find((p) => p.id === props.myIdRef.current) ?? null
    }

    // ---------- основной цикл ----------
    let raf = 0
    let last = performance.now()

    const frame = (now: number) => {
      const dt = Math.min(0.05, (now - last) / 1000)
      last = now
      const { w, h, dpr } = sizeRef.current
      const zoom = zoomRef.current
      const socket = props.socketRef.current
      const myId = props.myIdRef.current

      // --- снапшоты: до/после для интерполяции ---
      const buf = props.snapBufRef.current
      const rt = now - 110
      let ai = 0
      for (let i = 0; i < buf.length; i++) { if (buf[i].t <= rt) ai = i; else break }
      const bi = Math.min(ai + 1, Math.max(0, buf.length - 1))
      const A = buf.length ? buf[ai].s : null
      const B = buf.length ? buf[bi].s : null
      const alpha = A && B && bi > ai && buf[bi].t > buf[ai].t
        ? Math.min(1, Math.max(0, (rt - buf[ai].t) / (buf[bi].t - buf[ai].t)))
        : 1
      const L = (a: number, b: number) => a + (b - a) * alpha

      const self = B?.players.find((p) => p.id === myId) ?? null

      // --- движение своего героя (клиентское предсказание) ---
      if (B && !self?.dead) {
        const st = computeStats(props.upgradesRef.current)
        let ix = 0, iy = 0
        const keys = keysRef.current
        if (keys.has('KeyW') || keys.has('ArrowUp')) iy -= 1
        if (keys.has('KeyS') || keys.has('ArrowDown')) iy += 1
        if (keys.has('KeyA') || keys.has('ArrowLeft')) ix -= 1
        if (keys.has('KeyD') || keys.has('ArrowRight')) ix += 1
        if (joyRef.current.active) { ix = joyRef.current.dx; iy = joyRef.current.dy }
        const il = Math.hypot(ix, iy)
        if (il > 1) { ix /= il; iy /= il }
        if (il > 0.05) {
          if (ix > 0.15) facingRef.current = 1
          else if (ix < -0.15) facingRef.current = -1
        }
        let speed = st.speed
        if (now < dashRef.current.until) {
          ix = dashRef.current.dirX; iy = dashRef.current.dirY
          speed *= 3.2
        }
        const pos = props.localPosRef.current
        pos.x = Math.max(ARENA.wall + 24, Math.min(ARENA.w - ARENA.wall - 24, pos.x + ix * speed * dt))
        pos.y = Math.max(ARENA.wall + 24, Math.min(ARENA.h - ARENA.wall - 24, pos.y + iy * speed * dt))
        // мягкая коррекция по серверу
        if (self) {
          const ddx = self.x - pos.x, ddy = self.y - pos.y
          if (Math.hypot(ddx, ddy) > 90) { pos.x = self.x; pos.y = self.y }
          else { pos.x += ddx * Math.min(1, dt * 2.5); pos.y += ddy * Math.min(1, dt * 2.5) }
        }
        if (socket && now - lastMoveSentRef.current > 50) {
          lastMoveSentRef.current = now
          socket.emit('move', { x: Math.round(pos.x), y: Math.round(pos.y), dx: facingRef.current })
        }
      }

      // --- обработка fx ---
      const fxs = props.fxQueueRef.current
      if (fxs.length) {
        props.fxQueueRef.current = []
        for (const fx of fxs) {
          if (fx.k === 'hit' || fx.k === 'crit') {
            if (fx.d) {
              floatersRef.current.push({
                x: fx.x + (Math.random() - 0.5) * 14, y: fx.y, vy: -46,
                life: 0.7, max: 0.7, text: String(fx.d) + (fx.k === 'crit' ? '!' : ''),
                color: fx.k === 'crit' ? '#ffd24a' : '#f2f2f2', size: fx.k === 'crit' ? 15 : 12,
              })
            }
            for (let i = 0; i < (fx.k === 'crit' ? 6 : 3); i++) {
              const a = Math.random() * Math.PI * 2
              partsRef.current.push({ x: fx.x, y: fx.y, vx: Math.cos(a) * 60, vy: Math.sin(a) * 60 - 30, life: 0.3, max: 0.3, color: fx.k === 'crit' ? '#ffd24a' : '#ffffff', size: 2 })
            }
            // вспышка врага рядом
            if (B) {
              for (const e of B.enemies) {
                if (Math.hypot(e.x - fx.x, e.y - fx.y) < 26) { flashRef.current.set(e.id, now + 110); break }
              }
            }
            if (fx.k === 'crit') sfxCrit(); else sfxHit()
          } else if (fx.k === 'hurt') {
            hurtUntilRef.current = now + 260
            shakeUntilRef.current = now + 180
            if (fx.d) {
              floatersRef.current.push({ x: fx.x, y: fx.y - 20, vy: -40, life: 0.7, max: 0.7, text: '-' + fx.d, color: '#ff7b6b', size: 13 })
            }
            const t = performance.now()
            if (t - lastHurtSfxRef.current > 180) { lastHurtSfxRef.current = t; sfxHurt() }
          } else if (fx.k === 'death') {
            const color = KIND_COLOR[fx.t ?? 'slime'] ?? '#ffffff'
            for (let i = 0; i < 12; i++) {
              const a = Math.random() * Math.PI * 2
              const sp = 40 + Math.random() * 90
              partsRef.current.push({ x: fx.x, y: fx.y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 40, life: 0.5 + Math.random() * 0.25, max: 0.7, color, size: 2 + Math.random() * 2 })
            }
            const t = performance.now()
            if (t - lastDeathSfxRef.current > 90) { lastDeathSfxRef.current = t; sfxDeath() }
          } else if (fx.k === 'pick') {
            for (let i = 0; i < 5; i++) {
              const a = Math.random() * Math.PI * 2
              partsRef.current.push({ x: fx.x, y: fx.y, vx: Math.cos(a) * 50, vy: Math.sin(a) * 50 - 50, life: 0.35, max: 0.35, color: '#ffd24a', size: 2 })
            }
            const t = performance.now()
            if (t - lastPickSfxRef.current > 120) { lastPickSfxRef.current = t; sfxPickup() }
          }
        }
      }

      // --- звук выстрела: рост числа своих снарядов ---
      if (B) {
        let own = 0
        for (const p of B.projs) if (p.own) own++
        if (own > prevOwnProjRef.current) sfxShoot()
        prevOwnProjRef.current = own
      }

      // --- камера ---
      const pos = props.localPosRef.current
      let targetX = pos.x, targetY = pos.y
      if (self?.dead && B) {
        const alive = B.players.find((p) => !p.dead)
        if (alive) { targetX = alive.x; targetY = alive.y }
      }
      const cam = camRef.current
      cam.x += (targetX - cam.x) * Math.min(1, dt * 7)
      cam.y += (targetY - cam.y) * Math.min(1, dt * 7)
      const viewW = w / zoom, viewH = h / zoom
      const camX = Math.min(Math.max(cam.x, viewW / 2), ARENA.w - viewW / 2)
      const camY = Math.min(Math.max(cam.y, viewH / 2), ARENA.h - viewH / 2)

      // ---------- РЕНДЕР ----------
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.imageSmoothingEnabled = false
      ctx.fillStyle = '#0d0b12'
      ctx.fillRect(0, 0, w, h)

      let shX = 0, shY = 0
      if (now < shakeUntilRef.current) {
        const mag = 5 * ((shakeUntilRef.current - now) / 180)
        shX = (Math.random() - 0.5) * mag
        shY = (Math.random() - 0.5) * mag
      }

      ctx.save()
      ctx.translate(w / 2 + shX, h / 2 + shY)
      ctx.scale(zoom, zoom)
      ctx.translate(-camX, -camY)

      // пол
      const floor = floorRef.current
      if (floor) {
        const pat = ctx.createPattern(floor, 'repeat')
        if (pat) {
          ctx.fillStyle = pat
          ctx.fillRect(0, 0, ARENA.w, ARENA.h)
        }
      }
      // стены
      ctx.fillStyle = '#1a1722'
      ctx.fillRect(0, 0, ARENA.w, ARENA.wall)
      ctx.fillRect(0, ARENA.h - ARENA.wall, ARENA.w, ARENA.wall)
      ctx.fillRect(0, 0, ARENA.wall, ARENA.h)
      ctx.fillRect(ARENA.w - ARENA.wall, 0, ARENA.wall, ARENA.h)
      ctx.strokeStyle = '#3a3348'
      ctx.lineWidth = 3
      ctx.strokeRect(ARENA.wall, ARENA.wall, ARENA.w - ARENA.wall * 2, ARENA.h - ARENA.wall * 2)

      const inView = (x: number, y: number, pad = 80) =>
        x > camX - viewW / 2 - pad && x < camX + viewW / 2 + pad &&
        y > camY - viewH / 2 - pad && y < camY + viewH / 2 + pad

      // гемы
      if (B) {
        const gemSet = getSpriteSet('gem')
        for (const g of B.gems) {
          if (!inView(g.x, g.y)) continue
          const bob = Math.sin(now / 260 + g.id) * 2
          ctx.globalAlpha = 0.16
          ctx.fillStyle = '#ffd24a'
          ctx.beginPath()
          ctx.arc(g.x, g.y + bob, 9, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = 1
          const spr = gemSet.frames[0]
          ctx.drawImage(spr, g.x - spr.width / 2, g.y - spr.height / 2 + bob)
        }

        // снаряды
        for (const p of B.projs) {
          if (!inView(p.x, p.y)) continue
          const key: SpriteKey = p.own ? 'bolt' : 'fireball'
          const set = getSpriteSet(key)
          const spr = set.frames[0]
          ctx.globalAlpha = 0.25
          ctx.fillStyle = p.own ? '#ffb02e' : '#e35b3a'
          ctx.beginPath()
          ctx.arc(p.x - Math.cos(p.a) * 8, p.y - Math.sin(p.a) * 8, 5, 0, Math.PI * 2)
          ctx.fill()
          ctx.globalAlpha = 1
          ctx.save()
          ctx.translate(p.x, p.y)
          ctx.rotate(p.a)
          ctx.drawImage(spr, -spr.width / 2, -spr.height / 2)
          ctx.restore()
        }
      }

      // сущности (сортировка по y)
      type Rend = { y: number; f: () => void }
      const rends: Rend[] = []

      if (B) {
        const animFrame = Math.floor(now / 200) % 2
        const AEnemyMap = A ? new Map(A.enemies.map((e) => [e.id, e])) : null

        for (const e of B.enemies) {
          if (!inView(e.x, e.y, 120)) continue
          const eA = AEnemyMap?.get(e.id)
          const ex = eA ? L(eA.x, e.x) : e.x
          const ey = eA ? L(eA.y, e.y) : e.y
          rends.push({
            y: ey, f: () => {
              const set = getSpriteSet(ENEMY_SPRITE[e.t])
              const def = ENEMIES[e.t]
              const bob = e.t === 'bat' ? Math.sin(now / 90 + e.id) * 3 : 0
              const fi = (Math.floor(now / 200 + e.id * 0.7) % 2)
              const spr = set.frames[fi]
              const flashUntil = flashRef.current.get(e.id) ?? 0
              // тень
              ctx.globalAlpha = 0.3
              ctx.fillStyle = '#000'
              ctx.beginPath()
              ctx.ellipse(ex, ey + spr.height / 2 - 2, spr.width / 2.6, 4, 0, 0, Math.PI * 2)
              ctx.fill()
              ctx.globalAlpha = 1
              ctx.save()
              ctx.translate(ex, ey + bob)
              if (e.f === -1) ctx.scale(-1, 1)
              if (now < flashUntil) {
                ctx.drawImage(set.white[fi], -spr.width / 2, -spr.height / 2)
                ctx.globalAlpha = 0.85
                ctx.drawImage(spr, -spr.width / 2, -spr.height / 2)
                ctx.globalAlpha = 1
              } else {
                ctx.drawImage(spr, -spr.width / 2, -spr.height / 2)
              }
              ctx.restore()
              // полоска HP
              if (e.hp < e.mhp || def.boss) {
                const bw = Math.max(22, def.radius * 2.2)
                const pct = Math.max(0, e.hp / e.mhp)
                ctx.fillStyle = 'rgba(0,0,0,0.6)'
                ctx.fillRect(ex - bw / 2, ey - spr.height / 2 - 8, bw, 4)
                ctx.fillStyle = def.boss ? '#c45cd9' : '#d95c5c'
                ctx.fillRect(ex - bw / 2, ey - spr.height / 2 - 8, bw * pct, 4)
              }
            },
          })
        }

        // игроки
        const APlayerMap = A ? new Map(A.players.map((p) => [p.id, p])) : null
        for (const pl of B.players) {
          if (pl.dead) continue
          const isSelf = pl.id === myId
          const pA = APlayerMap?.get(pl.id)
          const px = isSelf ? pos.x : (pA ? L(pA.x, pl.x) : pl.x)
          const py = isSelf ? pos.y : (pA ? L(pA.y, pl.y) : pl.y)
          rends.push({
            y: py, f: () => {
              const set = getSpriteSet('player')
              const spr = set.frames[Math.floor(now / 180) % 2]
              ctx.globalAlpha = 0.32
              ctx.fillStyle = '#000'
              ctx.beginPath()
              ctx.ellipse(px, py + spr.height / 2 - 2, spr.width / 2.6, 4, 0, 0, Math.PI * 2)
              ctx.fill()
              ctx.globalAlpha = 1
              ctx.save()
              ctx.translate(px, py)
              const face = isSelf ? facingRef.current : pl.f
              if (face === -1) ctx.scale(-1, 1)
              ctx.drawImage(spr, -spr.width / 2, -spr.height / 2)
              ctx.restore()
              // имя
              ctx.font = 'bold 11px system-ui, sans-serif'
              ctx.textAlign = 'center'
              ctx.fillStyle = 'rgba(0,0,0,0.65)'
              const label = isSelf ? pl.n + ' (вы)' : pl.n
              const tw = ctx.measureText(label).width
              ctx.fillRect(px - tw / 2 - 3, py - spr.height / 2 - 22, tw + 6, 13)
              ctx.fillStyle = isSelf ? '#ffd24a' : '#e8e4d4'
              ctx.fillText(label, px, py - spr.height / 2 - 12)
              // HP
              if (pl.hp < pl.mhp) {
                const bw = 30
                ctx.fillStyle = 'rgba(0,0,0,0.6)'
                ctx.fillRect(px - bw / 2, py - spr.height / 2 - 7, bw, 3)
                ctx.fillStyle = '#5cd97c'
                ctx.fillRect(px - bw / 2, py - spr.height / 2 - 7, bw * Math.max(0, pl.hp / pl.mhp), 3)
              }
            },
          })
        }
      }

      rends.sort((a, b) => a.y - b.y)
      for (const r of rends) r.f()

      // частицы
      const parts = partsRef.current
      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i]
        p.life -= dt
        if (p.life <= 0) { parts.splice(i, 1); continue }
        p.x += p.vx * dt
        p.y += p.vy * dt
        p.vy += 140 * dt
        ctx.globalAlpha = Math.max(0, p.life / p.max)
        ctx.fillStyle = p.color
        ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size)
      }
      ctx.globalAlpha = 1

      // всплывающие числа
      const floats = floatersRef.current
      for (let i = floats.length - 1; i >= 0; i--) {
        const f = floats[i]
        f.life -= dt
        if (f.life <= 0) { floats.splice(i, 1); continue }
        f.y += f.vy * dt
        f.vy += 60 * dt
        ctx.globalAlpha = Math.min(1, f.life / (f.max * 0.5))
        ctx.font = `bold ${f.size}px ui-monospace, monospace`
        ctx.textAlign = 'center'
        ctx.strokeStyle = 'rgba(0,0,0,0.8)'
        ctx.lineWidth = 3
        ctx.strokeText(f.text, f.x, f.y)
        ctx.fillStyle = f.color
        ctx.fillText(f.text, f.x, f.y)
      }
      ctx.globalAlpha = 1

      ctx.restore() // конец мировой системы

      // виньетка + вспышка урона
      if (vignetteRef.current) ctx.drawImage(vignetteRef.current, 0, 0, w, h)
      if (now < hurtUntilRef.current) {
        ctx.fillStyle = `rgba(200,30,30,${0.22 * ((hurtUntilRef.current - now) / 260)})`
        ctx.fillRect(0, 0, w, h)
      }

      // ---------- HUD ----------
      if (B && self) {
        const narrow = w < 640
        // HP
        const hpPct = Math.max(0, self.hp / self.mhp)
        const hpY = narrow ? 66 : 40
        const barW = narrow ? Math.min(220, w - 28) : 224
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.fillRect(14, hpY, barW + 4, 20)
        ctx.fillStyle = hpPct > 0.5 ? '#5cd97c' : hpPct > 0.25 ? '#d9c95c' : '#d95c5c'
        ctx.fillRect(16, hpY + 2, barW * hpPct, 16)
        ctx.font = 'bold 11px ui-monospace, monospace'
        ctx.textAlign = 'left'
        ctx.fillStyle = '#0d0b12'
        ctx.fillText(`HP ${self.hp}/${self.mhp}`, 22, hpY + 14)
        // уровень
        const lvlW = narrow ? 120 : 224
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.fillRect(14, narrow ? 42 : 16, lvlW, 20)
        ctx.fillStyle = '#ffd24a'
        ctx.font = 'bold 12px ui-monospace, monospace'
        ctx.fillText(`УР. ${self.lvl}`, 20, (narrow ? 42 : 16) + 14)
        // волна/таймер
        const wpW = narrow ? 150 : 180
        ctx.textAlign = 'center'
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.fillRect(w / 2 - wpW / 2, 12, wpW, narrow ? 40 : 46)
        ctx.fillStyle = '#e8d5a3'
        ctx.font = `bold ${narrow ? 15 : 18}px system-ui, sans-serif`
        ctx.fillText(`Волна ${B.wave}`, w / 2, narrow ? 30 : 32)
        const mm = String(Math.floor(B.time / 60)).padStart(2, '0')
        const ss = String(Math.floor(B.time % 60)).padStart(2, '0')
        ctx.font = narrow ? '10px ui-monospace, monospace' : '12px ui-monospace, monospace'
        ctx.fillStyle = '#a89c8a'
        ctx.fillText(`${mm}:${ss}  ·  врагов: ${B.left}`, w / 2, narrow ? 45 : 50)
        if (B.waveState === 'intermission') {
          ctx.fillStyle = '#9fd9a3'
          ctx.font = `bold ${narrow ? 11 : 14}px system-ui, sans-serif`
          ctx.fillText(`Следующая волна через ${B.interLeft.toFixed(1)} с`, w / 2, narrow ? 66 : 78)
        }
        // список игроков
        ctx.textAlign = 'left'
        let py0 = narrow ? 110 : 16
        const listW = narrow ? 126 : 160
        for (const pl of B.players) {
          if (pl.id === myId) continue
          ctx.fillStyle = 'rgba(0,0,0,0.45)'
          ctx.fillRect(w - listW - 14, py0, listW, 22)
          ctx.fillStyle = pl.dead ? '#777' : '#e8e4d4'
          ctx.font = 'bold 10px system-ui, sans-serif'
          const nm = pl.n.length > 8 ? pl.n.slice(0, 8) + '…' : pl.n
          ctx.fillText(`${nm} · Ур.${pl.lvl}`, w - listW - 8, py0 + 14)
          if (pl.dead) {
            ctx.fillStyle = '#d96b5c'
            ctx.font = 'bold 10px ui-monospace, monospace'
            ctx.fillText(pl.rev ? `~${pl.rev}с` : '✕', w - 22, py0 + 14)
          } else {
            ctx.fillStyle = 'rgba(255,255,255,0.15)'
            ctx.fillRect(w - listW - 8, py0 + 16, listW - 12, 3)
            ctx.fillStyle = '#5cd97c'
            ctx.fillRect(w - listW - 8, py0 + 16, (listW - 12) * Math.max(0, pl.hp / pl.mhp), 3)
          }
          py0 += 26
        }
        // XP-бар
        const xpPct = self.xpn > 0 ? Math.min(1, self.xpv / self.xpn) : 0
        ctx.fillStyle = 'rgba(0,0,0,0.6)'
        ctx.fillRect(0, h - 8, w, 8)
        ctx.fillStyle = '#ffd24a'
        ctx.fillRect(0, h - 8, w * xpPct, 8)
        // рывок
        const dashReady = now >= dashRef.current.readyAt
        const dashPct = dashReady ? 1 : 1 - (dashRef.current.readyAt - now) / 2500
        ctx.fillStyle = 'rgba(0,0,0,0.55)'
        ctx.fillRect(14, h - 46, 62, 26)
        ctx.fillStyle = dashReady ? '#6fdc9f' : '#55506a'
        ctx.fillRect(16, h - 44, 58 * dashPct, 22)
        ctx.fillStyle = dashReady ? '#0d0b12' : '#c9c4d4'
        ctx.font = 'bold 11px ui-monospace, monospace'
        ctx.fillText('РЫВОК', 22, h - 29)
        // босс-бар
        const boss = B.enemies.find((e) => e.t === 'necromancer')
        if (boss) {
          const bw = Math.min(460, w - 140)
          const bx = w / 2 - bw / 2
          ctx.fillStyle = 'rgba(0,0,0,0.6)'
          ctx.fillRect(bx - 3, h - 44, bw + 6, 22)
          ctx.fillStyle = '#2a1030'
          ctx.fillRect(bx, h - 40, bw, 14)
          ctx.fillStyle = '#c45cd9'
          ctx.fillRect(bx, h - 40, bw * Math.max(0, boss.hp / boss.mhp), 14)
          ctx.fillStyle = '#e9c8f2'
          ctx.font = 'bold 11px system-ui, sans-serif'
          ctx.textAlign = 'center'
          ctx.fillText('НЕКРОМАНТ', w / 2, h - 30)
        }
        // джойстик
        if (joyRef.current.active) {
          ctx.strokeStyle = 'rgba(255,255,255,0.35)'
          ctx.lineWidth = 2
          ctx.beginPath()
          ctx.arc(joyRef.current.ox, joyRef.current.oy, 46, 0, Math.PI * 2)
          ctx.stroke()
          ctx.fillStyle = 'rgba(255,255,255,0.35)'
          ctx.beginPath()
          ctx.arc(joyRef.current.ox + joyRef.current.dx * 40, joyRef.current.oy + joyRef.current.dy * 40, 18, 0, Math.PI * 2)
          ctx.fill()
        }
        // смерть игрока
        if (self.dead) {
          ctx.fillStyle = 'rgba(0,0,0,0.45)'
          ctx.fillRect(0, 0, w, h)
          ctx.textAlign = 'center'
          ctx.fillStyle = '#d96b5c'
          ctx.font = 'bold 26px system-ui, sans-serif'
          ctx.fillText('Вы погибли', w / 2, h / 2 - 14)
          ctx.fillStyle = '#e8e4d4'
          ctx.font = '14px system-ui, sans-serif'
          const waitTxt = B.players.length > 1
            ? (self.rev ? `Возрождение через ${self.rev} с…` : 'Ждём исхода битвы…')
            : 'Забег окончен'
          ctx.fillText(waitTxt, w / 2, h / 2 + 14)
        }
        // уровень (xp next)
        void xpNeeded(self.lvl)
      }

      // ---------- Объявления ----------
      const anns = props.annRef.current
      for (let i = anns.length - 1; i >= 0; i--) {
        const a = anns[i]
        const age = now - a.t0
        const life = a.kind === 'boss' ? 3000 : 2100
        if (age > life) { anns.splice(i, 1); continue }
        const fadeIn = Math.min(1, age / 180)
        const fadeOut = Math.min(1, (life - age) / 300)
        const pop = 1 + Math.max(0, 1 - age / 220) * 0.25
        ctx.save()
        ctx.globalAlpha = Math.min(fadeIn, fadeOut)
        ctx.translate(w / 2, h * 0.3)
        ctx.scale(pop, pop)
        ctx.textAlign = 'center'
        ctx.font = `bold ${a.kind === 'boss' ? 30 : 24}px system-ui, sans-serif`
        ctx.strokeStyle = 'rgba(0,0,0,0.85)'
        ctx.lineWidth = 5
        ctx.strokeText(a.text, 0, 0)
        ctx.fillStyle = a.kind === 'boss' ? '#c45cd9' : a.kind === 'death' ? '#d96b5c' : a.kind === 'info' ? '#9fd9a3' : '#e8d5a3'
        ctx.fillText(a.text, 0, 0)
        ctx.restore()
      }
      ctx.globalAlpha = 1

      raf = requestAnimationFrame(frame)
    }

    raf = requestAnimationFrame(frame)

    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup', up)
      canvas.removeEventListener('touchstart', tStart)
      canvas.removeEventListener('touchmove', tMove)
      canvas.removeEventListener('touchend', tEnd)
      canvas.removeEventListener('touchcancel', tEnd)
    }
  }, [])

  return (
    <div ref={wrapRef} className="absolute inset-0 overflow-hidden bg-[#0d0b12]">
      <canvas
        ref={canvasRef}
        className="block touch-none select-none"
        style={{ imageRendering: 'pixelated' }}
      />
    </div>
  )
}
