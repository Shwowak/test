# SmartBoard Plugin-SDK

## Aufbau

```
mein-plugin/
  manifest.json      Pflicht
  backend.js         optional – läuft isoliert auf dem SmartBoard
  ui/widget.html     Widgets (iframe, Sandbox)
```

Beispiel: [`example/`](example)

## manifest.json

| Feld | Bedeutung |
|---|---|
| `id` | `hersteller.name` (klein, Punkte), eindeutig |
| `version` | SemVer `1.2.3` |
| `name`, `description` | Text oder `{ "de": "…", "en": "…" }` |
| `icon` | ein Zeichen/Emoji |
| `permissions` | `internet`, `location`, `storage`, `notifications`, `devices:read`, `devices:control`, `calendar` |
| `backend` | Pfad zur Backend-Datei |
| `config` | Einstellungsfelder: `{ key, type, label, default, options }` – Typen `text`, `password`, `number`, `bool`, `select`, `device`, `devices`, `list` |
| `widgets` | `{ id, name, ui, minSize: [w, h] }` |

## Backend-API (`sdk`)

Der Code läuft wie in einer `async`-Funktion (Top-Level-`await` erlaubt). Kein `require`, kein `eval`, kein Dateisystem.

| Aufruf | Berechtigung |
|---|---|
| `sdk.config`, `sdk.lang`, `sdk.permissions`, `sdk.manifest` | – |
| `sdk.publish(key, data)` → Daten an die eigenen Widgets (live) | – |
| `sdk.onAction(name, async payload => result)` → von der UI aufrufbar | – |
| `sdk.onConfig(cfg => …)` → Einstellungen geändert | – |
| `sdk.every(sekunden, fn)` → sofort + wiederholt (min. 10 s), gibt Stop-Funktion zurück | – |
| `sdk.log(text)` → Protokoll | – |
| `sdk.fetch(url, { method, headers, body, timeout })` → `{ ok, status, text(), json() }` (max. 5 MB) | `internet` |
| `sdk.location()` → `{ lat, lon, name, timezone }` | `location` |
| `sdk.storage.get/set/delete(key)` (max. 5 MB) | `storage` |
| `sdk.notify({ level: 'info'\|'warning'\|'critical', title, message })` | `notifications` |
| `sdk.devices.list()`, `sdk.devices.get(id)`, `sdk.on('device.state', fn)` | `devices:read` |
| `sdk.devices.command(id, capability, value)` | `devices:control` |

## UI-API (`SmartBoard`)

```html
<meta name="color-scheme" content="dark">
<script src="/api/v1/plugins/sdk.js"></script>
<script>
  SmartBoard.onData((data, changedKey) => { /* data = alles, was das Backend publiziert hat */ })
  SmartBoard.action('name', payload).then(result => …)
  SmartBoard.ready(state => state.lang)          // Sprache, Theme
  SmartBoard.t({ de: 'Hallo', en: 'Hello' })
</script>
```

CSS-Variablen des aktiven Themes stehen bereit: `--text`, `--dim`, `--cyan`, `--violet`, `--magenta`, `--gold`, `--ok`, `--warn`, `--err`, `--font`.
Die UI darf nichts aus dem Internet laden (CSP) – Daten immer über das Backend holen.

## Packen & signieren

```
cd sdk && npm install
node sbp.mjs keygen --out meinname            # einmalig: meinname.key (geheim) + meinname.pub
node sbp.mjs pack ../mein-plugin --key meinname.key
```

Den Inhalt von `meinname.pub` auf dem SmartBoard unter **Einstellungen → Plugins → Vertrauenswürdige Schlüssel** eintragen. Danach `.sbp` dort hochladen.
Ohne Signatur fragt das SmartBoard vor der Installation nach.
