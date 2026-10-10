# SmartBoard OS – Leitfaden für KI-Assistenten

Dieses Dokument ist der Kontext für jede KI, die an diesem Projekt arbeitet (lokal in LM Studio/Bionic oder in der Cloud).
Vor jeder Aufgabe lesen. Antworten auf Deutsch, kurz. Details zu Dashboards: `docs/dashboard-technik.md`.

## Was ist SmartBoard?
- Ein **Dashboard** (kein Steuerungs-Board) für Zuhause/Technikraum: zeigt Werte aus Home Assistant, evcc, Proxmox, Zigbee, KNX usw.
- Läuft auf einem **Raspberry Pi 4/5** im Kiosk-Modus am TV/Touchscreen und parallel im Browser (Mac/Handy) unter `http://smartboard.local/`.
- Bedienbar per Touch, Maus, **Tastatur** (Pfeiltasten, Esc = zurück, Bild↑/↓ = Dashboard wechseln) und Bluetooth-Tastatur.
- **Ansehen ohne Login** (Benutzer „anzeige“, Rolle guest). Passwort nur für Einstellungen/Bearbeiten (Entsperren-Dialog, Auto-Sperre).
- **Automationen standardmäßig aus.** Gerätesteuerung, Assistent, Kameras an (Einstellung `features`).
- **Updates nur übers Internet** (GitHub Releases), nie per neuem Image. Das Image ist nur für die Erstinstallation.

## Ordner
```
homeos/server/        Node 22 + Fastify 5 + node:sqlite (kein ORM)
  index.js            Start, Module registrieren (Prefix /api/v1)
  src/core/           db.js (Migrationen), auth.js (Rollen/Rechte), settings.js (DEFAULT_SETTINGS), events.js (bus), versions.js (recordChange)
  src/modules/        REST-Module: dashboards, devices, autogen (Dashboard-Vorschlag), alarm (Einsatzmonitor), hardware, plugins, cameras, ai …
  src/devices/        engine.js (ADAPTERS-Liste), model.js (Capabilities), adapters/*.js (Integrationen)
  src/system/         Pi-Hardware: Netzwerk, Bluetooth, Display, Health/Auto-Fix
  test/*.test.js      Tests (node:test) → npm test
homeos/web/           Vue 3 + Vite + vue-i18n
  src/components/     Shell.vue (Rahmen, Navigation), Board.vue (Gridstack), WidgetView/WidgetEditor, Suggest.vue, settings/*, alarm/*
  src/widgets/        Widget-Komponenten (Clock, Kpi, Gauge, Chart, Device, Room, Camera …)
  src/locales/        de.json, en.json (+ fr, es, it, nl)
  src/style.css       Globale Styles, Apple-Design unter .theme-apple
homeos/os/            Pi-System: install.sh, apply.sh, files/ (systemd, Kiosk, Update-Agent smartboard-update)
.github/workflows/    smartboard-release.yml (Tests → Release core-vX.Y.Z.N), homeos-docker.yml (Docker-Image)
docs/                 Architektur- und Planungsdokumente
```

## Regeln für Code-Änderungen
- **Nur ändern, was verlangt ist.** Bestehenden Stil übernehmen: keine Kommentare, kurze Funktionen, keine neuen npm-Pakete ohne Rückfrage.
- **Texte:** Jeder neue UI-Text in `web/src/locales/de.json` **und** `en.json`. In Texten kein `|` (Plural-Trenner) und keine `{ }` außer Platzhaltern.
- **Rechte:** Server-Routen mit `requirePerm('…')` schützen. Gast darf nur ansehen.
- **Einstellungen:** neue Werte in `DEFAULT_SETTINGS` (settings.js) + Validierung in der PUT-Route.
- **Datenbank:** Schemaänderungen nur als neue Migration am Ende des Arrays in `core/db.js`.
- **Design:** Standard ist das Apple-Design (`.theme-apple`), Neon optional. Widgets sind **transparent** (kein Hintergrund, keine Kanten). Dashboard-Ansichten: seamless, tiles, glass, apple.
- **Kein Code-Splitting per `manualChunks`** in vite.config.js – hat die App beim Start zerschossen.

## Neue Integration (Adapter) anlegen
1. Datei `server/src/devices/adapters/<name>.js`:
```js
import { cap, measurement } from '../model.js'
export default class XyzAdapter {
  static fields = [{ key: 'url', type: 'url', required: true }, { key: 'token', type: 'secret' }]
  constructor(integration, ctx) { this.cfg = integration.config; this.ctx = ctx }
  async start() { /* verbinden/pollen */ this.ctx.setStatus('connected') }
  async command(device, capId, value) { /* optional */ }
  async stop() {}
}
```
   - `ctx.upsert(id, { name, type, capabilities, manufacturer, model, meta: { area: 'Raum' } })` legt Geräte an.
   - `ctx.update(id, { capId: wert }, { connection: 'online' })` aktualisiert Werte live.
   - `ctx.setStatus('connected' | 'error', fehlertext, { devices: n })`.
   - Capabilities: onoff, brightness, color, position, cover, target_temperature, lock, measurement, binary, text, select.
   - Gerätetypen: siehe `DEVICE_TYPES` in model.js.
   - Manuelle Geräte (z. B. Register/Gruppenadressen): `static manualDevices = true`, `static deviceFields`, `static definition(meta)`.
2. In `devices/engine.js` importieren und in `ADAPTERS` eintragen.
3. Texte: `adapters.<name>`, `integrationFields.<feld>`, `integrations.help.<name>` in de/en.json.
4. Reine Umrechnungsfunktionen exportieren und in `server/test/adapters.test.js` testen.

Vorhandene Adapter: homeassistant, mqtt, rest, zigbee2mqtt, zwavejs, matter, knx, modbus, evcc, proxmox.

## Wichtige Funktionen
- **Dashboard-Vorschlag** (`modules/autogen.js`): baut aus erkannten Geräten eine Übersicht + je Raum ein Dashboard, übersetzt technische Namen (`niceName`), übernimmt den Stil vorhandener Dashboards. UI: `components/Suggest.vue`.
- **Einsatzmonitor** (`modules/alarm.js`): Webhook `/api/v1/alarm/hook/<secret>` (GroupAlarm, DIVERA, alamos), Vollbild-Alarm `components/alarm/AlarmLayer.vue`.
- **Health/Auto-Fix** (`system/health.js`): überwacht Pi, startet Kiosk neu, räumt auf.
- **Live-Werte:** WebSocket `/api/v1/events` → `web/src/devices.js` (listeners).

## Testen vor jedem Push
```bash
cd homeos/server && npm test          # muss "fail 0" zeigen
cd homeos/web && npx vite build       # muss ohne Fehler bauen
cd homeos && ./dev.sh                 # lokal starten: http://localhost:5173 (admin / admin12345)
```

## Veröffentlichen (Update kommt automatisch aufs Dashboard)
```bash
git pull                                # immer zuerst
git add -A && git commit -m "Kurze Beschreibung"
git push                                # Branch: claude/zen-cray-34x5xu
```
- GitHub testet und baut daraus das Release `core-vX.Y.Z.N`.
- Der Pi installiert es innerhalb von 30 Minuten (oder sofort: Einstellungen → Update → „Jetzt prüfen“).
- Schlägt der Health-Check nach dem Update fehl, setzt der Pi automatisch auf die alte Version zurück.
- Nur die Branches `main` und `claude/zen-cray-34x5xu` lösen Updates aus.

## Lokale KI (Mac, 48 GB RAM)
- Modell: **Qwen3-Coder-30B-A3B (MLX 4bit)** in LM Studio, Agent in **LM Studio Bionic** mit Ordner `~/Lokale KI/Dashboard`.
- Einstellungen: Context 65536, Temperature 0.2, Top K 20, Top P 0.8, Repeat Penalty 1.05, Max Concurrent 1, Preserve Thinking aus, Prompt Disk Cache an.
- Für große Umbauten lieber die Cloud-KI nutzen; lokal für kleine, klar umrissene Änderungen.
