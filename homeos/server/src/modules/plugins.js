import { readFileSync } from 'node:fs'
import { extname, join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { db } from '../core/db.js'
import { notFound, badRequest, requirePerm, HttpError } from '../core/http.js'
import { recordChange } from '../core/versions.js'
import { can } from '../core/auth.js'
import { log } from '../core/logger.js'
import { getSetting, setSetting } from '../core/settings.js'
import { unpack, checkSignature, PackageError, PLUGIN_PERMISSIONS } from '../plugins/package.js'
import { getPlugin, pluginRow, startPlugin, stopPlugin, pushConfig, callAction, installFiles, removeFiles, pluginFile, resetRestarts } from '../plugins/host.js'

const UI_SDK = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'plugins', 'ui-sdk.js'))
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.json': 'application/json', '.woff2': 'font/woff2' }
const CSP = "default-src 'none'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; base-uri 'none'; form-action 'none'"

const publicView = (p, admin) => {
  const out = { ...p }
  if (!admin) {
    const secret = new Set((p.manifest.config ?? []).filter(f => f.type === 'password').map(f => f.key))
    out.config = Object.fromEntries(Object.entries(p.config).filter(([k]) => !secret.has(k)))
  } else {
    for (const f of p.manifest.config ?? []) if (f.type === 'password' && out.config[f.key]) out.config = { ...out.config, [f.key]: '••••••' }
  }
  return out
}

export default async function pluginsModule(app) {
  const tP = (summary, extra = {}) => ({ tags: ['plugins'], summary, ...extra })

  app.addContentTypeParser(['application/zip', 'application/octet-stream'], { parseAs: 'buffer', bodyLimit: 20 * 1024 * 1024 }, (req, body, done) => done(null, body))

  app.get('/plugins/sdk.js', { schema: tP('UI SDK for plugin iframes'), config: { public: true } }, async (req, reply) =>
    reply.type('text/javascript; charset=utf-8').header('cache-control', 'no-cache').send(UI_SDK))

  app.get('/plugins/meta', { schema: tP('Plugin permissions and settings'), preHandler: requirePerm('plugins.view') }, async () => ({
    permissions: PLUGIN_PERMISSIONS, allowUnsigned: !!getSetting('plugins_allow_unsigned'), trustedKeys: getSetting('plugins_trusted_keys') ?? [],
  }))

  app.put('/plugins/meta', {
    schema: tP('Plugin security settings', { body: { type: 'object', properties: { allowUnsigned: { type: 'boolean' }, trustedKeys: { type: 'array', items: { type: 'string', maxLength: 200 }, maxItems: 50 } } } }),
    preHandler: requirePerm('plugins.manage'),
  }, async req => {
    if (req.body.allowUnsigned !== undefined) setSetting('plugins_allow_unsigned', req.body.allowUnsigned)
    if (req.body.trustedKeys) setSetting('plugins_trusted_keys', req.body.trustedKeys)
    recordChange(req.user, 'settings', null, 'update', 'plugins')
    return { ok: true }
  })

  app.get('/plugins', { schema: tP('List plugins'), preHandler: requirePerm('plugins.view') }, async req => {
    const admin = can(req.user, 'plugins.manage')
    return db.prepare('SELECT * FROM plugins ORDER BY id').all().map(r => publicView(pluginRow(r), admin))
  })

  app.post('/plugins/install', {
    schema: tP('Install or update a plugin (.sbp archive as request body)', { querystring: { type: 'object', properties: { trust: { type: 'boolean' } } } }),
    preHandler: requirePerm('plugins.manage'),
  }, async req => {
    if (!Buffer.isBuffer(req.body)) throw badRequest('plugin.bad_archive')
    let pkg, sig
    try {
      pkg = unpack(req.body)
      sig = checkSignature(pkg.files, getSetting('plugins_trusted_keys') ?? [])
    } catch (e) {
      if (e instanceof PackageError) throw new HttpError(422, e.code, e.details)
      throw e
    }
    const m = pkg.manifest
    const existing = getPlugin(m.id)
    if (existing?.source === 'builtin') throw new HttpError(409, 'plugin.builtin_conflict')
    if (!sig.verified && !getSetting('plugins_allow_unsigned') && !req.query.trust) throw new HttpError(422, 'plugin.unverified', { signed: sig.signed, signer: sig.signer, manifest: m })
    stopPlugin(m.id)
    installFiles(m.id, pkg.files)
    const now = new Date().toISOString()
    const granted = existing ? existing.granted.filter(p => (m.permissions ?? []).includes(p)).concat((m.permissions ?? []).filter(p => !existing.manifest.permissions?.includes(p))) : m.permissions ?? []
    const config = { ...Object.fromEntries((m.config ?? []).filter(f => f.default !== undefined).map(f => [f.key, f.default])), ...(existing?.config ?? {}) }
    db.prepare(`INSERT INTO plugins (id, version, manifest, source, enabled, granted, config, verified, signer, installed_at, updated_at) VALUES (?, ?, ?, 'user', 1, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET version = excluded.version, manifest = excluded.manifest, granted = excluded.granted, config = excluded.config, verified = excluded.verified, signer = excluded.signer, updated_at = excluded.updated_at`)
      .run(m.id, m.version, JSON.stringify(m), JSON.stringify(granted), JSON.stringify(config), sig.verified ? 1 : 0, sig.signer, existing?.installed_at ?? now, now)
    log('plugins', 'info', existing ? 'plugin.updated' : 'plugin.installed', { plugin: m.id, version: m.version, verified: sig.verified }, req.user.id)
    recordChange(req.user, 'plugin', null, existing ? 'update' : 'create', `${m.id} ${m.version}`)
    resetRestarts(m.id)
    startPlugin(m.id)
    return publicView(getPlugin(m.id), true)
  })

  app.put('/plugins/:id', {
    schema: tP('Enable/disable, permissions, configuration', { body: { type: 'object', properties: {
      enabled: { type: 'boolean' }, granted: { type: 'array', items: { type: 'string', enum: PLUGIN_PERMISSIONS } }, config: { type: 'object' },
    } } }),
    preHandler: requirePerm('plugins.manage'),
  }, async req => {
    const p = getPlugin(req.params.id)
    if (!p) throw notFound()
    const b = req.body
    const granted = b.granted ? b.granted.filter(x => (p.manifest.permissions ?? []).includes(x)) : p.granted
    let config = p.config
    if (b.config) {
      config = { ...p.config }
      for (const f of p.manifest.config ?? []) {
        if (!(f.key in b.config)) continue
        let v = b.config[f.key]
        if (f.type === 'password' && v === '••••••') continue
        if (f.type === 'number') v = v === '' || v === null ? null : Number(v)
        else if (f.type === 'bool') v = !!v
        else if (f.type === 'devices' || f.type === 'list') v = Array.isArray(v) ? v.slice(0, 100) : []
        else if (f.type === 'device') v = v === '' || v === null ? null : Number(v)
        else if (f.type === 'select' && !(f.options ?? []).includes(v)) continue
        else v = String(v ?? '').slice(0, 2000)
        config[f.key] = v
      }
    }
    const enabled = b.enabled ?? p.enabled
    db.prepare('UPDATE plugins SET enabled = ?, granted = ?, config = ?, updated_at = ? WHERE id = ?')
      .run(enabled ? 1 : 0, JSON.stringify(granted), JSON.stringify(config), new Date().toISOString(), p.id)
    recordChange(req.user, 'plugin', null, 'update', p.id)
    const permsChanged = JSON.stringify(granted) !== JSON.stringify(p.granted)
    if (enabled !== p.enabled || permsChanged) { resetRestarts(p.id); enabled ? startPlugin(p.id) : stopPlugin(p.id) } else if (b.config) pushConfig(p.id)
    return publicView(getPlugin(p.id), true)
  })

  app.post('/plugins/:id/restart', { schema: tP('Restart plugin'), preHandler: requirePerm('plugins.manage') }, async req => {
    if (!getPlugin(req.params.id)) throw notFound()
    resetRestarts(req.params.id)
    startPlugin(req.params.id)
    return { ok: true }
  })

  app.delete('/plugins/:id', { schema: tP('Uninstall plugin'), preHandler: requirePerm('plugins.manage') }, async req => {
    const p = getPlugin(req.params.id)
    if (!p) throw notFound()
    if (p.source === 'builtin') throw new HttpError(409, 'plugin.builtin')
    stopPlugin(p.id)
    db.prepare('DELETE FROM plugins WHERE id = ?').run(p.id)
    db.prepare('DELETE FROM plugin_storage WHERE plugin_id = ?').run(p.id)
    db.prepare('DELETE FROM plugin_data WHERE plugin_id = ?').run(p.id)
    removeFiles(p.id)
    log('plugins', 'warning', 'plugin.removed', { plugin: p.id }, req.user.id)
    recordChange(req.user, 'plugin', null, 'delete', p.id)
    return { ok: true }
  })

  app.get('/plugins/:id/data', { schema: tP('Data published by the plugin backend'), preHandler: requirePerm('dashboards.view') }, async req => {
    const p = getPlugin(req.params.id)
    if (!p) throw notFound()
    return Object.fromEntries(db.prepare('SELECT key, value FROM plugin_data WHERE plugin_id = ?').all(p.id).map(r => [r.key, JSON.parse(r.value)]))
  })

  app.post('/plugins/:id/actions/:name', { schema: tP('Call a backend action (from plugin UI)'), preHandler: requirePerm('dashboards.view') }, async req => {
    const p = getPlugin(req.params.id)
    if (!p || !p.enabled) throw notFound()
    try {
      return { result: await callAction(p.id, req.params.name, req.body ?? null) }
    } catch (e) {
      throw new HttpError(422, 'plugin.action_failed', { message: e.message })
    }
  })

  app.get('/plugins/:id/ui/*', { schema: tP('Plugin UI assets (sandboxed iframe)', { hide: true }), config: { public: true } }, async (req, reply) => {
    const p = getPlugin(req.params.id)
    if (!p || !p.enabled) throw notFound()
    const buf = pluginFile(p, req.params['*'])
    if (!buf) throw notFound()
    return reply.type(MIME[extname(req.params['*']).toLowerCase()] ?? 'application/octet-stream')
      .header('content-security-policy', CSP).header('x-content-type-options', 'nosniff').header('cache-control', 'no-cache').send(buf)
  })
}
