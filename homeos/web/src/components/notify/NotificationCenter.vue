<script setup>
import { inject, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { notes, unread, ack, loadNotifications } from '../../notifications.js'

const { t, d } = useI18n()
const user = inject('user')
const canAck = () => user.value?.permissions?.includes('notifications.manage')
const icon = { info: 'ℹ', warning: '⚠', critical: '⛔', emergency: '🚨' }
onMounted(() => loadNotifications().catch(() => {}))
</script>

<template>
  <div class="nc">
    <div class="bar">
      <span>{{ t('notifications.unread', unread) }}</span>
      <button v-if="canAck() && unread" class="btn" @click="ack('all')">✓ {{ t('notifications.ack_all') }}</button>
    </div>
    <p v-if="!notes.list.length" class="empty">{{ t('notifications.empty') }}</p>
    <div v-for="n in notes.list" :key="n.id" class="item" :class="[n.level, { done: n.acknowledged_at }]">
      <span class="ic">{{ icon[n.level] }}</span>
      <div class="txt">
        <b>{{ n.title }}</b>
        <p v-if="n.message">{{ n.message }}</p>
        <small>{{ d(new Date(n.ts), 'long') }} · {{ n.source }}</small>
      </div>
      <button v-if="canAck() && !n.acknowledged_at" class="btn icon" :aria-label="t('notifications.acknowledge')" @click="ack([n.id])">✓</button>
    </div>
  </div>
</template>

<style scoped>
.bar { display: flex; justify-content: space-between; align-items: center; margin-bottom: 14px; color: var(--dim); }
.item { display: flex; gap: 14px; align-items: center; padding: 14px 4px; border-bottom: 1px solid var(--line); border-left: 3px solid var(--cyan); padding-left: 12px; }
.item.warning { border-left-color: #f59e0b; }
.item.critical, .item.emergency { border-left-color: #ef4444; }
.item.done { opacity: .5; }
.ic { font-size: 22px; }
.txt { flex: 1; min-width: 0; }
.txt p { margin: 4px 0; }
.txt small { color: var(--dim); }
.empty { color: var(--dim); }
</style>
