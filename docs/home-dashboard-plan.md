# HomeOS – eigenes Zuhause-Dashboard (Planung)

Stand: 2026-10-07 · Status: Konzept, noch kein Code

Ziel: selbst gehostete Software (Docker) für **Smarthome, Familie, Energie, Alltag, Netzwerk- und Firewall-Monitoring** – nicht nur Anzeige, sondern frei konfigurierbar: Dashboards, Felder, Widgets, Datenquellen, Benutzer.

Design-Richtung (Moodboard): dunkel, Glas-Kacheln, Neon-Akzente (Cyan/Magenta/Gold), leuchtende Linien-/Balkendiagramme, Wand-Tablet-tauglich.

---

## 1. Vergleich bestehender Dashboard-Software

| Software | Schwerpunkt | Stärken | Schwächen für unser Ziel |
|---|---|---|---|
| **Home Assistant** (Lovelace) | Smarthome | 3.000+ Integrationen, Automationen, Energie-Dashboard, frei konfigurierbare Karten | Familie/Alltag schwach, Netzwerk/Firewall nur über Add-ons, Bedienung komplex |
| **Homepage** (gethomepage) | Homelab-Startseite | 100+ Service-Widgets (Proxmox, OPNsense, Docker), YAML, schnell | nur Anzeige, keine Termine/Familie, Konfiguration per Datei |
| **Homarr** | Homelab-Startseite | Drag & Drop im Browser, Benutzer, Widgets (Kalender, Wetter, Docker) | wenig Tiefe bei Energie/Netzwerk, kein eigenes Datenmodell |
| **Dashy** | Startseite/Links | Themes, Status-Checks, viele Widgets | primär Link-Sammlung |
| **Glance** | Feed-Dashboard | sehr leicht, RSS/Wetter/Kalender | nur lesen, YAML |
| **Heimdall / Organizr** | App-Launcher | einfach | kaum Daten-Widgets |
| **Grafana** | Metriken | beste Diagramme, Alarme, viele Datenquellen | kein Alltag/Familie, keine Eingaben, technisch |
| **MagicMirror² / DAKboard** | Wand-Display | Kalender, Wetter, Familie, schön für Wanddisplay | kaum Smarthome-Steuerung, wenig konfigurierbar |
| **Skylight / Hearth / Cozi** | Familien-Organizer | Termine, Aufgaben, Einkauf, Essensplan, Kinder | Cloud-Abo, kein Smarthome/Netzwerk |
| **Uptime Kuma** | Service-Monitoring | Ping/HTTP/DNS-Checks, Statusseiten, Alarme | nur Verfügbarkeit |
| **ntopng / LibreNMS / Zabbix** | Netzwerk | Traffic-Analyse, SNMP, Geräteerkennung | schwer, keine Alltagsfunktionen |
| **OPNsense / pfSense UI, CrowdSec** | Firewall | Regeln, Blocks, IDS-Alarme | eigenes UI, kein Gesamtbild |
| **evcc / Tibber / SolarAssistant** | Energie | PV, Wallbox, dynamische Tarife, Prognosen | nur Energie |

**Erkenntnis:** Kein Produkt deckt alle Bereiche ab. Lücke = **ein** System mit eigenem Datenmodell (Familie/Alltag) + Anbindung an Spezial-Tools statt Neuentwicklung von Integrationen.

**Grundsatz:** Smarthome-Geräte **nicht** selbst ansteuern, sondern **Home Assistant als Geräte-Backend** nutzen (API/WebSocket/MQTT). Netzwerk/Firewall über deren APIs. Eigene Logik nur dort, wo es keine gute Lösung gibt.

---

## 2. Funktionsumfang

### Kern (Plattform)
- Dashboards beliebig anlegen (z. B. „Küche“, „Technik“, „Kinder“), Raster-Layout per Drag & Drop
- Widget-Bibliothek, jedes Widget konfigurierbar (Datenquelle, Farbe, Größe, Einheit, Schwellwerte)
- **Eigene Felder/Datentypen** anlegen (Custom Entities: z. B. „Zählerstand Wasser“, „Haushaltsaufgabe“) mit Formular, Liste, Diagramm
- Datenquellen-Verwaltung (Home Assistant, MQTT, REST, SNMP, Prometheus, iCal/CalDAV)
- Benutzer, Rollen (Admin, Erwachsene, Kinder, Gast), PIN-Login für Wand-Tablet
- Regeln/Benachrichtigungen (Push, E-Mail, ntfy, Telegram)
- Themes (Neon-Dark Standard), Kiosk-Modus, Mobil-Ansicht (PWA)
- Audit-Log, Backup/Export der Konfiguration

### Smarthome
- Geräte schalten/dimmen, Szenen, Räume, Sensoren (Temp, Feuchte, Fenster)
- Kamera-Snapshots, Türklingel-Ereignis
- Anbindung: Home Assistant, MQTT (Zigbee2MQTT, Shelly), optional Hue/Tasmota direkt

### Familie & Alltag
- Gemeinsamer Kalender (CalDAV/Google/iCal, eigener Kalender), Farben je Person
- Aufgaben/To-dos mit Zuständigkeit, wiederkehrend, Punkte für Kinder
- Einkaufsliste, Essensplan, Geburtstage, Abfallkalender
- Pinnwand/Notizen, Wetter, ÖPNV-Abfahrten, Countdown

### Energie
- Strom, Gas, Wasser, PV-Erzeugung, Speicher, Wallbox (Live + Historie)
- Kosten pro Tag/Monat, dynamischer Tarif (Tibber/aWATTar), Prognose
- Verbraucher-Ranking, Grundlast-Erkennung, Monatsvergleich
- Quellen: Home Assistant Energy, Shelly, Smart-Meter (IR-Lesekopf/MQTT), evcc

### Netzwerk-Monitoring
- Geräteliste (neu/unbekannt erkannt), Online-Status, Latenz, Bandbreite je Gerät
- Internet-Speedtest-Verlauf, WAN-Ausfälle
- Service-Checks (HTTP/Ping/DNS) – Uptime-Kuma-Ersatz oder -Anbindung
- Quellen: SNMP, Router-API (FRITZ!Box TR-064, UniFi, OPNsense), ARP/nmap-Scan, Prometheus

### Firewall-Monitoring
- Geblockte Verbindungen (Top-IPs, Länder, Ports), IDS/IPS-Alarme (Suricata)
- Regeländerungen, VPN-Verbindungen (WireGuard), Gateway-Status
- Quellen: OPNsense/pfSense API, Syslog-Empfang, CrowdSec

### Server/Homelab (Bonus)
- Proxmox (VMs, CPU/RAM, ZFS), Docker-Container, Backup-Status, Temperaturen

---

## 3. Architektur

```
Browser / Wand-Tablet / Handy (PWA)
            │  HTTPS (Cloudflare Tunnel / nur LAN)
            ▼
┌─────────────────────── Docker Compose ───────────────────────┐
│ web        Laravel 13 + Filament 5 (Admin/Konfiguration)     │
│            + Vue 3 Dashboard-Frontend (GridStack, ECharts)   │
│ reverb     Laravel Reverb (WebSocket, Live-Werte)            │
│ worker     Horizon-Queue: Collector-Jobs, Regeln, Alarme     │
│ scheduler  zyklische Abfragen (5 s – 1 h)                    │
│ db         PostgreSQL 17 + TimescaleDB (Zeitreihen)          │
│ redis      Cache, Queue, Live-Status                         │
│ mosquitto  MQTT-Broker (optional)                            │
└──────────────────────────────────────────────────────────────┘
      │ Adapter
      ├─ Home Assistant (REST/WebSocket)   ├─ OPNsense/pfSense API
      ├─ MQTT / Shelly / Zigbee2MQTT       ├─ SNMP / FRITZ!Box / UniFi
      ├─ CalDAV / iCal / Google            ├─ Prometheus / Proxmox API
      └─ Tibber / aWATTar / evcc           └─ Syslog / CrowdSec
```

Begründung:
- **Laravel + Filament**: gleicher Stack wie Lichtheck OS → Wiederverwendung von Wissen, schnelle Admin-Oberflächen (Custom Fields, Benutzer, Rechte).
- **TimescaleDB**: Energie- und Netzwerkmesswerte sind Zeitreihen; Kompression + Aggregation in PostgreSQL ohne zusätzliche DB.
- **Adapter-Prinzip**: jede Datenquelle = ein Plugin (Interface `DataSource` → liefert Entities + Werte). Neue Quelle ohne Kernänderung.
- **Reverb**: Live-Updates ohne Polling im Browser.

Datenmodell (Kern):

| Tabelle | Zweck |
|---|---|
| `dashboards`, `widgets` | Layout (Position, Größe, Typ, JSON-Konfiguration) |
| `data_sources` | Verbindung + verschlüsselte Zugangsdaten |
| `entities` | alles Messbare/Schaltbare (Sensor, Gerät, Zähler, Custom) |
| `entity_types`, `custom_fields` | selbst definierte Felder/Typen |
| `measurements` (Hypertable) | Zeitreihenwerte |
| `events`, `calendars`, `tasks`, `shopping_items` | Familie/Alltag |
| `rules`, `notifications` | Automation/Alarm |
| `users`, `roles`, `households` | Mehrbenutzer |

Widget-Typen: Wert/KPI, Linie, Balken, Gauge/Ring, Schalter, Szene, Kalender, Aufgabenliste, Einkaufsliste, Kamera, Karte/Grundriss, Tabelle, Status-Ampel, Text/Markdown, iFrame.

---

## 4. Sicherheit
- Nur LAN oder Cloudflare Tunnel + Cloudflare Access, keine Portfreigabe
- Zugangsdaten der Datenquellen verschlüsselt (Laravel `encrypted` cast)
- Schaltbefehle nur für berechtigte Rollen, Kinder-Rolle ohne Technik-Bereich
- Firewall-/Netzwerkdaten nur lesen (API-Benutzer mit Read-only-Rechten)

---

## 5. Roadmap

| Phase | Inhalt | Ergebnis |
|---|---|---|
| 1 | Docker-Grundgerüst, Login, Dashboards + Widget-Raster, Theme | leeres, konfigurierbares Dashboard |
| 2 | Familie: Kalender (CalDAV/iCal), Aufgaben, Einkauf, Wetter | Alltags-Dashboard nutzbar |
| 3 | Home-Assistant-Adapter, Schalter/Sensor-Widgets, MQTT | Smarthome steuerbar |
| 4 | Energie: Zeitreihen, Kosten, Tarife, Diagramme | Energieverwaltung |
| 5 | Netzwerk: Gerätescan, Ping/HTTP-Checks, Router-API | Netzwerk-Monitoring |
| 6 | Firewall: OPNsense/pfSense-Adapter, Syslog, Alarme | Firewall-Monitoring |
| 7 | Custom Fields/Typen, Regeln, Benachrichtigungen, Backup | volle Konfigurierbarkeit |

## 6. Offene Punkte
- Vorhandene Geräte: Home Assistant im Einsatz? Router/Firewall (FRITZ!Box, OPNsense, UniFi)? Stromzähler/PV?
- Kalender-Quelle (Google, iCloud, Nextcloud)?
- Anzeige: Wand-Tablet, Handy, PC?
- Name der Software?
