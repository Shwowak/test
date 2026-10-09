import { createApp } from 'vue'
import 'gridstack/dist/gridstack.min.css'
import './style.css'
import App from './App.vue'
import { i18n } from './i18n.js'
import { startSpatialNav } from './spatial.js'

let theme = 'apple'
try { theme = localStorage.getItem('homeos_theme') || 'apple' } catch {}
document.documentElement.classList.toggle('theme-apple', theme !== 'neon')
document.documentElement.lang = i18n.global.locale.value
createApp(App).use(i18n).mount('#app')
startSpatialNav()
