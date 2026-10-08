import { db } from './db.js'

export function seedDemo() {
  if (db.prepare('SELECT COUNT(*) c FROM dashboards').get().c === 0) {
    const id = db.prepare('INSERT INTO dashboards (name, icon) VALUES (?, ?)').run('Zuhause', '⌂').lastInsertRowid
    const add = db.prepare('INSERT INTO widgets (dashboard_id, type, title, x, y, w, h, config) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    const w = (type, title, x, y, ww, h, cfg = {}) => add.run(id, type, title, x, y, ww, h, JSON.stringify(cfg))
    w('kpi', 'Innen', 0, 0, 3, 2, { value: 21.5, unit: '°C', color: '#22D3EE', decimals: 1 })
    w('kpi', 'Strom jetzt', 3, 0, 3, 2, { value: 842, unit: 'W', color: '#F59E0B' })
    w('kpi', 'PV heute', 6, 0, 3, 2, { value: 12.4, unit: 'kWh', color: '#22C55E', decimals: 1 })
    w('kpi', 'Netzwerk', 9, 0, 3, 2, { value: 37, unit: 'Geräte', color: '#EC4899' })
    w('clock', 'Uhrzeit', 0, 2, 4, 3)
    w('chart', 'Verbrauch 24 h', 4, 2, 8, 3, { style: 'wave', color: '#EC4899', unit: 'kW', values: [0.4, 0.3, 0.3, 0.5, 1.2, 2.1, 1.4, 0.9, 1.1, 2.8, 1.6, 1.2, 0.9, 1.4, 3.2, 2.2, 1.5, 1.1, 0.8, 0.6] })
    w('gauge', 'CPU Server', 0, 5, 3, 3, { value: 42, max: 100, unit: '%', color: '#8B5CF6' })
    w('gauge', 'Speicher', 3, 5, 3, 3, { value: 68, max: 100, unit: '%', color: '#22D3EE' })
    w('chart', 'Firewall Blocks / h', 6, 5, 6, 3, { style: 'spectrum', values: [12, 18, 9, 22, 30, 14, 26, 19, 33, 21, 15, 28, 24, 17] })
    w('chart', 'Bandbreite', 0, 8, 6, 3, { style: 'line', color: '#22D3EE', unit: 'Mbit/s', values: [120, 180, 90, 240, 310, 200, 160, 280, 350, 260, 190, 230] })
    w('chart', 'Wasser', 6, 8, 6, 3, { style: 'bar', color: '#3B82F6', unit: 'l', values: [80, 120, 95, 140, 110, 160, 130] })
    const tech = db.prepare("INSERT INTO dashboards (name, icon, position, style) VALUES ('Technik', '⚙', 1, 'tiles')").run().lastInsertRowid
    const t = (type, title, x, y, ww, h, cfg = {}) => add.run(tech, type, title, x, y, ww, h, JSON.stringify(cfg))
    t('gauge', 'CPU', 0, 0, 4, 3, { value: 42, max: 100, unit: '%', color: '#8B5CF6' })
    t('gauge', 'RAM', 4, 0, 4, 3, { value: 68, max: 100, unit: '%', color: '#22D3EE' })
    t('gauge', 'Temperatur', 8, 0, 4, 3, { value: 51, max: 90, unit: '°C', color: '#F59E0B' })
    t('chart', 'Firewall Blocks / h', 0, 3, 12, 3, { style: 'spectrum', values: [12, 18, 9, 22, 30, 14, 26, 19, 33, 21, 15, 28, 24, 17, 20, 31, 11, 25] })
  }
}
