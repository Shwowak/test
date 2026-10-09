import { readFileSync, writeFileSync, statfsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { requirePerm, HttpError } from '../core/http.js'
import { log } from '../core/logger.js'
import { getSetting, setSetting, isLocalIp } from '../core/settings.js'
import { run, has, canIsolateNetwork } from '../system/exec.js'
import { displayStatus, setBrightness, setPower, setOutput } from '../system/display.js'
import { networkStatus, wifiScan, wifiConnect, wifiRadio, forget, setHostname } from '../system/network.js'
import * as bt from '../system/bluetooth.js'
import { btAuto } from '../system/btauto.js'
import { health, applyFix, diagnosticBundle, sample, analyse } from '../system/health.js'
import { setupInfo, setupAllowed, setupNeeded, online, stopHotspot, startHotspot } from '../system/setupnet.js'
import { audioStatus, setVolume, setMute, setDefault } from '../system/audio.js'

const DATA = dirname(resolve(process.env.HOMEOS_DB ?? './data/homeos.db'))
const UPDATE_STATE = resolve(process.env.SMARTBOARD_UPDATE_STATE ?? `${DATA}/update.json`)
const UPDATE_SETTINGS = resolve(`${DATA}/update-settings.json`)
export const isDevice = () => process.env.SMARTBOARD_HAL === '1'

const wrap = (category, fn) => async req => {
  if (!isDevice()) throw new HttpError(409, 'hardware.unavailable')
  try {
    const r = await fn(req)
    return r ?? { ok: true }
  } catch (e) {
    if (e instanceof HttpError) throw e
    log(category, 'error', 'hardware.failed', { error: e.message }, req.user?.id)
    throw new HttpError(422, 'hardware.failed', { message: e.message })
  }
}

const body = (props, required = []) => ({ body: { type: 'object', required, properties: props } })

export default async function hardwareModule(app) {
  const s = (summary, extra = {}) => ({ tags: ['hardware'], summary, ...extra })
  const manage = requirePerm('system.manage')

  const localOnly = async req => {
    if (!isDevice()) throw new HttpError(409, 'hardware.unavailable')
    if (!isLocalIp(req.ip)) throw new HttpError(403, 'setup.local_only')
  }
  const INPUT = d => /^input-/.test(d.icon ?? '') || /keyboard|tastatur|mouse|maus|trackpad|keys|mx /i.test(d.name ?? '')
  const inputView = st => ({ available: !!st.available, powered: st.powered, auto: { active: btAuto.active, searching: btAuto.searching, paired: btAuto.paired, last: btAuto.last }, devices: (st.devices ?? []).map(d => ({ ...d, input: INPUT(d) })).sort((a, b) => b.input - a.input) })
  const pub = summary => ({ schema: s(summary), config: { public: true }, preHandler: localOnly })

  const setupGuard = async req => {
    if (!isDevice()) throw new HttpError(409, 'hardware.unavailable')
    if (!setupNeeded()) throw new HttpError(409, 'setup.done')
    if (!setupAllowed(req)) throw new HttpError(403, 'setup.code_required')
  }
  const sp = summary => ({ schema: s(summary), config: { public: true }, preHandler: setupGuard })

  app.get('/setup/info', { schema: s('First-run info: setup code, addresses, hotspot (display only)'), config: { public: true } }, async req => {
    if (!isDevice()) return { device: false, needed: setupNeeded() }
    const info = setupInfo()
    if (!isLocalIp(req.ip)) { delete info.code; delete info.hotspot }
    return { device: true, online: await online(), ...info }
  })
  app.get('/setup/network', sp('Network status during first-run setup'), wrap('network', async () => ({ online: await online(), ...(await networkStatus()) })))
  app.get('/setup/network/wifi', sp('Scan WiFi during first-run setup'), wrap('network', () => wifiScan()))
  app.post('/setup/network/wifi', { ...sp('Connect WiFi during first-run setup'), schema: s('Connect WiFi during first-run setup', body({ ssid: { type: 'string', maxLength: 64 }, password: { type: 'string', maxLength: 128 }, hidden: { type: 'boolean' }, code: { type: 'string' } }, ['ssid'])) },
    wrap('network', async req => {
      await stopHotspot()
      try {
        await wifiConnect(req.body.ssid, req.body.password, req.body.hidden)
      } catch (e) {
        startHotspot().catch(() => {})
        throw e
      }
      log('network', 'info', 'wifi.connected', { ssid: req.body.ssid, setup: true })
      return { online: await online(), ...setupInfo(), code: undefined }
    }))

  app.get('/setup/bluetooth', pub('Bluetooth input devices (only on the device display, no login)'), wrap('bluetooth', async () => inputView(btAuto.status && Date.now() - btAuto.statusAt < 15000 ? btAuto.status : await bt.bluetoothStatus())))
  app.post('/setup/bluetooth/scan', pub('Scan for keyboards/mice (only on the device display, no login)'), wrap('bluetooth', async () => {
    await bt.power(true).catch(() => {})
    return inputView(await bt.scan(10))
  }))
  app.post('/setup/bluetooth/pair', { ...pub('Pair keyboard/mouse (only on the device display, no login)'), schema: s('Pair keyboard/mouse', body({ address: { type: 'string' } }, ['address'])) },
    wrap('bluetooth', async req => { await bt.pair(req.body.address); log('bluetooth', 'info', 'bluetooth.pair', { address: req.body.address, setup: true }); return inputView(await bt.bluetoothStatus()) }))

  app.get('/system/health', { schema: s('Health monitor: metrics, findings, automatic fixes'), preHandler: requirePerm('system.view') }, async () => {
    if (!health.samples.length) analyse(await sample())
    return { current: health.samples.at(-1), findings: health.findings, fixes: health.fixes, slow: health.slow.slice(-20), history: health.samples.slice(-120).map(x => ({ ts: x.ts, loop: x.loop_p99_ms, load: x.load, mem: 1 - x.mem.free / x.mem.total, temp: x.temp })), autofix: getSetting('health')?.autofix !== false }
  })
  app.put('/system/health', { schema: s('Health settings', body({ autofix: { type: 'boolean' } })), preHandler: requirePerm('system.manage') }, async req => {
    setSetting('health', { ...getSetting('health'), autofix: req.body.autofix })
    return { ok: true }
  })
  app.post('/system/health/fix', { schema: s('Run a fix now', body({ fix: { type: 'string', enum: ['restart_kiosk', 'restart_plugins', 'cleanup'] } }, ['fix'])), preHandler: requirePerm('system.manage') },
    async req => {
      try { return { result: await applyFix(req.body.fix, req.user.name) } } catch (e) { throw new HttpError(422, 'hardware.failed', { message: e.message }) }
    })
  app.get('/system/diagnostics', { schema: s('Download diagnostic bundle (JSON)'), preHandler: requirePerm('system.manage') }, async (req, reply) => {
    reply.header('content-disposition', `attachment; filename="smartboard-diagnose-${new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')}.json"`)
    return diagnosticBundle()
  })

  app.get('/hardware', { schema: s('Hardware capabilities of this device'), preHandler: requirePerm('system.view') }, async () => {
    let storage = null
    try { const f = statfsSync(DATA); storage = { total: f.blocks * f.bsize, free: f.bavail * f.bsize } } catch {}
    let temp = null
    try { temp = Number(readFileSync('/sys/class/thermal/thermal_zone0/temp', 'utf8')) / 1000 } catch {}
    return {
      device: isDevice(), storage, temperature: temp, pluginNetworkIsolation: canIsolateNetwork(),
      tools: Object.fromEntries(['nmcli', 'bluetoothctl', 'wpctl', 'wlr-randr', 'ddcutil', 'systemctl'].map(c => [c, has(c)])),
      display: getSetting('display') ?? { idle: 0, dim: 0, night: null },
    }
  })

  app.put('/hardware/display/settings', {
    schema: s('Idle / night settings', body({ idle: { type: 'integer', minimum: 0, maximum: 1440 }, dim: { type: 'integer', minimum: 0, maximum: 100 }, night: { type: ['object', 'null'] } })),
    preHandler: manage,
  }, async req => {
    const cur = getSetting('display') ?? {}
    setSetting('display', { ...cur, ...req.body })
    return getSetting('display')
  })

  app.get('/hardware/display', { schema: s('Panels and outputs'), preHandler: requirePerm('system.view') }, wrap('system', () => displayStatus()))
  app.post('/hardware/display/brightness', { schema: s('Set brightness', body({ id: { type: 'string' }, value: { type: 'number' } }, ['id', 'value'])), preHandler: requirePerm('dashboards.view') },
    wrap('system', req => setBrightness(req.body.id, req.body.value)))
  app.post('/hardware/display/power', { schema: s('Screen on/off (backlight / DDC)', body({ on: { type: 'boolean' } }, ['on'])), preHandler: requirePerm('dashboards.view') },
    wrap('system', req => setPower(req.body.on)))
  app.post('/hardware/display/output', { schema: s('Rotation / scale / mode', body({ name: { type: 'string' }, transform: { type: 'string' }, scale: { type: 'number' }, mode: { type: 'string' } }, ['name'])), preHandler: manage },
    wrap('system', req => setOutput(req.body.name, req.body)))

  app.get('/hardware/network', { schema: s('Network status'), preHandler: requirePerm('system.view') }, wrap('network', () => networkStatus()))
  app.get('/hardware/network/wifi', { schema: s('Scan WiFi'), preHandler: manage }, wrap('network', () => wifiScan()))
  app.post('/hardware/network/wifi', { schema: s('Connect WiFi', body({ ssid: { type: 'string', maxLength: 64 }, password: { type: 'string', maxLength: 128 }, hidden: { type: 'boolean' } }, ['ssid'])), preHandler: manage },
    wrap('network', async req => { await wifiConnect(req.body.ssid, req.body.password, req.body.hidden); log('network', 'info', 'wifi.connected', { ssid: req.body.ssid }, req.user.id) }))
  app.post('/hardware/network/radio', { schema: s('WiFi on/off', body({ on: { type: 'boolean' } }, ['on'])), preHandler: manage }, wrap('network', req => wifiRadio(req.body.on)))
  app.delete('/hardware/network/connections/:uuid', { schema: s('Forget connection'), preHandler: manage }, wrap('network', req => forget(req.params.uuid)))
  app.post('/hardware/network/hostname', { schema: s('Set hostname', body({ name: { type: 'string' } }, ['name'])), preHandler: manage }, wrap('network', req => setHostname(req.body.name)))

  app.get('/hardware/bluetooth', { schema: s('Bluetooth status'), preHandler: requirePerm('system.view') }, wrap('bluetooth', () => bt.bluetoothStatus()))
  app.post('/hardware/bluetooth/scan', { schema: s('Scan for devices'), preHandler: manage }, wrap('bluetooth', () => bt.scan(8)))
  app.post('/hardware/bluetooth/power', { schema: s('Bluetooth on/off', body({ on: { type: 'boolean' } }, ['on'])), preHandler: manage }, wrap('bluetooth', req => bt.power(req.body.on)))
  for (const action of ['pair', 'connect', 'disconnect', 'remove']) {
    app.post(`/hardware/bluetooth/${action}`, { schema: s(`Bluetooth ${action}`, body({ address: { type: 'string' } }, ['address'])), preHandler: manage },
      wrap('bluetooth', async req => { await bt[action](req.body.address); log('bluetooth', 'info', `bluetooth.${action}`, { address: req.body.address }, req.user.id) }))
  }

  app.get('/hardware/audio', { schema: s('Audio devices'), preHandler: requirePerm('system.view') }, wrap('system', () => audioStatus()))
  app.post('/hardware/audio/volume', { schema: s('Volume', body({ id: { type: ['string', 'integer'] }, value: { type: 'number' } }, ['id', 'value'])), preHandler: requirePerm('dashboards.view') },
    wrap('system', req => setVolume(req.body.id, req.body.value)))
  app.post('/hardware/audio/mute', { schema: s('Mute', body({ id: { type: ['string', 'integer'] }, muted: { type: 'boolean' } }, ['id', 'muted'])), preHandler: requirePerm('dashboards.view') },
    wrap('system', req => setMute(req.body.id, req.body.muted)))
  app.post('/hardware/audio/default', { schema: s('Default device', body({ id: { type: 'integer' } }, ['id'])), preHandler: manage }, wrap('system', req => setDefault(req.body.id)))

  app.post('/hardware/power', { schema: s('Reboot / power off / restart UI', body({ action: { type: 'string', enum: ['reboot', 'poweroff', 'restart-ui'] } }, ['action'])), preHandler: manage },
    wrap('system', async req => {
      log('system', 'warning', 'system.power', { action: req.body.action }, req.user.id)
      const args = req.body.action === 'restart-ui' ? ['restart', 'smartboard-kiosk.service'] : [req.body.action]
      setTimeout(() => run('systemctl', args, { timeout: 15000 }).catch(e => log('system', 'error', 'hardware.failed', { error: e.message })), 800)
    }))

  app.get('/hardware/update', { schema: s('OS/core update status'), preHandler: requirePerm('system.view') }, async () => {
    let state = null
    try { state = JSON.parse(readFileSync(UPDATE_STATE, 'utf8')) } catch {}
    let settings = { channel: 'stable', auto: true }
    try { settings = { ...settings, ...JSON.parse(readFileSync(UPDATE_SETTINGS, 'utf8')) } } catch {}
    return { device: isDevice(), version: process.env.npm_package_version ?? null, state, settings }
  })
  app.put('/hardware/update', { schema: s('Update settings', body({ channel: { type: 'string', enum: ['stable', 'beta'] }, auto: { type: 'boolean' } })), preHandler: manage }, async req => {
    let cur = {}
    try { cur = JSON.parse(readFileSync(UPDATE_SETTINGS, 'utf8')) } catch {}
    writeFileSync(UPDATE_SETTINGS, JSON.stringify({ ...cur, ...req.body }))
    return { ok: true }
  })
  app.post('/hardware/update/check', { schema: s('Check and install update now'), preHandler: manage },
    wrap('updates', async req => {
      log('updates', 'info', 'update.requested', {}, req.user.id)
      await run('systemctl', ['start', '--no-block', 'smartboard-update.service'], { timeout: 10000 })
    }))
}

