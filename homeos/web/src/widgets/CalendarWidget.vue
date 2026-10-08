<script setup>
import { useI18n } from 'vue-i18n'

defineProps({ data: Object })
const { t, locale } = useI18n()

const day = s => {
  const d = new Date(s)
  const today = new Date()
  const tomorrow = new Date(Date.now() + 864e5)
  if (d.toDateString() === today.toDateString()) return t('calendar.today')
  if (d.toDateString() === tomorrow.toDateString()) return t('calendar.tomorrow')
  return d.toLocaleDateString(locale.value, { weekday: 'short', day: '2-digit', month: '2-digit' })
}
const time = e => e.allDay ? t('calendar.all_day') : new Date(e.start).toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
</script>

<template>
  <ul class="cal">
    <li v-for="(e, i) in data?.events ?? []" :key="i">
      <div class="when"><span class="d">{{ day(e.start) }}</span><span class="t">{{ time(e) }}</span></div>
      <div class="what"><div class="ti">{{ e.title }}</div><div v-if="e.location" class="lo">{{ e.location }}</div></div>
    </li>
    <li v-if="data && !data.events?.length" class="none">{{ t('calendar.none') }}</li>
  </ul>
</template>

<style scoped>
.cal { list-style: none; margin: 0; padding: 0; height: 100%; overflow-y: auto; }
li { display: flex; gap: 14px; padding: 10px 0; border-bottom: 1px solid rgba(148, 163, 184, 0.08); }
.when { width: 92px; flex: none; display: flex; flex-direction: column; }
.d { color: var(--cyan); font-size: 15px; }
.t { color: var(--dim); font-family: var(--mono); font-size: 14px; }
.ti { font-size: 18px; }
.lo { color: var(--dim); font-size: 14px; }
.none { color: var(--dim); border: 0; }
</style>
