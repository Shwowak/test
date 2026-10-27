<script setup>
defineProps({ title: String, wide: Boolean, window: Boolean })
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
const emit = defineEmits(['close'])
import { onMounted, onBeforeUnmount } from 'vue'
const stack = window.__sheets ??= []
const me = Symbol()
function onKey(e) {
  if (e.key !== 'Escape' || stack.at(-1) !== me) return
  e.preventDefault()
  e.stopPropagation()
  emit('close')
}
onMounted(() => { stack.push(me); window.addEventListener('keydown', onKey, true) })
onBeforeUnmount(() => { stack.splice(stack.indexOf(me), 1); window.removeEventListener('keydown', onKey, true) })
</script>

<template>
  <div class="backdrop" :class="{ center: window }" @click.self="emit('close')">
    <div class="sheet" :class="{ wide, win: window }" role="dialog" :aria-label="title">
      <button v-if="window" class="x" :aria-label="t('common.close')" @click="emit('close')">✕</button>
      <header v-else>
        <h2>{{ title }}</h2>
        <button class="btn icon" :aria-label="t('common.close')" @click="emit('close')">✕</button>
      </header>
      <div class="body"><slot /></div>
    </div>
  </div>
</template>

<style scoped>
.backdrop { position: fixed; inset: 0; z-index: 1000; background: rgba(0, 0, 0, 0.55); backdrop-filter: blur(4px); display: flex; justify-content: flex-end; }
.sheet {
  width: min(560px, 100%); height: 100%; display: flex; flex-direction: column;
  background: var(--glass-strong); border-left: 1px solid var(--line-strong); box-shadow: -20px 0 60px rgba(0, 0, 0, 0.5);
  animation: slide 0.22s ease-out;
}
header { display: flex; align-items: center; justify-content: space-between; padding: 18px 20px; border-bottom: 1px solid var(--line); }
h2 { margin: 0; font-size: 24px; font-weight: 400; }
.sheet.wide { width: min(980px, 100%); }
.body { flex: 1; overflow-y: auto; padding: 20px; user-select: text; }
.backdrop.center { justify-content: center; align-items: center; }
.sheet.win { width: min(1180px, 96vw); height: min(820px, 92vh); backdrop-filter: blur(40px) saturate(180%); -webkit-backdrop-filter: blur(40px) saturate(180%); border: 0; border-radius: 18px; overflow: hidden; position: relative; box-shadow: 0 30px 90px rgba(0, 0, 0, 0.6), 0 0 0 1px rgba(255, 255, 255, 0.08); animation: pop 0.22s ease-out; }
.sheet.win .body { padding: 0; overflow: hidden; display: flex; }
.x { position: absolute; top: 14px; right: 14px; z-index: 5; width: 30px; height: 30px; border-radius: 50%; border: 0; background: rgba(118, 118, 128, 0.24); color: var(--text); font-size: 13px; cursor: pointer; }
.x:hover { background: rgba(118, 118, 128, 0.4); }
@keyframes pop { from { transform: scale(0.97); opacity: 0; } }
@keyframes slide { from { transform: translateX(40px); opacity: 0; } }
@media (max-width: 700px) { .sheet.win { width: 100%; height: 100%; border-radius: 0; background: var(--bg); } .backdrop:not(.center) { align-items: flex-end; } .sheet:not(.win) { height: 88%; border-left: 0; border-top: 1px solid var(--line-strong); border-radius: 20px 20px 0 0; } }
</style>
