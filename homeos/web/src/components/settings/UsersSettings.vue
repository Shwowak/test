<script setup>
import { ref, onMounted, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.js'
import { errorText, LOCALE_NAMES } from '../../i18n.js'

const props = defineProps({ meta: Object })
const { t } = useI18n()
const me = inject('user')
const users = ref([])
const form = ref(null)
const error = ref('')

async function load() {
  users.value = await api('GET', '/users')
}
onMounted(load)

function create() {
  form.value = { name: '', display_name: '', role: 'user', locale: 'de', password: '', pin: '' }
}
function edit(u) {
  form.value = { ...u, password: '', pin: '' }
}

async function save() {
  error.value = ''
  const f = form.value
  const body = { display_name: f.display_name || undefined, role: f.role, locale: f.locale, disabled: f.disabled }
  if (f.password) body.password = f.password
  if (f.pin) body.pin = f.pin
  try {
    if (f.id) await api('PUT', `/users/${f.id}`, body)
    else await api('POST', '/users', { ...body, name: f.name })
    form.value = null
    await load()
  } catch (e) {
    error.value = errorText(e)
  }
}

async function remove() {
  if (!confirm(t('users.confirm_delete', { name: form.value.name }))) return
  try {
    await api('DELETE', `/users/${form.value.id}`)
    form.value = null
    await load()
  } catch (e) {
    error.value = errorText(e)
  }
}
</script>

<template>
  <div v-if="!form">
    <table class="tbl">
      <thead><tr><th>{{ t('users.name') }}</th><th>{{ t('users.role') }}</th><th>{{ t('profile.pin') }}</th><th>{{ t('users.status') }}</th></tr></thead>
      <tbody>
        <tr v-for="u in users" :key="u.id" @click="edit(u)">
          <td>{{ u.display_name }} <span class="dim">@{{ u.name }}</span></td>
          <td>{{ t('roles.' + u.role) }}</td>
          <td>{{ u.has_pin ? '✓' : '—' }}</td>
          <td :class="u.disabled ? 'off' : 'on'">{{ u.disabled ? t('users.disabled') : t('users.active') }}</td>
        </tr>
      </tbody>
    </table>
    <button class="btn primary add" @click="create">＋ {{ t('users.new') }}</button>
  </div>

  <form v-else @submit.prevent="save">
    <div class="cols">
      <div class="field"><label>{{ t('users.name') }}</label><input v-model="form.name" :disabled="!!form.id" pattern="[a-zA-Z0-9._\-]{2,32}" required autocomplete="off"></div>
      <div class="field"><label>{{ t('users.display_name') }}</label><input v-model="form.display_name" maxlength="80"></div>
      <div class="field">
        <label>{{ t('users.role') }}</label>
        <select v-model="form.role">
          <option v-for="r in props.meta.roles" :key="r" :value="r">{{ t('roles.' + r) }}</option>
        </select>
        <small class="dim">{{ t('roles_desc.' + form.role) }}</small>
      </div>
      <div class="field">
        <label>{{ t('settings.language') }}</label>
        <select v-model="form.locale"><option v-for="l in props.meta.locales" :key="l" :value="l">{{ LOCALE_NAMES[l] }}</option></select>
      </div>
      <div class="field">
        <label>{{ form.id ? t('users.reset_password') : t('login.password') }}</label>
        <input v-model="form.password" type="password" minlength="8" :required="!form.id" autocomplete="new-password">
      </div>
      <div class="field"><label>{{ t('profile.new_pin') }}</label><input v-model="form.pin" inputmode="numeric" pattern="\d{4,8}" maxlength="8" autocomplete="off"></div>
    </div>
    <label v-if="form.id && form.id !== me.id" class="check"><input v-model="form.disabled" type="checkbox"> {{ t('users.disabled') }}</label>
    <p v-if="error" class="error">{{ error }}</p>
    <div class="row">
      <button type="button" class="btn" @click="form = null; error = ''">{{ t('common.back') }}</button>
      <button v-if="form.id && form.id !== me.id" type="button" class="btn danger" @click="remove">{{ t('common.delete') }}</button>
      <span class="grow" />
      <button class="btn primary">{{ t('common.save') }}</button>
    </div>
  </form>
</template>

<style scoped>
.tbl { width: 100%; border-collapse: collapse; }
.tbl th { text-align: left; font-size: 12px; letter-spacing: 0.1em; text-transform: uppercase; color: var(--dim); font-weight: 400; padding: 8px; }
.tbl td { padding: 16px 8px; border-top: 1px solid var(--line); font-size: 17px; }
.tbl tbody tr { cursor: pointer; }
.tbl tbody tr:active { background: rgba(34, 211, 238, 0.06); }
.dim { color: var(--dim); font-size: 14px; }
.on { color: #86efac; }
.off { color: #fda4af; }
.add { margin-top: 16px; }
.cols { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 0 20px; }
.check { display: flex; align-items: center; gap: 10px; min-height: 48px; font-size: 17px; }
.check input { width: 24px; height: 24px; }
.row { display: flex; gap: 12px; }
.grow { flex: 1; }
</style>
