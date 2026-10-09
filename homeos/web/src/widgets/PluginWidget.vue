<script setup>
import { ref, computed, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../api.js'
import { plugins, loadPlugins, subscribeData } from '../plugins.js'

const props = defineProps({ widget: Object, editing: Boolean })
const { t, locale } = useI18n()
const frame = ref(null)
const ref_ = computed(() => String(props.widget.config.plugin_widget ?? '').split('/'))
const plugin = computed(() => plugins.list.find(p => p.id === ref_.value[0]))
const def = computed(() => plugin.value?.manifest.widgets?.find(w => w.id === ref_.value[1]))
const src = computed(() => plugin.value?.enabled && def.value ? `/api/v1/plugins/${encodeURIComponent(plugin.value.id)}/ui/${def.value.ui}` : null)
let data = {}
let unsub = null

function theme() {
  const cs = getComputedStyle(document.documentElement)
  const vars = {}
  for (const k of ['--text', '--dim', '--cyan', '--violet', '--magenta', '--gold', '--ok', '--warn', '--err', '--font', '--line']) vars[k] = cs.getPropertyValue(k).trim()
  return { vars }
}
const send = msg => frame.value?.contentWindow?.postMessage({ sb: 1, ...msg }, '*')

async function onMessage(e) {
  if (!frame.value || e.source !== frame.value.contentWindow || e.data?.sb !== 1) return
  const m = e.data
  if (m.type === 'hello') {
    try { data = await api('GET', `/plugins/${encodeURIComponent(plugin.value.id)}/data`) } catch { data = {} }
    send({ type: 'init', data, lang: locale.value, theme: theme(), widget: { id: props.widget.id, plugin_widget: props.widget.config.plugin_widget }, editing: props.editing })
  } else if (m.type === 'action' && !props.editing) {
    try {
      const r = await api('POST', `/plugins/${encodeURIComponent(plugin.value.id)}/actions/${encodeURIComponent(String(m.name))}`, m.payload ?? {})
      send({ type: 'result', id: m.id, result: r.result })
    } catch (err) {
      send({ type: 'result', id: m.id, error: err.details?.message ?? err.message })
    }
  }
}

onMounted(async () => {
  if (!plugins.loaded) await loadPlugins().catch(() => {})
  window.addEventListener('message', onMessage)
  unsub = subscribeData(ref_.value[0], (key, value) => send({ type: 'data', key, value }))
})
onBeforeUnmount(() => { window.removeEventListener('message', onMessage); unsub?.() })
</script>

<template>
  <iframe v-if="src" ref="frame" :src="src" sandbox="allow-scripts" :style="{ pointerEvents: editing ? 'none' : 'auto' }" referrerpolicy="no-referrer" />
  <p v-else class="label">{{ plugin && !plugin.enabled ? t('plugins.disabled') : t('plugins.widget_missing') }}</p>
</template>

<style scoped>
iframe { position: absolute; inset: 0; width: 100%; height: 100%; border: 0; background: transparent; color-scheme: dark; }
</style>
