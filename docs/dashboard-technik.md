# Dashboard – Aufbau und Technik

Wie die SmartBoard-Dashboards gebaut sind: Datenmodell, Darstellung, Datenfluss und automatischer Vorschlag.
Ergänzt `AGENTS.md` (Projektregeln).

## 1. Datenmodell (SQLite, `server/src/core/db.js`)
| Tabelle | Wichtige Spalten |
|---|---|
| `dashboards` | id, name, icon (1 Zeichen), position, style (`seamless`/`tiles`/`glass`/`apple`) |
| `widgets` | id, dashboard_id, type, title, x, y, w, h (Raster 12 Spalten), source_id, config (JSON) |
| `data_sources` | id, name, type (`static`, `rest_json`, `home_assistant`, `ical`), config (JSON) |
| `devices` | id, integration_id, native_id, name, type, capabilities (JSON), state (JSON), meta (JSON), room_id, groups (JSON), adopted, hidden |
| `rooms` | id, name, position |

## 2. Widget-Typen (`server/src/modules/registry.js` → `WIDGET_TYPES`)
| Typ | Zweck | Wichtige config-Felder |
|---|---|---|
| clock | Uhr + Datum | – |
| text | Notiz | text |
| kpi | große Zahl | value / device_id+capability, unit, decimals, color |
| gauge | Rundanzeige | value / device_id+capability, min, max, unit, color |
| chart | Diagramm | values / device_id+capability (24-h-Verlauf), style (`line`,`wave`,`bar`,`spectrum`), unit, color |
| device | Gerät mit Bedienung | device_id |
| room | Liste aller Geräte eines Raums | room_id |
| switch, calendar, iframe, camera, plugin | siehe registry.js | |

**Wert-Herkunft eines Widgets** (Priorität):
1. `config.device_id` + `config.capability` → Live-Wert eines Geräts.
2. `source_id` → Datenquelle (REST/HA/iCal).
3. sonst statische Werte aus `config.value` / `config.values`.

Aufgelöst in `server/src/modules/sources-adapters.js → resolve()`, abgerufen über `GET /api/v1/widgets/:id/data`.

## 3. Darstellung im Browser (`web/src`)
- **Shell.vue**: Rahmen, linke Leiste (Dashboards), Kopfzeile, Tastatur (Pfeile, Esc, Bild↑/↓), Vorschlags-Banner (`Suggest.vue`).
- **Board.vue**: Raster mit **Gridstack** – `column: 12`, `cellHeight: 90`, `margin: 0`, Breakpoints: <700 px → 1 Spalte, <1100 px → 6 Spalten. Im Bearbeiten-Modus Drag & Resize; Layout wird per `PUT /dashboards/:id/layout` gespeichert.
- **WidgetView.vue**: Rahmen pro Widget (Titel + Inhalt), lädt Daten (`/widgets/:id/data`) alle `config.refresh` Sekunden (gerätegebunden: alle 5 s), wählt die Komponente aus `widgets/*.vue`. Große Widgets (Chart, Gauge, Kalender, Kamera, Plugin, iFrame) werden lazy geladen.
- **Widgets** (`web/src/widgets/`): KPI/Clock/Room/Device reines Vue+CSS; Gauge und Chart mit **ECharts** (`useChart.js`, Canvas-Renderer, ResizeObserver). Animation kommt aus ECharts (Einblenden und Übergang bei Wertänderung).
- **WidgetEditor.vue**: Typ wählen, Titel, „Wert von Gerät“ (Gerät + Messwert), sonst Datenquelle/feste Werte, Farbe, Einheit.

## 4. Design
- Globales CSS: `web/src/style.css`. Farb-Variablen in `:root` (Neon) und `.theme-apple` (Standard, Apple-Look: Schwarz, SF-Schrift, Systemfarben #0A84FF, #30D158, #FF9F0A …).
- Umschalten: Einstellungen → Allgemein → Design (`settings.theme`, Klasse am `<html>`).
- **Widgets sind immer transparent**: kein Rand, kein Hintergrund, kein Schatten (Regel `html .grid-stack-item-content …` am Ende von style.css). Ansichten unterscheiden sich nur durch Abstand/Rundung.
- Farben pro Messgröße (auch im Vorschlag): Temperatur #22D3EE, Luftfeuchte #3B82F6, Leistung #F59E0B, Energie/PV/Batterie #22C55E, CPU #8B5CF6, RAM #22D3EE, Speicher #EC4899.

## 5. Live-Daten
- Integrationen (`server/src/devices/adapters/*.js`) melden Werte über `ctx.update()`.
- `devices/engine.js` hält den Live-Zustand im Speicher, speichert ihn gepuffert in SQLite und führt einen **24-h-Verlauf** pro Gerät+Messwert (1 Punkt/Minute, im RAM, `deviceHistory()`).
- WebSocket `/api/v1/events` sendet `device.state` an alle Browser → `web/src/devices.js` (`store.devices`).

## 6. Automatischer Dashboard-Vorschlag (`server/src/modules/autogen.js`)
Ablauf im UI (`Suggest.vue`): **Schritt 1** erkannte Geräte nach Thema prüfen/abwählen → **Schritt 2** vorgeschlagene Dashboards mit Live-Werten ansehen/abwählen → anlegen.

Algorithmus:
1. **Filtern** (`relevant`): nur steuerbare Geräte, sinnvolle Messwerte (Temperatur, Leistung, Energie, CPU …) und Sicherheitssensoren. Diagnose-/Signalstärke-Einträge fallen weg.
2. **Namen** (`niceName`): `sensor.pv_power_today` → „PV Leistung heute“ (Wörterbuch EN→DE, Umlaute).
3. **Thema** (`topicOf`): energy, climate, security, server, control, other – nach Gerätetyp, Messgrößen und Namen.
4. **Raum**: HA-Bereich → sonst aus dem Namen (`roomFromName`: Wohnzimmer, Küche, Bad …) → Proxmox = „Server“.
5. **Rolle im Energie-Dashboard** (`roleOf`): pv, home, grid, battery, wallbox (Typ + Namensmuster).
6. **Dashboards bauen** (`buildPlan`):
   - *Übersicht*: Uhr, 3 KPIs (PV, Temperatur, weitere), Verlaufsdiagramm, Gauge, je Raum eine Raum-Kachel.
   - *Solar & Energie*: KPIs PV/Haus/Netz/Wallbox, Batterie-Gauge, Verläufe PV/Verbrauch/Netz, kWh-Werte.
   - *Klima*: Temperatur-KPIs, Luftfeuchte/CO₂-Gauges je Raum.
   - *Sicherheit*: Geräte-Kacheln. *Server*: Proxmox CPU/RAM/Speicher-Gauges + CPU-Verlauf.
   - *Je Raum* (≥ 3 Geräte): Leistung → Diagramm, %-Werte → Gauge, sonstige Werte → KPI, Schalter → Geräte-Kachel.
7. **Layout** (`packer`): einfaches Regal-Packen in 12 Spalten (größte Widgets zuerst).
8. **Anlegen**: Geräte übernehmen (adopted), Raum + Gruppe + lesbarer Name setzen, Dashboards im Stil des ersten eigenen Dashboards anlegen. IDs in `settings.autogen_dashboards` → erneutes Erstellen ersetzt nur diese.

API: `POST /api/v1/dashboards/generate` mit `{ dryRun, exclude: [deviceIds], include: [dashboardNames], rooms, replace }`. `dryRun` liefert `devices`, `plan`, `names`.

## 7. Wo ändern?
| Wunsch | Datei |
|---|---|
| Neuer Widget-Typ | `registry.js` + `web/src/widgets/XyzWidget.vue` + `WidgetView.vue` (components) + Texte |
| Aussehen/Farben | `web/src/style.css` |
| Vorschlags-Logik | `server/src/modules/autogen.js` (+ Test in `server/test/adapters.test.js`) |
| Raster/Größen | `web/src/components/Board.vue` |
| Neue Geräte-Quelle | `server/src/devices/adapters/` (siehe AGENTS.md) |

---

# Teil 2 – Code im Detail

## Stack
| Teil | Technik |
|---|---|
| Frontend | Vue 3.5 (Composition API, `<script setup>`), Vite 8, vue-i18n 11 |
| Raster | gridstack 14 |
| Diagramme/Anzeigen | echarts 6 (Tree-Shaking: Line, Bar, Gauge, Canvas) |
| Backend | Node 22, Fastify 5, `node:sqlite` (synchron, kein ORM), @fastify/websocket, mqtt |
| Tests | `node:test` (`server/test/*.test.js`) |

## Board.vue – Raster
```js
grid = GridStack.init({
  column: 12, cellHeight: 90, margin: 0, float: false,
  staticGrid: !props.editing,            // nur im Bearbeiten-Modus verschiebbar
  animate: true,
  columnOpts: { breakpoints: [{ w: 700, c: 1 }, { w: 1100, c: 6 }] },
  draggable: { cancel: '.no-drag' }, resizable: { handles: 'se' },
}, el.value)
grid.on('change', saveLayout)            // → PUT /dashboards/:id/layout [{id,x,y,w,h}]
```
Template: pro Widget ein `.grid-stack-item` mit `gs-x/gs-y/gs-w/gs-h/gs-id`, darin `<WidgetView>`. Die Klasse `style-<seamless|tiles|glass|apple>` am Container steuert die Ansicht.

## WidgetView.vue – Datenschleife
```js
const components = { clock, text, kpi, gauge, chart, calendar, switch, iframe, device, room, plugin, camera }
const needsData = ['kpi', 'gauge', 'chart', 'calendar', 'switch']
async function refresh() { data.value = await api('GET', `/widgets/${props.widget.id}/data`) }
timer = setInterval(refresh, Math.max(5, widget.config.device_id ? 5 : widget.config.refresh ?? 30) * 1000)
// <component :is="components[widget.type]" :widget="widget" :data="data" :editing="editing" />
```
Device- und Room-Widgets lesen direkt aus `store.devices` (live per WebSocket), nicht über `/data`.

## Widget-Komponenten
**KpiWidget.vue** – reine CSS-Zahl, skaliert per Container-Query:
```vue
<div class="k">                                   <!-- container-type: size -->
  <div class="v" :style="{ color }">{{ text }}<span class="u">{{ data?.unit }}</span></div>
  <div class="bar" :style="{ background: `linear-gradient(90deg, ${color}, transparent)` }" />
</div>
<style>.v { font-size: clamp(28px, 48cqh, 110px) }</style>
```
**useChart.js** – gemeinsamer ECharts-Hook:
```js
echarts.use([LineChart, BarChart, GaugeChart, GridComponent, TooltipComponent, CanvasRenderer])
export function useChart(el, buildOption, deps) {
  onMounted(() => { chart = echarts.init(el.value, null, { renderer: 'canvas' }); render(); new ResizeObserver(() => chart.resize()).observe(el.value) })
  watch(deps, () => chart.setOption(buildOption(), true), { deep: true })   // Animation bei Wertänderung
}
```
**ChartWidget.vue** – Stile:
```js
line:     [{ type: 'line', smooth: 0.45, symbol: 'none', lineStyle: { width: 3, color: Verlauf(color→#22D3EE) }, areaStyle: Verlauf(color 33%→0) }]
wave:     zwei Linien (versetzte Kopie × 0,75 + Hauptlinie)
bar:      [{ type: 'bar', barWidth: '35%', itemStyle: { color: Verlauf(color→transparent) } }]
spectrum: Balken, jede Säule eigene Farbe aus SPECTRUM
// Achsen dezent: Labels aus, gestrichelte Hilfslinien, Tooltip mit Einheit
```
**GaugeWidget.vue**:
```js
{ type: 'gauge', min, max, startAngle: 220, endAngle: -40, radius: '95%',
  progress: { show: true, width: 14, roundCap: true, itemStyle: { color } },
  axisLine: { lineStyle: { width: 14, color: [[1, 'rgba(148,163,184,0.12)']] } },
  pointer/axisTick/splitLine/axisLabel: { show: false },
  detail: { valueAnimation: true, formatter: '{value} %' } }
```

## Server – Datenauflösung (`sources-adapters.js`)
```js
export async function resolve(widget, source) {
  const wc = widget.config
  if (wc.device_id && wc.capability) {
    const d = getDevice(wc.device_id)
    const unit = wc.unit || d.capabilities.find(c => c.id === wc.capability)?.unit || ''
    if (widget.type === 'chart') return { values: deviceHistory(d.id, wc.capability), unit }
    return { value: d.state[wc.capability] ?? null, unit, offline: d.connection === 'offline' }
  }
  if (!source || source.type === 'static') return { value: wc.value, values: wc.values, unit: wc.unit }
  // rest_json: JSON-Pfad; home_assistant: /api/states/<entity_id>; ical: Termine
}
```

## Server – Live-Zustand und Verlauf (`devices/engine.js`)
```js
ctx.update(nativeId, statePatch, { connection }) →
  d.state = { ...d.state, ...statePatch }
  remember(id, statePatch)              // Zahlen → history Map `${id}:${cap}` → [[ts, v]] max 1440, 1/min
  persistQueue.set(id, d)               // gebündeltes Schreiben in SQLite
  bus.emit('device.state', {...})       // → WebSocket /api/v1/events → Browser
export const deviceHistory = (id, cap) => (history.get(`${id}:${cap}`) ?? []).map(x => x[1])
```

## Server – Vorschlag (`modules/autogen.js`)
```js
const COLORS = { temperature: '#22D3EE', humidity: '#3B82F6', power: '#F59E0B', energy: '#22C55E', battery: '#22C55E', cpu: '#8B5CF6', memory: '#22D3EE', disk: '#EC4899' }
const GAUGE = ['cpu', 'memory', 'disk', 'humidity', 'battery', 'co2']

function valueWidget(d, c, title) {               // Messwert → passendes Widget
  if (c.quantity === 'power') return { type: 'chart', w: 6, h: 3, config: { device_id, capability, style: 'line', color } }
  if (GAUGE.includes(c.quantity)) return { type: 'gauge', w: 3, h: 3, config: { ..., min: 0, max: 100 } }
  return { type: 'kpi', w: 3, h: 2, config: { ..., decimals: c.quantity === 'temperature' ? 1 : 0 } }
}

function packer() {                               // Regal-Packen auf 12 Spalten
  const cols = Array(12).fill(0)
  return (w, h) => { /* niedrigste freie Position x..x+w suchen */ }
}
// buildPlan(): Übersicht + TOPICS (energy/climate/security/server) + Räume → [{ name, icon, widgets:[{type,title,x,y,w,h,config}] }]
// generate({ dryRun, exclude, include }): dryRun → Vorschau; sonst Transaktion: Geräte übernehmen/benennen/einsortieren, Dashboards + Widgets anlegen
```

## CSS-Kernregeln (`web/src/style.css`)
```css
.theme-apple { --bg:#000; --text:#f5f5f7; --dim:#98989d; --cyan:#0a84ff; --ok:#30d158; --radius:22px;
               --font:-apple-system, 'SF Pro Display', 'Inter', system-ui, sans-serif }
.theme-apple body { background: radial-gradient(… blau oben rechts), radial-gradient(… violett unten links), linear-gradient(#0d0d12, #000) }
/* Widgets immer randlos/transparent – in jedem Design und jeder Ansicht */
html .grid-stack-item-content { border:0!important; background:transparent!important; box-shadow:none!important; backdrop-filter:none!important }
.style-seamless …-content { inset: 0 }   .style-tiles { inset: 2px }   .style-glass { inset: 6px }   .style-apple { inset: 8px }
.lite …  /* Pi-Modus: Blur/Schatten aus für weniger GPU-Last */
```

## REST-API (Auszug, Prefix `/api/v1`)
| Methode | Pfad | Zweck |
|---|---|---|
| GET/POST/PUT/DELETE | `/dashboards`, `/dashboards/:id` | Dashboards |
| GET/POST | `/dashboards/:id/widgets` | Widgets lesen/anlegen |
| PUT | `/dashboards/:id/layout` | Positionen speichern |
| PUT/DELETE | `/widgets/:id` | Widget ändern/löschen |
| GET | `/widgets/:id/data` | Wert(e) eines Widgets |
| POST | `/dashboards/generate` | Vorschlag (dryRun) / anlegen |
| GET | `/devices`, `/integrations`, `/registry` | Geräte, Integrationen, Typen |
| WS | `/events` | Live: device.state, notification, alarm … |
Vollständige API-Doku: `http://<smartboard>/api/docs` (Swagger).
