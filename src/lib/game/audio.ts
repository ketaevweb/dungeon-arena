/** Мини-синтезатор звуков на WebAudio — без аудиофайлов. */

let ctx: AudioContext | null = null
let master: GainNode | null = null
let noiseBuf: AudioBuffer | null = null
let muted = false
let lastShoot = 0

export function ensureAudio() {
  if (typeof window === 'undefined') return
  if (!ctx) {
    const AC = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
    if (!AC) return
    ctx = new AC()
    master = ctx.createGain()
    master.gain.value = muted ? 0 : 0.32
    master.connect(ctx.destination)
  }
  if (ctx.state === 'suspended') ctx.resume()
}

export function setMuted(m: boolean) {
  muted = m
  if (master && ctx) master.gain.setTargetAtTime(m ? 0 : 0.32, ctx.currentTime, 0.02)
}

export function getMuted() {
  return muted
}

function noise(): AudioBuffer | null {
  if (!ctx) return null
  if (!noiseBuf) {
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.3, ctx.sampleRate)
    const d = noiseBuf.getChannelData(0)
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1
  }
  return noiseBuf
}

function tone(
  type: OscillatorType, f0: number, f1: number,
  dur: number, vol: number, delay = 0
) {
  if (!ctx || !master || muted) return
  const t0 = ctx.currentTime + delay
  const osc = ctx.createOscillator()
  const g = ctx.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(f0, t0)
  osc.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t0 + dur)
  g.gain.setValueAtTime(vol, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  osc.connect(g).connect(master)
  osc.start(t0)
  osc.stop(t0 + dur + 0.02)
}

function burst(dur: number, vol: number, freq: number, q = 1) {
  if (!ctx || !master || muted) return
  const buf = noise()
  if (!buf) return
  const t0 = ctx.currentTime
  const src = ctx.createBufferSource()
  src.buffer = buf
  const f = ctx.createBiquadFilter()
  f.type = 'bandpass'
  f.frequency.value = freq
  f.Q.value = q
  const g = ctx.createGain()
  g.gain.setValueAtTime(vol, t0)
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur)
  src.connect(f).connect(g).connect(master)
  src.start(t0)
  src.stop(t0 + dur + 0.02)
}

export function sfxShoot() {
  if (!ctx) return
  const t = ctx.currentTime
  if (t - lastShoot < 0.085) return
  lastShoot = t
  tone('triangle', 640, 190, 0.07, 0.05)
}

export function sfxHit() { burst(0.05, 0.05, 900, 0.8) }
export function sfxCrit() { burst(0.09, 0.09, 500, 1.2); tone('square', 220, 90, 0.09, 0.05) }
export function sfxPickup() { tone('sine', 660, 1320, 0.08, 0.06) }
export function sfxHurt() { tone('square', 150, 55, 0.16, 0.1) }
export function sfxDash() { burst(0.12, 0.06, 2400, 0.5) }
export function sfxDeath() { tone('sawtooth', 210, 40, 0.5, 0.12) }
export function sfxWave() { tone('square', 330, 330, 0.1, 0.06); tone('square', 440, 440, 0.12, 0.06, 0.11) }
export function sfxBoss() {
  tone('sawtooth', 70, 45, 1.1, 0.12)
  tone('sawtooth', 74, 48, 1.1, 0.1)
}
export function sfxLevel() {
  const notes = [523, 659, 784, 1047]
  notes.forEach((n, i) => tone('square', n, n, 0.11, 0.06, i * 0.09))
}
export function sfxOver() {
  const notes = [392, 330, 262, 196]
  notes.forEach((n, i) => tone('triangle', n, n * 0.98, 0.22, 0.08, i * 0.18))
}
