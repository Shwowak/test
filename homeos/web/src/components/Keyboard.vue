<script setup>
import { ref, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'

const { locale } = useI18n()
const target = ref(null)
const shift = ref(false)
const symbols = ref(false)

const LAYOUTS = {
  de: [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0', 'ß'], ['q', 'w', 'e', 'r', 't', 'z', 'u', 'i', 'o', 'p', 'ü'], ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ö', 'ä'], ['y', 'x', 'c', 'v', 'b', 'n', 'm', '-', '.', '@']],
  en: [['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'], ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'], ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l'], ['z', 'x', 'c', 'v', 'b', 'n', 'm', '-', '.', '@']],
}
const SYMBOLS = [['!', '"', '§', '$', '%', '&', '/', '(', ')', '=', '?'], ['+', '*', '#', "'", '_', ':', ';', ',', '<', '>', '|'], ['[', ']', '{', '}', '\\', '~', '^', '°', '€', '`'], ['€', '£', '¥', '´', '²', '³', 'µ', '…']]
const rows = () => symbols.value ? SYMBOLS : LAYOUTS[locale.value] ?? LAYOUTS.en
const label = k => shift.value && k.length === 1 && k.toUpperCase().length === 1 ? k.toUpperCase() : k

watch(target, async el => {
  document.documentElement.classList.toggle('osk-open', !!el)
  if (!el) return
  await nextTick()
  el.scrollIntoView({ block: 'center', behavior: 'smooth' })
})

const TEXT_TYPES = ['text', 'password', 'search', 'email', 'url', 'tel', 'number', '']
let lastPointer = 0
let hardKeys = false
function onFocus(e) {
  const el = e.target
  if (hardKeys || Date.now() - lastPointer > 800) return
  if ((el.tagName === 'INPUT' && TEXT_TYPES.includes(el.type)) || el.tagName === 'TEXTAREA') target.value = el
}
function onHardKey(e) {
  if (!e.isTrusted || ['Unidentified', 'Process'].includes(e.key)) return
  hardKeys = true
  target.value = null
}
function onDown(e) {
  lastPointer = Date.now()
  if (!target.value) return
  if (e.target.closest('.osk') || e.target === target.value) return
  if (e.target.matches?.('input, textarea')) return
  target.value = null
}

function insert(text) {
  const el = target.value
  if (!el) return
  el.focus()
  if (el.type === 'number' || el.type === 'email') {
    el.value = el.value + text
  } else {
    const s = el.selectionStart ?? el.value.length
    el.setRangeText(text, s, el.selectionEnd ?? s, 'end')
  }
  el.dispatchEvent(new Event('input', { bubbles: true }))
  if (shift.value) shift.value = false
}
function backspace() {
  const el = target.value
  if (!el) return
  el.focus()
  if (el.type === 'number' || el.type === 'email') el.value = el.value.slice(0, -1)
  else {
    const s = el.selectionStart ?? el.value.length
    const e = el.selectionEnd ?? s
    if (s === e && s > 0) el.setRangeText('', s - 1, s, 'end')
    else el.setRangeText('', s, e, 'end')
  }
  el.dispatchEvent(new Event('input', { bubbles: true }))
}
function enter() {
  const el = target.value
  if (!el) return
  if (el.tagName === 'TEXTAREA') return insert('\n')
  const form = el.form
  const fields = form ? [...form.querySelectorAll('input, textarea')].filter(x => !x.disabled && x.type !== 'hidden' && x.type !== 'checkbox' && x.offsetParent) : []
  const next = fields[fields.indexOf(el) + 1]
  if (next) { next.focus(); return }
  target.value = null
  el.blur()
  form?.requestSubmit()
}

onMounted(() => {
  document.addEventListener('focusin', onFocus)
  document.addEventListener('pointerdown', onDown, true)
  document.addEventListener('keydown', onHardKey, true)
})
onBeforeUnmount(() => {
  document.removeEventListener('focusin', onFocus)
  document.removeEventListener('pointerdown', onDown, true)
  document.removeEventListener('keydown', onHardKey, true)
  document.documentElement.classList.remove('osk-open')
})
</script>

<template>
  <div v-if="target" class="osk" @pointerdown.prevent>
    <div v-for="(row, i) in rows()" :key="i" class="r">
      <button v-if="i === 3" class="k wide" :class="{ on: shift }" @click="shift = !shift">⇧</button>
      <button v-for="k in row" :key="k" class="k" @click="insert(label(k))">{{ label(k) }}</button>
      <button v-if="i === 0" class="k wide" @click="backspace">⌫</button>
    </div>
    <div class="r">
      <button class="k wide" :class="{ on: symbols }" @click="symbols = !symbols">{{ symbols ? 'abc' : '#+=' }}</button>
      <button class="k space" @click="insert(' ')">␣</button>
      <button class="k wide" @click="target = null">⌄</button>
      <button class="k wide ok" @click="enter">⏎</button>
    </div>
  </div>
</template>

<style scoped>
.osk { position: fixed; left: 0; right: 0; bottom: 0; z-index: 4000; padding: 10px 8px 14px; background: rgba(2, 6, 23, .97); border-top: 1px solid var(--line-strong); box-shadow: 0 -20px 60px rgba(0, 0, 0, .6); display: flex; flex-direction: column; gap: 8px; user-select: none; }
.r { display: flex; gap: 6px; justify-content: center; }
.k { flex: 1; max-width: 86px; min-height: 58px; font-size: 22px; color: var(--text); background: rgba(148, 163, 184, .1); border: 1px solid var(--line); border-radius: 8px; touch-action: manipulation; }
.k:active { background: rgba(34, 211, 238, .3); }
.k.wide { max-width: 120px; flex: 1.4; }
.k.space { flex: 5; max-width: 480px; }
.k.on { color: var(--cyan); border-color: var(--cyan); }
.k.ok { background: rgba(34, 211, 238, .2); border-color: var(--cyan); }
</style>
