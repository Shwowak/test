import { reactive } from 'vue'
import { api } from './api.js'
import { listeners } from './devices.js'

export const cams = reactive({ list: [], enabled: false, go2rtc: null, loaded: false })

export async function loadCameras() {
  const r = await api('GET', '/cameras')
  Object.assign(cams, { list: r.cameras, enabled: r.enabled, go2rtc: r.go2rtc, loaded: true })
}

listeners.add((type, p) => {
  if (type === 'config.changed' && ['camera', 'settings'].includes(p.entity)) loadCameras().catch(() => {})
})
