<script setup>
import { ref, watch, onMounted, onBeforeUnmount } from 'vue'
import { features, fxState } from '../features.js'

const el = ref(null)
let raf = 0
let ctx = null
let w = 0
let h = 0
let dpr = 1
let parts = []
let traces = []
let last = 0

const COLORS = ['#00f0ff', '#0a84ff', '#ff007a', '#30d158', '#ff9f0a', '#af52de']
const lite = () => document.documentElement.classList.contains('lite')
const mode = () => (fxState.off ? 'off' : features.fx ?? 'particles')
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

function resize() {
  const c = el.value
  if (!c) return
  dpr = lite() ? 1 : Math.min(2, devicePixelRatio || 1)
  w = innerWidth
  h = innerHeight
  c.width = w * dpr
  c.height = h * dpr
  ctx = c.getContext('2d')
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
  seed()
}

function seed() {
  const n = Math.round((w * h) / (lite() ? 38000 : 18000))
  parts = Array.from({ length: Math.min(n, lite() ? 40 : 110) }, () => ({
    x: Math.random() * w, y: Math.random() * h,
    vx: (Math.random() - 0.5) * 0.25, vy: (Math.random() - 0.5) * 0.25,
    r: Math.random() * 1.6 + 0.4, c: COLORS[Math.floor(Math.random() * 3)], p: Math.random() * Math.PI * 2,
  }))
  traces = []
}

function newTrace() {
  const g = 40
  const x = Math.round((Math.random() * w) / g) * g
  const y = Math.round((Math.random() * h) / g) * g
  const pts = [[x, y]]
  let cx = x, cy = y
  for (let i = 0; i < 4 + Math.floor(Math.random() * 4); i++) {
    const horiz = i % 2 === 0
    const len = (Math.floor(Math.random() * 4) + 1) * g * (Math.random() < 0.5 ? -1 : 1)
    if (horiz) cx += len; else cy += len
    pts.push([cx, cy])
  }
  return { pts, t: 0, speed: 0.004 + Math.random() * 0.004, c: COLORS[Math.floor(Math.random() * COLORS.length)] }
}

function pointAt(pts, t) {
  const segs = pts.length - 1
  const f = Math.min(t * segs, segs - 0.0001)
  const i = Math.floor(f)
  const k = f - i
  return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k, i]
}

function frame(now) {
  raf = requestAnimationFrame(frame)
  const fps = lite() ? 20 : 40
  if (now - last < 1000 / fps) return
  last = now
  const m = mode()
  ctx.clearRect(0, 0, w, h)
  if (m === 'particles' || m === 'both') drawParticles(now)
  if (m === 'circuit' || m === 'both') drawCircuit()
}

function drawParticles(now) {
  const link = lite() ? 0 : 120
  for (const p of parts) {
    p.x += p.vx; p.y += p.vy
    if (p.x < -10) p.x = w + 10; if (p.x > w + 10) p.x = -10
    if (p.y < -10) p.y = h + 10; if (p.y > h + 10) p.y = -10
    const a = 0.35 + Math.sin(now / 900 + p.p) * 0.25
    ctx.globalAlpha = a
    ctx.fillStyle = p.c
    ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill()
  }
  if (!link) return
  ctx.lineWidth = 0.6
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const a = parts[i], b = parts[j]
      const d = Math.hypot(a.x - b.x, a.y - b.y)
      if (d < link) {
        ctx.globalAlpha = (1 - d / link) * 0.18
        ctx.strokeStyle = a.c
        ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke()
      }
    }
  }
  ctx.globalAlpha = 1
}

function drawCircuit() {
  const max = lite() ? 4 : 10
  while (traces.length < max) traces.push(newTrace())
  for (const tr of traces) {
    tr.t += tr.speed
    const [hx, hy, idx] = pointAt(tr.pts, Math.min(tr.t, 1))
    const fade = tr.t > 1 ? Math.max(0, 1 - (tr.t - 1) * 4) : 1
    ctx.globalAlpha = 0.16 * fade
    ctx.strokeStyle = tr.c
    ctx.lineWidth = 1
    ctx.beginPath(); ctx.moveTo(tr.pts[0][0], tr.pts[0][1])
    for (let i = 1; i <= idx; i++) ctx.lineTo(tr.pts[i][0], tr.pts[i][1])
    ctx.lineTo(hx, hy); ctx.stroke()
    ctx.globalAlpha = 0.9 * fade
    ctx.fillStyle = tr.c
    ctx.shadowColor = tr.c
    ctx.shadowBlur = lite() ? 0 : 12
    ctx.beginPath(); ctx.arc(hx, hy, 2.2, 0, Math.PI * 2); ctx.fill()
    ctx.shadowBlur = 0
  }
  traces = traces.filter(t => t.t < 1.25)
  ctx.globalAlpha = 1
}

function start() {
  stop()
  if (mode() === 'off' || reduced()) { ctx?.clearRect(0, 0, w, h); return }
  raf = requestAnimationFrame(frame)
}
function stop() { cancelAnimationFrame(raf); raf = 0 }
const vis = () => (document.hidden ? stop() : start())

onMounted(() => { resize(); start(); addEventListener('resize', resize); document.addEventListener('visibilitychange', vis) })
onBeforeUnmount(() => { stop(); removeEventListener('resize', resize); document.removeEventListener('visibilitychange', vis) })
watch(mode, start)
</script>

<template>
  <canvas ref="el" class="bgfx" aria-hidden="true" />
</template>

<style scoped>
.bgfx { position: fixed; inset: 0; width: 100vw; height: 100vh; pointer-events: none; z-index: 0; }
</style>
