import { createI18n } from 'vue-i18n'
import de from './locales/de.json'
import en from './locales/en.json'
import fr from './locales/fr.json'
import es from './locales/es.json'
import it from './locales/it.json'
import nl from './locales/nl.json'

export const LOCALE_NAMES = { de: 'Deutsch', en: 'English', fr: 'Français', es: 'Español', it: 'Italiano', nl: 'Nederlands' }

function initialLocale() {
  try {
    const saved = localStorage.getItem('homeos.locale')
    if (saved && LOCALE_NAMES[saved]) return saved
  } catch {}
  const nav = navigator.language?.slice(0, 2)
  return LOCALE_NAMES[nav] ? nav : 'de'
}

const long = { year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' }
const datetimeFormats = Object.fromEntries(Object.keys(LOCALE_NAMES).map(l => [l, { long }]))

export const i18n = createI18n({
  datetimeFormats,
  legacy: false,
  locale: initialLocale(),
  fallbackLocale: ['en', 'de'],
  messages: { de, en, fr, es, it, nl },
  missingWarn: false,
  fallbackWarn: false,
})

export function setLocale(l) {
  if (!LOCALE_NAMES[l]) return
  i18n.global.locale.value = l
  document.documentElement.lang = l
  try { localStorage.setItem('homeos.locale', l) } catch {}
}

export function errorText(e) {
  const t = i18n.global.t
  const key = `errors.${e?.code ?? 'internal'}`
  return i18n.global.te(key) ? t(key) : t('errors.generic', { code: e?.code ?? e?.message ?? '?' })
}
