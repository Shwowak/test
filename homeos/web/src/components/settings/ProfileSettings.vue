<script setup>
import { ref, inject } from 'vue'
import { useI18n } from 'vue-i18n'
import { api } from '../../api.js'
import { errorText, LOCALE_NAMES } from '../../i18n.js'

defineProps({ meta: Object })
const { t } = useI18n()
const user = inject('user')
const setUser = inject('setUser')

const form = ref({ display_name: user.value.display_name, locale: user.value.locale })
const pw = ref({ current_password: '', new_password: '' })
const pin = ref('')
const msg = ref('')
const error = ref('')

async function run(body, reset) {
  msg.value = ''
  error.value = ''
  try {
    setUser(await api('PUT', '/auth/me', body))
    reset?.()
    msg.value = t('common.saved')
  } catch (e) {
    error.value = errorText(e)
  }
}
</script>

<template>
  <div class="grid">
    <form @submit.prevent="run(form)">
      <h3>{{ t('profile.title') }}</h3>
      <div class="field"><label>{{ t('users.display_name') }}</label><input v-model="form.display_name" maxlength="80"></div>
      <div class="field">
        <label>{{ t('settings.language') }}</label>
        <select v-model="form.locale">
          <option v-for="l in meta.locales" :key="l" :value="l">{{ LOCALE_NAMES[l] }}</option>
        </select>
      </div>
      <p class="label">{{ t('users.role') }}: {{ t('roles.' + user.role) }}</p>
      <button class="btn primary">{{ t('common.save') }}</button>
    </form>

    <form @submit.prevent="run(pw, () => (pw = { current_password: '', new_password: '' }))">
      <h3>{{ t('profile.password') }}</h3>
      <div class="field"><label>{{ t('profile.current_password') }}</label><input v-model="pw.current_password" type="password" autocomplete="current-password" required></div>
      <div class="field"><label>{{ t('profile.new_password') }}</label><input v-model="pw.new_password" type="password" autocomplete="new-password" minlength="8" required></div>
      <button class="btn primary">{{ t('profile.change_password') }}</button>
    </form>

    <form @submit.prevent="run({ pin }, () => (pin = ''))">
      <h3>{{ t('profile.pin') }}</h3>
      <p class="hint">{{ user.has_pin ? t('profile.pin_set') : t('profile.pin_none') }}</p>
      <div class="field"><label>{{ t('profile.new_pin') }}</label><input v-model="pin" inputmode="numeric" pattern="\d{4,8}" maxlength="8" autocomplete="off" required></div>
      <div class="row">
        <button class="btn primary">{{ t('common.save') }}</button>
        <button v-if="user.has_pin" type="button" class="btn danger" @click="run({ pin: null })">{{ t('profile.remove_pin') }}</button>
      </div>
    </form>
  </div>
  <p v-if="msg" class="ok">{{ msg }}</p>
  <p v-if="error" class="error">{{ error }}</p>
</template>

<style scoped>
.grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 28px; }
h3 { margin: 0 0 14px; font-weight: 400; font-size: 18px; }
.hint { color: var(--dim); }
.row { display: flex; gap: 10px; }
.ok { color: #86efac; }
</style>
