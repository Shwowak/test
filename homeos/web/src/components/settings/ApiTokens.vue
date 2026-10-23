<script setup>
import { ref, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.js'
import { errorText } from '../../i18n.js'

const props = defineProps({ users: Array })
const { t } = useI18n()
const tokens = ref([])
const name = ref('')
const userId = ref(null)
const fresh = ref('')
const error = ref('')

async function load() { tokens.value = await api('GET', '/auth/tokens') }
onMounted(load)

async function create() {
  error.value = ''
  try {
    fresh.value = (await api('POST', '/auth/tokens', { name: name.value, user_id: userId.value ?? props.users[0]?.id })).token
    name.value = ''
    await load()
  } catch (e) { error.value = errorText(e) }
}

async function remove(id) {
  if (!confirm(t('tokens.confirm_delete'))) return
  await api('DELETE', `/auth/tokens/${id}`)
  await load()
}

const when = ts => (ts ? new Date(ts).toLocaleString() : t('tokens.never'))
</script>

<template>
  <section class="tokens">
    <h3>{{ t('tokens.title') }}</h3>
    <p class="dim">{{ t('tokens.hint') }}</p>
    <div v-for="k in tokens" :key="k.id" class="tok">
      <span><b>{{ k.name }}</b> <span class="dim">{{'@'}}{{ k.user_name }} · {{ t('tokens.last_used') }}: {{ when(k.last_used) }}</span></span>
      <button class="btn danger" @click="remove(k.id)">{{ t('common.delete') }}</button>
    </div>
    <p v-if="!tokens.length" class="dim">{{ t('tokens.none') }}</p>
    <div v-if="fresh" class="fresh"><code>{{ fresh }}</code><small>{{ t('tokens.copy') }}</small></div>
    <form class="row" @submit.prevent="create">
      <input v-model="name" :placeholder="t('tokens.name')" maxlength="60" required>
      <select v-model="userId" :title="t('tokens.user')">
        <option v-for="u in props.users" :key="u.id" :value="u.id">{{ u.display_name }} ({{ t('roles.' + u.role) }})</option>
      </select>
      <button class="btn primary">{{ t('tokens.create') }}</button>
    </form>
    <p v-if="error" class="error">{{ error }}</p>
  </section>
</template>

<style scoped>
.tokens { margin-top: 32px; }
.dim { color: var(--dim); font-size: 14px; }
.tok { display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-top: 1px solid var(--line); }
.fresh { display: flex; flex-direction: column; gap: 4px; margin: 12px 0; }
.fresh code { user-select: all; word-break: break-all; font-size: 15px; }
.row { display: flex; gap: 12px; flex-wrap: wrap; margin-top: 12px; }
</style>
