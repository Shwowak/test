import { reactive } from 'vue'
import { api } from './api.js'

export const features = reactive({ automations: false, control: true, assistant: true, cameras: true, fx: 'particles', admin_timeout: 10, viewer: null, loaded: false })

export function applyTheme(theme) {
  const t = theme === 'neon' ? 'neon' : 'apple'
  document.documentElement.classList.toggle('theme-apple', t === 'apple')
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'apple' ? '#000000' : '#05070d')
  try { localStorage.setItem('homeos_theme', t) } catch {}
}

export async function loadFeatures() {
  try {
    const s = await api('GET', '/settings')
    Object.assign(features, s.features ?? {}, { fx: s.fx ?? 'particles', admin_timeout: s.admin_timeout ?? 10, viewer: s.autologin?.user_id ?? null, loaded: true })
    applyTheme(s.theme)
  } catch {}
}
