<script setup>
defineProps({ title: String, wide: Boolean })
import { useI18n } from 'vue-i18n'
const { t } = useI18n()
const emit = defineEmits(['close'])
</script>

<template>
  <div class="backdrop" @click.self="emit('close')">
    <div class="sheet" :class="{ wide }" role="dialog" :aria-label="title">
      <header>
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
@keyframes slide { from { transform: translateX(40px); opacity: 0; } }
@media (max-width: 700px) { .backdrop { align-items: flex-end; } .sheet { height: 88%; border-left: 0; border-top: 1px solid var(--line-strong); border-radius: 20px 20px 0 0; } }
</style>
