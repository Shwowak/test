import { createApp } from 'vue'
import 'gridstack/dist/gridstack.min.css'
import './style.css'
import App from './App.vue'
import { i18n } from './i18n.js'
import { startSpatialNav } from './spatial.js'

document.documentElement.lang = i18n.global.locale.value
createApp(App).use(i18n).mount('#app')
startSpatialNav()
