const FOCUSABLE = 'button:not([disabled]), a[href], input:not([disabled]):not([type=hidden]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
const DIRS = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] }

function scope() {
  const osk = document.querySelector('.osk')
  if (osk) return osk
  const sheets = document.querySelectorAll('.sheet, .overlay, .camov')
  return sheets.length ? sheets[sheets.length - 1] : document.body
}

const visible = el => {
  if (!el.offsetParent && getComputedStyle(el).position !== 'fixed') return false
  const r = el.getBoundingClientRect()
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== 'hidden'
}

function keepsArrow(el, key) {
  if (!el) return false
  const tag = el.tagName
  if (tag === 'SELECT') return key === 'ArrowUp' || key === 'ArrowDown'
  if (tag === 'TEXTAREA') return true
  if (tag === 'INPUT') {
    if (el.type === 'range') return true
    if (['checkbox', 'radio', 'button', 'submit'].includes(el.type)) return false
    if (key === 'ArrowLeft') return el.selectionStart > 0
    if (key === 'ArrowRight') return el.selectionEnd < el.value.length
    return false
  }
  return false
}

function center(r) { return { x: r.left + r.width / 2, y: r.top + r.height / 2 } }

function next(from, dir) {
  const root = scope()
  const items = [...root.querySelectorAll(FOCUSABLE)].filter(el => el !== from && visible(el))
  if (!from || !root.contains(from)) return items[0]
  const a = from.getBoundingClientRect()
  const ca = center(a)
  let best = null
  let bestScore = Infinity
  for (const el of items) {
    const b = el.getBoundingClientRect()
    const cb = center(b)
    const dx = cb.x - ca.x
    const dy = cb.y - ca.y
    const along = dir[0] ? dx * dir[0] : dy * dir[1]
    if (along <= 2) continue
    const across = dir[0] ? Math.abs(dy) : Math.abs(dx)
    const overlap = dir[0] ? !(b.bottom < a.top || b.top > a.bottom) : !(b.right < a.left || b.left > a.right)
    const score = along + across * (overlap ? 0.3 : 2.5)
    if (score < bestScore) { bestScore = score; best = el }
  }
  return best
}

export function startSpatialNav() {
  window.addEventListener('keydown', e => {
    const dir = DIRS[e.key]
    if (!dir || e.altKey || e.ctrlKey || e.metaKey) return
    const cur = document.activeElement && document.activeElement !== document.body ? document.activeElement : null
    if (keepsArrow(cur, e.key)) return
    const target = next(cur, dir)
    if (!target) return
    e.preventDefault()
    target.focus({ preventScroll: true })
    target.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' })
    document.documentElement.classList.add('keynav')
  })
  window.addEventListener('pointerdown', () => document.documentElement.classList.remove('keynav'), { passive: true })
}
