# SmartBoard OS – Punkt 1: Technische Architektur

Stand: 2026-10-08 · Status: Konzept · Basis: bestehender Prototyp `homeos/`

Ziel: kommerziell verkaufbares, modulares **Smart Display Operating System** – hardwareunabhängig, Local First, Touch First, Secure by Design, API First.

---

## 1. Grundentscheidungen

| Thema | Entscheidung | Begründung |
|---|---|---|
| Basis-OS | **Debian 13 minimal** (arm64 + amd64), später eigenes Image mit **A/B-Partitionen** | breite Hardware-Unterstützung (Pi 5, Rockchip, Intel N100, x86-Panel-PCs), langfristige Security-Updates |
| Image-Bau | `mkosi` bzw. Debian-`debos` → reproduzierbare Images je Board | ein Rezept, mehrere Zielgeräte |
| Anzeige | **Wayland-Kiosk-Compositor `cage`** + **Chromium/WPE WebKit** im Kiosk | robust, GPU-beschleunigt, Multi-Touch, keine Desktop-Umgebung |
| UI | **Vue 3 + TypeScript** (bestehender HomeOS-Code), ECharts, GridStack | vorhanden, Touch-fähig, Plugins als Web-Komponenten |
| Kern-Dienst (`sbd`) | **Node.js/TypeScript** (Fastify) → später performancekritische Teile in **Rust** | gleiche Sprache wie UI und Plugin-SDK, schnelle Entwicklung |
| Hardware-Zugriff | ausschließlich über **System-Daemons per D-Bus**: NetworkManager, BlueZ, PipeWire/WirePlumber, UPower, logind, udisks2, ModemManager | Standard-Linux-Schnittstellen statt eigener Treiber → hardwareunabhängig |
| Datenbank | **SQLite** (WAL) lokal, optional PostgreSQL für Multi-Board-Server | Local First, kein Server nötig |
| Nachrichtenbus | interner **Event-Bus** (in-process) + **MQTT (Mosquitto)** nach außen | Geräte-/Plugin-Ereignisse einheitlich |
| Container | Kern **nicht** in Docker; Protokoll-Bridges (Zigbee2MQTT, Z-Wave JS, Matter Server) optional als Container (Podman) | Kern muss vor allem anderen starten, Bridges isoliert |
| Updates | **RAUC** (signierte A/B-Updates, Rollback) | bewährt im Embedded-Bereich, Recovery eingebaut |
| Lizenz/Distribution | Kern proprietär, nur Komponenten mit kompatibler Lizenz (MIT/Apache/LGPL dynamisch), GPL-Teile als separate Prozesse | kommerzieller Verkauf |

```
┌──────────────────────── UI (Chromium Kiosk, Vue) ────────────────────────┐
│ Dashboards · Widgets · Plugin-UIs (Sandbox) · Einstellungen · Admin      │
└───────────────▲─────────────────── HTTPS/WebSocket (SmartBoard API) ─────┘
┌───────────────┴──────────────── sbd (Core Daemon) ───────────────────────┐
│ Users/Auth · Permissions · Notifications · Automation · Storage · Logs   │
│ Device Engine (Universal Device API) · Plugin Engine · AI Engine         │
│ Update Agent · Backup · Diagnostics · Multi-Board Sync                   │
└──▲──────────▲──────────▲──────────▲──────────▲──────────▲────────────────┘
   │D-Bus     │D-Bus     │D-Bus     │MQTT/WS   │HTTP      │Unix-Socket
NetworkMgr  BlueZ    PipeWire   Bridges    Ollama/LLM   Hardware-Agent
(WLAN/LAN)  (BT/BLE) (Audio)    Matter·Zigbee·Z-Wave·KNX·Modbus  (Display/Backlight/Kamera)
```

---

## 2. Anforderungen → Umsetzung

### 2.1 Display, Touch, Gesten, Energie (Punkte 1, 14, 15, 34, 35)

| Anforderung | Umsetzung |
|---|---|
| HDMI/DP/USB-C, Auflösung, Mehrfach-Display, Erkennung | DRM/KMS über Compositor; Hotplug via udev → `wlr-randr`-Schnittstelle; je Display eigene Dashboard-Zuordnung |
| Rotation automatisch | Beschleunigungssensor (iio-sensor-proxy) → Compositor-Transform; manuell pro Display |
| Helligkeit auto/manuell, dimmen | `/sys/class/backlight` (intern), **DDC/CI** (`ddcutil`) für externe Monitore; Lichtsensor über iio |
| Ein/Aus, Nachtmodus, Always-On, Screensaver | DPMS über Compositor; Zeitpläne in Automation Engine; Nachtmodus = Theme + Helligkeit |
| Wake-on-Touch/Proximity/LAN | Touch-Event weckt DPMS; PIR/Radar-Sensor (mmWave) oder Kamera-Präsenz; WoL via NetworkManager |
| Multi-Touch, Pinch, Long-Press, Gesten | Pointer Events im Browser; zentrale Gesten-Bibliothek (Wischen ↔ Dashboard, oben → Benachrichtigungen) für Kern **und** Plugins |
| Virtuelle Tastatur | eigene On-Screen-Tastatur in der UI (sprachabhängige Layouts) |
| Kiosk-Modus | Kiosk-Profil: festes Dashboard/App, gesperrte Navigation, Admin-PIN zum Verlassen, Watchdog startet UI neu |

### 2.2 Netzwerk (Punkt 2)

- **NetworkManager über D-Bus** deckt WLAN 2,4/5/6/6E/7 (abhängig von Treiber/Chip), Ethernet, IPv4/IPv6, DHCP/statisch, DNS, Proxy, VPN (WireGuard/OpenVPN) ab.
- Firewall: **nftables** mit vordefinierten Profilen (Standard: nur Admin-UI im LAN, mDNS).
- mDNS/Bonjour: **Avahi** (Gerät als `smartboard-<name>.local` auffindbar).
- UPnP: nur Discovery (SSDP) für Geräteerkennung, **kein** automatisches Port-Öffnen.
- Netzwerkfreigaben: SMB/NFS-Client über udisks2/gvfs für Medien & Backups.
- Diagnose-Seite: IP, Gateway, DNS, Ping, Internet-Test, Speedtest, RSSI, Paketverlust, Ereignisprotokoll; automatische Wiederverbindung durch NetworkManager.

### 2.3 Bluetooth (Punkt 3)

- **BlueZ über D-Bus**: Classic + BLE, Pairing-Agent mit PIN-Dialog in der UI.
- Audio über **PipeWire** (A2DP, HFP für Mikrofon), HID (Tastatur/Maus/Fernbedienung) automatisch.
- BLE-Sensoren/Beacons: Scanner im Device Engine → als Geräte/Präsenz verfügbar.
- Geräteliste, gespeicherte Geräte, Auto-Connect, RSSI, Infos.

### 2.4 USB, Speicher, Dateisystem (Punkte 4, 32, 33)

- **udev + udisks2**: Erkennung Sticks/SSD/Kameras/Audio/Touch/Netzwerk/BT-Adapter; Ereignis „Neues Gerät“ in der UI.
- Treiber kommen vom Kernel; der Kern ordnet Geräteklassen zu (Speicher, Kamera, Audio …).
- Datenbereiche strikt getrennt:

| Bereich | Pfad | Zugriff |
|---|---|---|
| System (read-only, A/B) | `/` | nur Update-Agent |
| Konfiguration & Benutzerdaten | `/data/core` | Core |
| Plugin-Daten | `/data/plugins/<id>` | nur das jeweilige Plugin |
| Cache | `/data/cache` | löschbar |
| Logs | `/data/logs` | Core, rotierend |
| Backups | `/data/backups` | Core |
| Medien | `/data/media` | mit Berechtigung `media` |

- Speicherübersicht (frei/belegt/Cache/Logs/Medien/Backups) in Diagnose.

### 2.5 Audio (Punkt 5)

- **PipeWire + WirePlumber**: alle Ausgänge (intern, HDMI, USB, BT, Klinke), mehrere Mikrofone, Prioritäten/automatische Auswahl.
- Lautstärke, Mute, Equalizer (PipeWire-Filter-Chain), Testton.
- Echo Cancellation & Noise Reduction: PipeWire-Modul `echo-cancel` (WebRTC-AEC).
- Vorbereitung Sprache: Wake Word (openWakeWord), STT (Whisper.cpp lokal), TTS (Piper) – alles lokal.

### 2.6 Kamera (Punkt 6)

- **go2rtc** als Medien-Gateway: USB (V4L2), RTSP, ONVIF, HomeKit-Kameras → WebRTC ins UI (niedrige Latenz).
- Snapshot, Aufnahme (Ringpuffer auf `/data/media`), Auflösung/FPS.
- Erkennung später: Bewegung (go2rtc/ffmpeg), Personen/Paket/Haustier über **Frigate-kompatible** Detektoren oder ONNX-Modelle (lokal).
- Türklingel/Videotelefonie: WebRTC (SIP-Gateway optional).
- **Datenschutz**: Kamera/Mikrofon standardmäßig **aus**; Hardware-Status-Indikator in der Statusleiste; Gesichtserkennung nur opt-in, Daten bleiben lokal; Berechtigung pro Plugin.

### 2.7 Smart-Home & Universal Device API (Punkte 7–10)

**Adapter-Prinzip**: jedes Protokoll = Adapter, der Geräte in das einheitliche Modell übersetzt.

| Protokoll | Adapter | Hinweis |
|---|---|---|
| MQTT, HTTP/REST, WebSocket | im Kern | Basis |
| Home Assistant | im Kern (WebSocket-API) | schnellster Weg zu >3000 Integrationen |
| Matter / Thread | **python-matter-server** (Container) + Thread-Border-Router (OTBR, USB-Funkstick) | Matter-Controller-Zertifizierung für Verkauf prüfen |
| Zigbee | **Zigbee2MQTT** (Container) + USB-Koordinator | |
| Z-Wave | **Z-Wave JS** (Container) | |
| KNX | knxd / KNX-IP | |
| Modbus TCP | Adapter mit Geräteprofilen (Wechselrichter, Wallbox) | |
| Apple Home | **HomeKit-Bridge** (HAP) – SmartBoard stellt Geräte bereit | kommerziell: MFi/Matter beachten |
| Google Home / Alexa | über **Matter** (bevorzugt) oder Cloud-Skill | Cloud-Skill benötigt Cloud-Dienst |

Einheitliches Gerätemodell (Auszug):

```ts
interface Device {
  id: string; name: string; manufacturer?: string; model?: string
  room?: string; groups: string[]
  adapter: 'mqtt' | 'matter' | 'zigbee' | 'zwave' | 'knx' | 'modbus' | 'rest' | 'ha' | 'ble'
  connection: 'online' | 'offline' | 'unknown'; battery?: number; rssi?: number
  type: 'light' | 'switch' | 'outlet' | 'thermostat' | 'heating' | 'cover' | 'blind' | 'door' | 'window'
      | 'camera' | 'sensor' | 'smoke' | 'motion' | 'energy_meter' | 'pv' | 'battery' | 'wallbox' | 'vehicle'
  capabilities: Capability[]
}
type Capability =
  | { kind: 'onoff'; value: boolean }
  | { kind: 'brightness'; value: number; min: 0; max: 100 }
  | { kind: 'color'; value: { h: number; s: number } }
  | { kind: 'position'; value: number }
  | { kind: 'temperature_target'; value: number; unit: '°C' }
  | { kind: 'measurement'; quantity: 'temperature' | 'humidity' | 'power' | 'energy' | 'co2' | string; value: number; unit: string }
  | { kind: 'event'; name: string }
```

- Befehle immer gleich: `device.set(id, 'brightness', 30)` – unabhängig vom Protokoll.
- **Gerätemanager**: Suchen, Hinzufügen, Entfernen, Umbenennen, Räume, Gruppen, Testen, Firmware-Info, Status/Verbindung.
- **Automatische Erkennung**: mDNS/SSDP, Matter-Commissioning, MQTT-Discovery (HA-Format), BLE-Scan, ONVIF-Discovery, udev → Karte „Neues Gerät gefunden – Hinzufügen?“.

### 2.8 Plugin-System (Punkte 11–13)

| Aspekt | Umsetzung |
|---|---|
| Paket | `.sbp` = signiertes Archiv: `manifest.json`, UI-Bundle (Web Component), optional Backend (JS/WASM) |
| Laufzeit UI | eigenes `<iframe sandbox>` pro Plugin, Kommunikation nur über `postMessage`-Bridge |
| Laufzeit Backend | **Deno**- oder **WASM**-Isolat mit Berechtigungs-Flags (kein freier Datei-/Netzzugriff) |
| Berechtigungen | im Manifest deklariert, bei Installation angezeigt, einzeln entziehbar: `internet`, `audio`, `camera`, `microphone`, `location`, `contacts`, `calendar`, `devices:read`, `devices:control`, `notifications`, `storage`, `media`, `automation` |
| Verwaltung | Store-UI: installieren, aktivieren/deaktivieren, aktualisieren, entfernen, Rechte ansehen |
| Store | lokaler Katalog + optionaler Cloud-Store; Plugins **signiert** (Entwickler-Schlüssel + Store-Gegensignatur) |
| SDK | `@smartboard/sdk` (TypeScript) mit Typen für alle APIs, Dev-Server mit Hot-Reload |

Beispiel-Manifest:

```json
{
  "id": "com.example.spotify",
  "name": { "de": "Spotify", "en": "Spotify" },
  "version": "1.2.0",
  "permissions": ["internet", "audio"],
  "widgets": [{ "id": "now-playing", "minSize": [3, 2] }],
  "settings": [{ "key": "account", "type": "oauth" }]
}
```

### 2.9 SmartBoard API (Punkt 13)

- **REST + WebSocket**, versioniert (`/api/v1`), OpenAPI-Spezifikation, Token-Auth (Scopes = Berechtigungen).
- Module: Display, Touch, Audio, Camera, Bluetooth, Network, Device, Notification, Calendar, AI, Automation, Storage, User, System.
- Gleiche API für UI, Plugins, Remote-Admin und Drittanbieter.

### 2.10 Benutzer & Erkennung (Punkte 16, 17)

- Rollen: Administrator, Benutzer, eingeschränkt (z. B. Kinder), Gast; feingranulare Rechte darunter.
- Pro Benutzer: Dashboards, Kalender, Widgets, Favoriten, Benachrichtigungen, Sprache, Theme.
- Anmeldung: PIN, Passwort, QR-Code (Smartphone-App), NFC-Tag, BLE-Smartphone in Nähe, Gesichtserkennung (opt-in, lokal).

### 2.11 Benachrichtigungen (Punkt 18)

- Zentrale Notification Engine, Quellen: System, Plugins, Geräte, Automationen.
- Stufen `INFO`, `WARNING`, `CRITICAL`, `EMERGENCY`; ab CRITICAL Overlay über allem, EMERGENCY mit Ton + Display an + volle Helligkeit.
- Verlauf, Quittieren, Stummschalten nach Regeln, Weiterleitung (Push, E-Mail, ntfy, andere Boards).

### 2.12 Automation Engine (Punkt 19)

- Regeln: **Auslöser → Bedingungen → Aktionen**, als JSON gespeichert, grafischer Editor (Touch).
- Auslöser: Zeit, Sonnenauf/-untergang, Bewegung, Gerätestatus, Messwerte (Temp, Strom, PV), Wetter, Benutzer erkannt, Kalender, Netzwerk, Plugin-Ereignis.
- Aktionen: Gerät schalten, Dashboard wechseln, Nachricht, Ton, Plugin, Kamera öffnen, andere Automation, Display/Helligkeit.
- Läuft vollständig lokal, mit Protokoll jeder Ausführung.

### 2.13 KI (Punkt 20)

- AI Engine mit Provider-Schnittstelle: **Ollama**, OpenAI-kompatible APIs (lokal z. B. llama.cpp/vLLM), Cloud optional.
- **Tool Calling**: die KI ruft nur freigegebene API-Funktionen auf (`calendar.today`, `energy.pv_now`, `device.set`, `camera.show`, `weather.forecast`) – gleiche Berechtigungsprüfung wie Plugins.
- Sprache: Wake Word → Whisper (STT) → LLM → Piper (TTS), lokal.
- Hardware-Hinweis: kleine Modelle (3–8B) auf N100/RK3588 möglich; größere über Ollama auf einem Server im Netz (z. B. der geplante AM5-Server).

### 2.14 Cloud, Remote, Multi-Board (Punkte 21, 22, 28)

- **Local First**: alle Grundfunktionen ohne Internet.
- Remote-Admin: lokale Web-Admin-UI (PC/Smartphone im LAN) + optional Cloud-Relay (ausgehende Verbindung, Ende-zu-Ende verschlüsselt).
- Multi-Board: ein Board oder Server ist **Hub**; andere synchronisieren Benutzer, Geräte, Dashboards, Automationen (CRDT-/Event-Log-basierte Replikation), Gruppen-Updates & Backups.
- Cloud-Dienste (optional, kostenpflichtig möglich): Fernzugriff, Backup, Push, Plugin Store, Lizenzen, Flottenverwaltung.

### 2.15 Backup, Updates, Sicherheit, Logging, Diagnose (Punkte 23–27)

| Bereich | Umsetzung |
|---|---|
| Backup | **automatische Sicherung bei jeder Änderung**: jede Konfigurationsänderung (Dashboard, Widget, Gerät, Automation, Benutzer, Plugin) erzeugt eine Version mit Zeitstempel und Benutzer → Rücksprung auf jeden Stand per Touch; dazu verschlüsseltes Archiv (age) aller `/data/*`-Bereiche außer Cache; manuell, zeitgesteuert, lokal/USB/SMB/Cloud; Wiederherstellung mit Vorschau |
| Updates | **RAUC A/B**: OS + Kern als Bundle, signiert; Boot-Zähler → automatischer Rollback; Plugins/Themes separat signiert; Kanäle stable/beta |
| Recovery | Recovery-Partition: Factory Reset, Backup-Restore, Update per USB |
| Sicherheit | Argon2id-Passwörter, PIN mit Sperrzeit, TLS (lokale CA bzw. ACME), API-Tokens mit Scopes, Secrets verschlüsselt (TPM/OP-TEE wenn vorhanden, sonst Schlüsseldatei), nftables, Audit-Log, Login-Protokoll, Secure Boot wo Hardware es erlaubt |
| Logging | strukturiert (JSON) über journald; Kategorien System/Netzwerk/Bluetooth/Plugins/Geräte/Automationen/Benutzer/Sicherheit/Updates/Fehler; UI mit Filter, Suche, Zeitraum, Export |
| Diagnose | CPU, RAM, Speicher, Temperatur, Netzwerk, WLAN, BT, Display, Audio, Kamera, Plugins, Dienste, Updates – mit Ampel und „Problem beheben“-Hinweisen; Diagnose-Paket für Support exportierbar |

### 2.16 Offline, Sprache, Region (Punkte 29–31)

- Offline: Uhr, Dashboards, lokale Geräte, Automationen, lokale KI, Kalender-Cache, Medien, Einstellungen; Online-Funktionen tragen ein Wolken-Symbol und zeigen „offline“.
- i18n: **vue-i18n** + ICU-Messageformat; alle Texte in `locales/*.json`; Start: de, en, fr, es, it, nl; Plugins liefern eigene Übersetzungen.
- Region: Zeitzone (tzdata), Sommerzeit, 12/24 h, Datums-/Zahlen-/Währungsformate (`Intl`), metrisch/imperial.

---

## 3. Referenz-Hardware (für Entwicklung & Zertifizierung)

| Klasse | Beispiel | Einsatz |
|---|---|---|
| Einstieg | Raspberry Pi 5 + offizielles 7"/10" Touch | Entwicklung, Hobby |
| Standard | Rockchip RK3588 (NPU für Kamera-KI) | Serienprodukt |
| Pro | Intel N100/N150 Panel-PC | Gewerbe, mehr Leistung |
| Generisch | beliebiger x86-PC + Monitor | Software-only-Lizenz |

Software bleibt identisch; Unterschiede nur im Board-Profil (Backlight, Sensoren, Rotation).

---

## 4. Roadmap

| Phase | Inhalt | Ergebnis |
|---|---|---|
| 0 ✅ | Prototyp HomeOS: Dashboards, Widgets, Datenquellen, Themes, Touch, Docker, Auto-Update | vorhanden |
| 1 | Core neu strukturieren: Module, API v1 + OpenAPI, Event-Bus, Benutzer/Rollen, i18n, Logging | stabile Basis |
| 2 | Universal Device API + Adapter MQTT, Home Assistant, REST; Gerätemanager, Räume | Smart Home nutzbar |
| 3 | Notification Engine, Automation Engine (UI-Editor) | Kernfunktionen |
| 4 | Plugin Engine (Sandbox, Berechtigungen, SDK), erste Plugins: Wetter, Kalender, Energie | Erweiterbarkeit |
| 5 | Linux-Image: cage + Chromium Kiosk, NetworkManager-, BlueZ-, PipeWire-Integration, Display/Helligkeit, RAUC-Updates | echtes Smart-Display-OS |
| 6 | Kamera (go2rtc), Audio/Sprache, lokale KI mit Tool Calling | Assistenz |
| 7 | Matter/Thread, Zigbee, Z-Wave, KNX, Modbus | Protokollbreite |
| 8 | Multi-Board, Remote-Admin, Cloud-Dienste, Plugin Store, Lizenzen | kommerzielle Plattform |

---

## 5. Risiken für den kommerziellen Verkauf

| Risiko | Maßnahme |
|---|---|
| Matter/Apple/Google/Alexa-Logos & Zertifizierung | Mitgliedschaft CSA bzw. Herstellerprogramme einplanen; bis dahin „kompatibel über Home Assistant/Matter“ ohne Logos |
| Open-Source-Lizenzen (GPL) | Lizenz-Scan in CI (SBOM), GPL-Komponenten nur als eigenständige Prozesse |
| CE/RED, Funkzulassung | bei eigener Hardware Prüflabor; Software-only-Vertrieb zuerst |
| Datenschutz (DSGVO), Kamera/Mikrofon | Privacy by Default, lokale Verarbeitung, Datenschutz-Folgenabschätzung |
| EU Cyber Resilience Act | SBOM, Schwachstellenmanagement, Update-Pflicht über Lebensdauer einplanen |
| Umfang | strikt nach Roadmap, jede Phase lauffähig auslieferbar |
