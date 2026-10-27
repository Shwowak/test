<script setup>
import { useI18n } from 'vue-i18n'

defineProps({ data: Object })
const { t, locale } = useI18n()

const when = s => {
  if (!s) return ''
  const d = new Date(s)
  return d.toDateString() === new Date().toDateString()
    ? d.toLocaleTimeString(locale.value, { hour: '2-digit', minute: '2-digit' })
    : d.toLocaleDateString(locale.value, { day: '2-digit', month: '2-digit' })
}
</script>

<template>
  <div class="mail">
    <div class="head"><span class="n">{{ data?.unread ?? '–' }}</span><span class="l">{{ t('mail.unread') }}</span></div>
    <ul>
      <li v-for="m in data?.messages ?? []" :key="m.seq" :class="{ new: m.unread }">
        <div class="top"><span class="fr">{{ m.from }}</span><span class="t">{{ when(m.date) }}</span></div>
        <div class="su">{{ m.subject || '—' }}</div>
      </li>
      <li v-if="data && !data.messages?.length" class="none">{{ t('mail.none') }}</li>
    </ul>
  </div>
</template>

<style scoped>
.mail { height: 100%; display: flex; flex-direction: column; }
.head { display: flex; align-items: baseline; gap: 8px; margin-bottom: 6px; }
.n { font-size: 34px; font-weight: 600; color: var(--cyan); }
.l { color: var(--dim); font-size: 14px; }
ul { list-style: none; margin: 0; padding: 0; overflow-y: auto; flex: 1; }
li { padding: 8px 0; border-bottom: 1px solid rgba(148, 163, 184, 0.08); }
.top { display: flex; justify-content: space-between; gap: 10px; }
.fr { font-size: 15px; color: var(--dim); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.new .fr { color: var(--text); font-weight: 600; }
.t { color: var(--dim); font-family: var(--mono); font-size: 13px; flex: none; }
.su { font-size: 16px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.new .su::before { content: '● '; color: var(--cyan); }
.none { color: var(--dim); border: 0; }
</style>
