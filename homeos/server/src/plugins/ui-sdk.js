;(function () {
  document.documentElement.style.colorScheme = 'dark'
  document.documentElement.style.background = 'transparent'
  var listeners = [], readyCbs = [], pending = {}, seq = 1, state = null
  function post(msg) { parent.postMessage(Object.assign({ sb: 1 }, msg), '*') }
  function applyTheme(t) {
    var r = document.documentElement
    for (var k in (t && t.vars) || {}) r.style.setProperty(k, t.vars[k])
    r.lang = state.lang
  }
  window.addEventListener('message', function (e) {
    if (e.source !== parent || !e.data || e.data.sb !== 1) return
    var m = e.data
    if (m.type === 'init') {
      state = { data: m.data || {}, config: m.config || {}, lang: m.lang || 'de', theme: m.theme || {}, widget: m.widget, editing: !!m.editing }
      applyTheme(state.theme)
      readyCbs.splice(0).forEach(function (cb) { cb(state) })
      listeners.forEach(function (cb) { cb(state.data, null) })
    } else if (m.type === 'data') {
      if (!state) return
      state.data[m.key] = m.value
      listeners.forEach(function (cb) { cb(state.data, m.key) })
    } else if (m.type === 'result') {
      var p = pending[m.id]
      if (!p) return
      delete pending[m.id]
      m.error ? p.reject(new Error(m.error)) : p.resolve(m.result)
    }
  })
  window.SmartBoard = {
    ready: function (cb) { state ? cb(state) : readyCbs.push(cb) },
    onData: function (cb) { listeners.push(cb); if (state) cb(state.data, null) },
    action: function (name, payload) {
      return new Promise(function (resolve, reject) {
        var id = seq++
        pending[id] = { resolve: resolve, reject: reject }
        post({ type: 'action', id: id, name: name, payload: payload })
        setTimeout(function () { if (pending[id]) { delete pending[id]; reject(new Error('timeout')) } }, 25000)
      })
    },
    t: function (v) { return v && typeof v === 'object' ? (v[state && state.lang] || v.en || v.de || Object.values(v)[0]) : v },
    get state() { return state },
  }
  post({ type: 'hello' })
})()
