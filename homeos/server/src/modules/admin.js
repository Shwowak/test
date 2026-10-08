import os from 'node:os'
import { statfs, readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { db } from '../core/db.js'
import { ROLES, PERMISSIONS } from '../core/auth.js'
import { requirePerm, notFound } from '../core/http.js'
import { queryLogs, LOG_CATEGORIES, LOG_LEVELS } from '../core/logger.js'
import { listVersions, restoreVersion } from '../core/versions.js'
import { WIDGET_TYPES, DASHBOARD_STYLES, LOCALES } from './registry.js'
import { SOURCE_TYPES } from './sources-adapters.js'

const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url)))
const started = Date.now()

const csvCell = v => `"${String(v ?? '').replace(/"/g, '""')}"`

export default async function adminModule(app) {
  app.get('/meta', { schema: { tags: ['system'], summary: 'Registries for UI forms' } }, async () => ({
    widgetTypes: WIDGET_TYPES, sourceTypes: SOURCE_TYPES, dashboardStyles: DASHBOARD_STYLES,
    roles: Object.keys(ROLES), permissions: PERMISSIONS, locales: LOCALES,
    logCategories: LOG_CATEGORIES, logLevels: LOG_LEVELS,
  }))

  const logQuery = {
    type: 'object',
    properties: {
      category: { type: 'string', enum: LOG_CATEGORIES }, level: { type: 'string', enum: LOG_LEVELS },
      q: { type: 'string', maxLength: 200 }, from: { type: 'string' }, to: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 5000 }, offset: { type: 'integer', minimum: 0 },
    },
  }

  app.get('/logs', { schema: { tags: ['logs'], summary: 'Query logs', querystring: logQuery }, preHandler: requirePerm('logs.view') },
    async req => queryLogs(req.query))

  app.get('/logs/export', {
    schema: { tags: ['logs'], summary: 'Export logs as CSV or JSON', querystring: { ...logQuery, properties: { ...logQuery.properties, format: { type: 'string', enum: ['csv', 'json'] } } } },
    preHandler: requirePerm('logs.view'),
  }, async (req, reply) => {
    const rows = queryLogs({ ...req.query, limit: req.query.limit ?? 5000 })
    const stamp = new Date().toISOString().slice(0, 19).replace(/:/g, '-')
    if (req.query.format === 'json') {
      reply.header('Content-Disposition', `attachment; filename="homeos-logs-${stamp}.json"`)
      return rows
    }
    reply.header('Content-Type', 'text/csv; charset=utf-8').header('Content-Disposition', `attachment; filename="homeos-logs-${stamp}.csv"`)
    return ['ts,level,category,message,user,data', ...rows.map(r => [r.ts, r.level, r.category, r.message, r.user_name, r.data].map(csvCell).join(','))].join('\n')
  })

  app.get('/versions', { schema: { tags: ['versions'], summary: 'Configuration history (auto backup on every change)' }, preHandler: requirePerm('versions.view') },
    async req => listVersions(req.query.limit ?? 100))

  app.post('/versions/:id/restore', { schema: { tags: ['versions'], summary: 'Restore configuration to a version' }, preHandler: requirePerm('versions.restore') },
    async req => {
      if (!restoreVersion(Number(req.params.id), req.user)) throw notFound()
      return { ok: true }
    })

  app.get('/system', { schema: { tags: ['system'], summary: 'System status' }, preHandler: requirePerm('system.view') }, async () => {
    let disk = null
    try {
      const s = await statfs(dirname(process.env.HOMEOS_DB ?? './data/homeos.db'))
      disk = { total: s.blocks * s.bsize, free: s.bavail * s.bsize }
    } catch {}
    return {
      version: pkg.version, node: process.version, platform: `${os.type()} ${os.release()} ${os.arch()}`,
      hostname: os.hostname(), uptime: os.uptime(), app_uptime: Math.round((Date.now() - started) / 1000),
      load: os.loadavg(), cpus: os.cpus().length,
      memory: { total: os.totalmem(), free: os.freemem(), process: process.memoryUsage().rss },
      disk,
      counts: {
        users: db.prepare('SELECT COUNT(*) c FROM users').get().c,
        dashboards: db.prepare('SELECT COUNT(*) c FROM dashboards').get().c,
        widgets: db.prepare('SELECT COUNT(*) c FROM widgets').get().c,
        sources: db.prepare('SELECT COUNT(*) c FROM data_sources').get().c,
        versions: db.prepare('SELECT COUNT(*) c FROM config_versions').get().c,
        logs: db.prepare('SELECT COUNT(*) c FROM logs').get().c,
      },
    }
  })
}
