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
