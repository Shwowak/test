import { reactive } from 'vue'
import { api } from './api.js'

export const features = reactive({ automations: false, control: true, assistant: true, cameras: true, admin_timeout: 10, viewer: null, loaded: false })

export async function loadFeatures() {
  try {
    const s = await api('GET', '/settings')
    Object.assign(features, s.features ?? {}, { admin_timeout: s.admin_timeout ?? 10, viewer: s.autologin?.user_id ?? null, loaded: true })
  } catch {}
}
