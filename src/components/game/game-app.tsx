'use client'

/**
 * Dungeon Arena — корневой клиентский компонент.
 * Меню, лобби комнат, подключение к игровому серверу, HUD-модалки.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { io, type Socket } from 'socket.io-client'
import Arena, { type AnnEntry, type SnapEntry } from './arena'
import { getSpriteSet, type SpriteKey } from '@/lib/game/sprites'
import {
  ENEMIES, type EnemyKind, type UpgradeLevels, type SnapFx, type Snapshot,
} from '@/lib/game/config'
import {
  ensureAudio, setMuted as setAudioMuted, sfxLevel, sfxWave, sfxBoss, sfxOver,
} from '@/lib/game/audio'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Badge } from '@/components/ui/badge'

type Phase = 'menu' | 'lobby' | 'game' | 'over'

interface LobbyPlayer { id: string; n: string; ready: boolean; host: boolean }
interface LobbyState { code: string; hostId: string; state: string; players: LobbyPlayer[] }
interface UpgradeChoice { id: string; name: string; desc: string; icon: string; color: string; cur: number; max: number }
interface OverData { results: { name: string; wave: number; kills: number; level: number }[]; time: number; wave: number }
interface LeaderRow { id: string; playerName: string; wave: number; kills: number; level: number; seconds: number; players: number }

const BESTIARY: { kind: EnemyKind; isNew?: boolean }[] = [
  { kind: 'slime' },
  { kind: 'bat' },
  { kind: 'skeleton', isNew: true },
  { kind: 'goblin', isNew: true },
  { kind: 'shaman', isNew: true },
  { kind: 'knight', isNew: true },
  { kind: 'necromancer', isNew: true },
]

function SpriteImg({ k, size = 54 }: { k: SpriteKey; size?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const set = getSpriteSet(k)
    const spr = set.frames[0]
    canvas.width = spr.width
    canvas.height = spr.height
    const g = canvas.getContext('2d')!
    g.imageSmoothingEnabled = false
    g.drawImage(spr, 0, 0)
  }, [k])
  return (
    <canvas
      ref={ref}
      style={{ width: size, height: size, imageRendering: 'pixelated' }}
      aria-label={k}
    />
  )
}

export default function GameApp() {
  const [phase, setPhase] = useState<Phase>('menu')
  const [name, setName] = useState('')
  const [joinCode, setJoinCode] = useState('')
  const [lobby, setLobby] = useState<LobbyState | null>(null)
  const [myId, setMyId] = useState('')
  const [levelUp, setLevelUp] = useState<{ lvl: number; choices: UpgradeChoice[] } | null>(null)
  const [over, setOver] = useState<OverData | null>(null)
  const [connErr, setConnErr] = useState('')
  const [connected, setConnected] = useState(false)
  const [leaders, setLeaders] = useState<LeaderRow[]>([])
  const [muted, setMutedState] = useState(false)
  const [copied, setCopied] = useState(false)

  const socketRef = useRef<Socket | null>(null)
  const myIdRef = useRef('')
  const upgradesRef = useRef<UpgradeLevels>({})
  const localPosRef = useRef({ x: 1200, y: 900 })
  const snapBufRef = useRef<SnapEntry[]>([])
  const fxQueueRef = useRef<SnapFx[]>([])
  const annRef = useRef<AnnEntry[]>([])
  const phaseRef = useRef<Phase>('menu')
  useEffect(() => {
    phaseRef.current = phase
  }, [phase])

  const fetchLeaders = useCallback(() => {
    fetch('/api/leaderboard')
      .then((r) => r.json())
      .then((d) => setLeaders(d.results ?? []))
      .catch(() => {})
  }, [])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      const saved = localStorage.getItem('da_name')
      if (!cancelled) {
        setName(saved || `Герой-${Math.floor(100 + Math.random() * 900)}`)
      }
    }
    load()
    fetchLeaders()
    return () => {
      cancelled = true
    }
  }, [fetchLeaders])

  useEffect(() => {
    const s = io('/?XTransformPort=3010', {
      transports: ['websocket', 'polling'],
      forceNew: true,
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 1200,
      timeout: 10000,
    })
    socketRef.current = s

    s.on('connect', () => setConnected(true))
    s.on('disconnect', () => {
      setConnected(false)
      if (phaseRef.current === 'game' || phaseRef.current === 'lobby') {
        setConnErr('Соединение потеряно. Нажмите «В меню» и подключитесь заново.')
      }
    })

    s.on('joined', (data: LobbyState & { id: string }) => {
      myIdRef.current = data.id
      setMyId(data.id)
      setLobby({ code: data.code, hostId: data.hostId, state: data.state, players: data.players })
      if (data.state === 'lobby') setPhase('lobby')
      setConnErr('')
    })

    s.on('lobby', (data: LobbyState) => {
      setLobby(data)
      if (data.state === 'lobby' && phaseRef.current === 'over') {
        setPhase('lobby')
      }
    })

    s.on('gameStarted', () => {
      upgradesRef.current = {}
      snapBufRef.current = []
      fxQueueRef.current = []
      annRef.current = []
      localPosRef.current = { x: 1200, y: 900 }
      setLevelUp(null)
      setOver(null)
      setPhase('game')
    })

    s.on('snap', (snap: Snapshot) => {
      const buf = snapBufRef.current
      buf.push({ t: performance.now(), s: snap })
      if (buf.length > 5) buf.shift()
      if (snap.fx?.length) fxQueueRef.current.push(...snap.fx)
    })

    s.on('levelup', (data: { lvl: number; choices: UpgradeChoice[] }) => {
      setLevelUp(data)
      sfxLevel()
    })

    s.on('announce', (data: { text: string; kind: string }) => {
      annRef.current.push({ text: data.text, kind: data.kind, t0: performance.now() })
      if (annRef.current.length > 4) annRef.current.shift()
      if (data.kind === 'boss') sfxBoss()
      else if (data.kind === 'wave') sfxWave()
    })

    s.on('over', (data: OverData) => {
      setOver(data)
      setLevelUp(null)
      setPhase('over')
      sfxOver()
      fetchLeaders()
    })

    s.on('forcePos', (data: { x: number; y: number }) => {
      localPosRef.current = { x: data.x, y: data.y }
    })

    s.on('err', (data: { msg: string }) => {
      setConnErr(data.msg)
    })

    return () => {
      s.disconnect()
      socketRef.current = null
    }
  }, [fetchLeaders])

  const saveName = (n: string) => {
    localStorage.setItem('da_name', n)
  }

  const isHost = lobby ? lobby.hostId === myId : false

  // ---------- действия ----------
  const startSolo = () => {
    if (!name.trim()) return
    ensureAudio(); saveName(name.trim())
    setConnErr('')
    socketRef.current?.emit('solo', { name: name.trim() })
  }
  const createRoom = () => {
    if (!name.trim()) return
    ensureAudio(); saveName(name.trim())
    setConnErr('')
    socketRef.current?.emit('create', { name: name.trim() })
  }
  const joinRoom = () => {
    if (!name.trim() || joinCode.trim().length < 4) return
    ensureAudio(); saveName(name.trim())
    setConnErr('')
    socketRef.current?.emit('join', { name: name.trim(), code: joinCode.trim().toUpperCase() })
  }
  const toggleReady = () => socketRef.current?.emit('ready')
  const startMatch = () => socketRef.current?.emit('start')
  const pickUpgrade = (id: string) => {
    socketRef.current?.emit('pick', { id })
    if (id !== 'heal') {
      upgradesRef.current = { ...upgradesRef.current, [id]: (upgradesRef.current[id] ?? 0) + 1 }
    }
    setLevelUp(null)
  }
  const playAgain = () => socketRef.current?.emit('again')
  const toMenu = () => {
    socketRef.current?.emit('leave')
    setPhase('menu')
    setLobby(null)
    setOver(null)
    setLevelUp(null)
    snapBufRef.current = []
    fxQueueRef.current = []
    annRef.current = []
    fetchLeaders()
  }
  const toggleMute = () => {
    const m = !muted
    setMutedState(m)
    setAudioMuted(m)
  }
  const copyCode = () => {
    if (!lobby) return
    navigator.clipboard?.writeText(lobby.code).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }).catch(() => {})
  }

  const showArena = phase === 'game' || phase === 'over'

  // ---------- РЕНДЕР ----------
  return (
    <div className="fixed inset-0 bg-[#12101a] text-[#e8e4d4] overflow-hidden select-none">
      {/* Игровая арена */}
      {showArena && (
        <Arena
          socketRef={socketRef}
          myIdRef={myIdRef}
          upgradesRef={upgradesRef}
          localPosRef={localPosRef}
          snapBufRef={snapBufRef}
          fxQueueRef={fxQueueRef}
          annRef={annRef}
        />
      )}

      {/* Кнопки в игре */}
      {showArena && (
        <div className="absolute top-3 right-3 z-20 flex gap-2 max-sm:bottom-14 max-sm:top-auto max-sm:flex-col max-sm:items-end">
          <Button
            variant="outline"
            size="sm"
            onClick={toggleMute}
            className="bg-black/50 border-white/20 text-[#e8e4d4] hover:bg-black/70"
          >
            {muted ? 'Звук: выкл' : 'Звук: вкл'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={toMenu}
            className="bg-black/50 border-white/20 text-[#e8e4d4] hover:bg-black/70"
          >
            Выйти
          </Button>
        </div>
      )}

      {/* Модалка прокачки */}
      {levelUp && phase === 'game' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/60 p-4">
          <div className="w-full max-w-2xl">
            <h2 className="text-center text-2xl font-black text-[#ffd24a] mb-1 drop-shadow">
              Уровень {levelUp.lvl}!
            </h2>
            <p className="text-center text-sm text-[#a89c8a] mb-4">Выберите усиление:</p>
            <div className="grid gap-3 sm:grid-cols-3">
              {levelUp.choices.map((c) => (
                <button
                  key={c.id}
                  onClick={() => pickUpgrade(c.id)}
                  className="group text-left rounded-lg border-2 border-[#3a3348] bg-[#1c1926] p-4 transition hover:border-[#ffd24a] hover:bg-[#252033] focus:outline-none focus:ring-2 focus:ring-[#ffd24a]"
                >
                  <div
                    className="mb-3 flex h-12 w-12 items-center justify-center rounded-md text-sm font-black text-[#0d0b12]"
                    style={{ backgroundColor: c.color }}
                  >
                    {c.icon}
                  </div>
                  <div className="font-bold text-[#e8e4d4] group-hover:text-[#ffd24a]">{c.name}</div>
                  <div className="mt-1 text-xs text-[#a89c8a]">{c.desc}</div>
                  <div className="mt-2 text-[10px] text-[#77706a]">
                    {c.id === 'heal' ? 'Расходуемое' : `Уровень: ${c.cur}/${c.max}`}
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Экран результатов */}
      {phase === 'over' && over && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/70 p-4">
          <Card className="w-full max-w-md border-[#3a3348] bg-[#1c1926] text-[#e8e4d4]">
            <CardHeader>
              <CardTitle className="text-center text-2xl font-black text-[#d96b5c]">
                Забег окончен
              </CardTitle>
              <p className="text-center text-sm text-[#a89c8a]">
                Волна {over.wave} · продержались {Math.floor(over.time / 60)}:{String(over.time % 60).padStart(2, '0')}
              </p>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="rounded-md border border-[#3a3348]">
                {over.results.map((r, i) => (
                  <div
                    key={r.name + i}
                    className="flex items-center justify-between border-b border-[#3a3348] px-3 py-2 text-sm last:border-b-0"
                  >
                    <span className="font-semibold">{r.name}</span>
                    <span className="text-[#a89c8a]">
                      убито: <b className="text-[#e8e4d4]">{r.kills}</b> · ур. {r.level}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                {isHost ? (
                  <Button onClick={playAgain} className="flex-1 bg-[#ffd24a] text-[#0d0b12] hover:bg-[#e0b93a]">
                    Ещё раз
                  </Button>
                ) : (
                  <Button disabled className="flex-1 bg-[#2a2536] text-[#77706a]">
                    Ждём хоста…
                  </Button>
                )}
                <Button onClick={toMenu} variant="outline" className="flex-1 border-white/20 hover:bg-white/10">
                  В меню
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Лобби */}
      {phase === 'lobby' && lobby && (
        <div className="absolute inset-0 z-20 flex items-center justify-center overflow-y-auto p-4">
          <Card className="w-full max-w-md border-[#3a3348] bg-[#1c1926] text-[#e8e4d4]">
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>Лобби</span>
                <Badge variant="outline" className="border-[#ffd24a] text-[#ffd24a]">
                  {lobby.players.length}/6
                </Badge>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between rounded-md border border-[#3a3348] bg-[#12101a] p-3">
                <div>
                  <div className="text-xs text-[#a89c8a]">Код комнаты</div>
                  <div className="font-mono text-2xl font-black tracking-[0.3em] text-[#ffd24a]">
                    {lobby.code}
                  </div>
                </div>
                <Button onClick={copyCode} size="sm" variant="outline" className="border-white/20 hover:bg-white/10">
                  {copied ? 'Скопировано' : 'Копировать'}
                </Button>
              </div>
              <div className="space-y-2">
                {lobby.players.map((p) => (
                  <div key={p.id} className="flex items-center justify-between rounded-md bg-[#12101a] px-3 py-2">
                    <span className="text-sm">
                      {p.n}
                      {p.id === myId && <span className="ml-1 text-xs text-[#a89c8a]">(вы)</span>}
                      {p.host && <span className="ml-2 text-xs text-[#ffd24a]">хост</span>}
                    </span>
                    <span className={`text-xs font-bold ${p.ready ? 'text-[#5cd97c]' : 'text-[#77706a]'}`}>
                      {p.ready ? 'ГОТОВ' : 'не готов'}
                    </span>
                  </div>
                ))}
              </div>
              {connErr && <p className="text-xs text-[#d96b5c]">{connErr}</p>}
              <div className="flex gap-2">
                <Button
                  onClick={toggleReady}
                  variant="outline"
                  className="flex-1 border-white/20 hover:bg-white/10"
                >
                  Готов
                </Button>
                {isHost && (
                  <Button
                    onClick={startMatch}
                    className="flex-1 bg-[#ffd24a] text-[#0d0b12] hover:bg-[#e0b93a]"
                  >
                    Начать забег
                  </Button>
                )}
              </div>
              <Button onClick={toMenu} variant="ghost" className="w-full text-[#77706a] hover:text-[#e8e4d4]">
                Покинуть комнату
              </Button>
            </CardContent>
          </Card>
        </div>
      )}

      {/* Главное меню */}
      {phase === 'menu' && (
        <div className="absolute inset-0 z-20 overflow-y-auto">
          <div
            className="min-h-full w-full"
            style={{
              background:
                'radial-gradient(1000px 500px at 50% -10%, rgba(122,58,90,0.25), transparent), radial-gradient(800px 400px at 80% 110%, rgba(74,42,106,0.2), transparent), #12101a',
            }}
          >
            <div className="mx-auto max-w-3xl px-4 py-10">
              <div className="text-center">
                <h1 className="text-4xl font-black tracking-wider text-[#ffd24a] drop-shadow-[0_3px_0_rgba(0,0,0,0.6)] sm:text-5xl">
                  DUNGEON ARENA
                </h1>
                <p className="mt-2 text-sm text-[#a89c8a]">
                  Кооп-выживание в подземелье · волны скелетов и гоблинов из паков Dungeons
                </p>
                <div className="mt-2 flex items-center justify-center gap-2 text-xs">
                  <span className={`inline-block h-2 w-2 rounded-full ${connected ? 'bg-[#5cd97c]' : 'bg-[#d96b5c]'}`} />
                  <span className="text-[#77706a]">{connected ? 'сервер на связи' : 'подключение…'}</span>
                </div>
              </div>

              <Card className="mt-6 border-[#3a3348] bg-[#1c1926] text-[#e8e4d4]">
                <CardContent className="space-y-4 p-5">
                  <div>
                    <label className="mb-1 block text-xs text-[#a89c8a]">Имя героя</label>
                    <Input
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      maxLength={16}
                      placeholder="Ваше имя"
                      className="border-[#3a3348] bg-[#12101a] text-[#e8e4d4] placeholder:text-[#55506a]"
                    />
                  </div>
                  <Button
                    onClick={startSolo}
                    disabled={!connected || !name.trim()}
                    className="w-full bg-[#ffd24a] text-[#0d0b12] hover:bg-[#e0b93a] font-bold"
                  >
                    Одиночный забег
                  </Button>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <Button
                      onClick={createRoom}
                      disabled={!connected || !name.trim()}
                      variant="outline"
                      className="border-[#3a3348] hover:bg-white/10"
                    >
                      Создать комнату
                    </Button>
                    <div className="flex gap-2">
                      <Input
                        value={joinCode}
                        onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
                        maxLength={4}
                        placeholder="КОД"
                        className="w-24 border-[#3a3348] bg-[#12101a] font-mono uppercase tracking-widest placeholder:text-[#55506a]"
                      />
                      <Button
                        onClick={joinRoom}
                        disabled={!connected || !name.trim() || joinCode.trim().length < 4}
                        variant="outline"
                        className="flex-1 border-[#3a3348] hover:bg-white/10"
                      >
                        Войти
                      </Button>
                    </div>
                  </div>
                  {connErr && <p className="text-xs text-[#d96b5c]">{connErr}</p>}
                  <p className="text-center text-[11px] leading-relaxed text-[#77706a]">
                    ПК: <b className="text-[#a89c8a]">WASD</b> — движение, <b className="text-[#a89c8a]">Пробел</b> — рывок,
                    атака автоматическая. Телефон: джойстик слева, тап справа — рывок.
                  </p>
                </CardContent>
              </Card>

              {/* Бестиарий */}
              <Card className="mt-4 border-[#3a3348] bg-[#1c1926] text-[#e8e4d4]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Бестиарий подземелья</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 md:grid-cols-7">
                    {BESTIARY.map(({ kind, isNew }) => {
                      const def = ENEMIES[kind]
                      return (
                        <div
                          key={kind}
                          className="flex flex-col items-center rounded-md border border-[#3a3348] bg-[#12101a] p-2 text-center"
                        >
                          <div className="flex h-14 items-center justify-center">
                            <SpriteImg k={kind as SpriteKey} size={52} />
                          </div>
                          <div className="mt-1 text-[11px] font-semibold leading-tight">{def.name}</div>
                          <div className="text-[9px] text-[#77706a]">{def.pack}</div>
                          {isNew && (
                            <span className="mt-1 rounded bg-[#7a3a5a] px-1 text-[8px] font-bold text-[#ffd9e8]">
                              НОВОЕ
                            </span>
                          )}
                        </div>
                      )
                    })}
                  </div>
                </CardContent>
              </Card>

              {/* Лидерборд */}
              <Card className="mt-4 border-[#3a3348] bg-[#1c1926] text-[#e8e4d4]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-lg">Зал славы</CardTitle>
                </CardHeader>
                <CardContent className="p-4 pt-0">
                  <ScrollArea className="max-h-64">
                    {leaders.length === 0 ? (
                      <p className="py-4 text-center text-xs text-[#77706a]">
                        Пока никто не выжил ни одной волны. Станьте первым!
                      </p>
                    ) : (
                      <div className="rounded-md border border-[#3a3348]">
                        {leaders.map((r, i) => (
                          <div
                            key={r.id}
                            className="flex items-center justify-between border-b border-[#3a3348] px-3 py-1.5 text-xs last:border-b-0"
                          >
                            <span className="flex items-center gap-2">
                              <span className={`w-5 text-right font-mono font-bold ${i === 0 ? 'text-[#ffd24a]' : 'text-[#77706a]'}`}>
                                {i + 1}
                              </span>
                              <span className="font-semibold">{r.playerName}</span>
                              {r.players > 1 && <span className="text-[10px] text-[#77706a]">кооп {r.players}</span>}
                            </span>
                            <span className="text-[#a89c8a]">
                              волна <b className="text-[#e8e4d4]">{r.wave}</b> · убито {r.kills}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </ScrollArea>
                </CardContent>
              </Card>

              <p className="mt-6 text-center text-[10px] text-[#55506a]">
                Враги и боссы созданы по мотивам ассет-паков Dungeons I–III · пиксель-арт процедурный
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Затемнение при игре без арены (ожидание снапшотов) */}
      {phase === 'game' && !showArena && (
        <div className="absolute inset-0 flex items-center justify-center bg-[#12101a] text-sm text-[#a89c8a]">
          Загрузка подземелья…
        </div>
      )}
    </div>
  )
}
