# HomeOS

Selbst gehostetes Touch-Dashboard für Zuhause (Phase 1). Plan: `../docs/home-dashboard-plan.md`.

## Start (Docker)

```
cp .env.example .env      # Passwort setzen
docker compose up -d --build
```

Aufrufen: `http://<server>:8080` · Anmeldung mit `HOMEOS_ADMIN_USER` / `HOMEOS_ADMIN_PASSWORD` (wird nur beim ersten Start angelegt).

## Automatische Updates (empfohlen)

Jeder Push nach GitHub baut per GitHub Actions ein Image `ghcr.io/shwowak/homeos:latest`. Watchtower auf dem Server prüft alle 5 Minuten und aktualisiert den Container automatisch (Daten bleiben im Volume).

Einmalig auf dem Server:

```
mkdir homeos && cd homeos
curl -fsSLO https://raw.githubusercontent.com/shwowak/test/claude/zen-cray-34x5xu/homeos/docker-compose.server.yml   # oder Datei kopieren
nano .env                          # HOMEOS_ADMIN_PASSWORD=...
docker login ghcr.io -u <github-user>   # Passwort = Token mit Recht read:packages
docker compose -f docker-compose.server.yml up -d
```

- `docker login` ist nötig, solange das Paket privat ist (GitHub → Packages → homeos → Package settings → ggf. „Public“).
- Update sofort statt nach 5 Min.: `docker compose -f docker-compose.server.yml pull && docker compose -f docker-compose.server.yml up -d`
- Build-Status: GitHub → Actions → „HomeOS Docker Image“.

## Bedienung (Touch)

- Linke Leiste: Dashboards wechseln, Wischen links/rechts wechselt ebenfalls; „⟨ Ausblenden“ versteckt die Leiste, ☰ oben rechts holt sie zurück (wird gemerkt)
- **✎ Bearbeiten**: Widgets verschieben (ziehen), Größe ändern (Ecke unten rechts), ⚙ zum Konfigurieren, „＋ Widget hinzufügen“, „＋ Neu“ für Dashboards
- **Quellen**: Datenquellen anlegen, danach im Widget auswählen
- **◐ Design** wechselt pro Dashboard: Nahtlos (ohne Rahmen), Kacheln (HUD), Glas
- **Vollbild** für Wand-Tablet/Kiosk

## Phase 1 (Kern)

- **API v1**: `/api/v1/…`, OpenAPI-Doku unter `/api/docs`
- **Benutzer & Rollen**: Administrator, Benutzer, Eingeschränkt, Gast · Login per Passwort oder PIN-Ziffernfeld · Sperre nach 10 Fehlversuchen (15 min)
- **Automatische Sicherung bei jeder Änderung**: Einstellungen → Versionen → Wiederherstellen
- **Protokoll**: Kategorien, Stufen, Suche, Zeitraum, Export CSV/JSON
- **Systemstatus**: Version, Laufzeit, CPU, RAM, Speicher, Datenbestand
- **Sprachen**: Deutsch, Englisch (vollständig), Französisch, Spanisch, Italienisch, Niederländisch (Bedienoberfläche) – pro Benutzer wählbar
- Datenbank-Migrationen laufen beim Start automatisch, bestehende Daten bleiben erhalten

## Phase 2 (Geräte)

- **Universal Device API**: alle Geräte einheitlich (Typ, Raum, Gruppen, Funktionen, Zustand, Verbindung, Batterie) – egal ob Home Assistant, MQTT oder REST
- **Integrationen** (Einstellungen → Integrationen): Home Assistant (WebSocket, live), MQTT mit Auto-Discovery (Zigbee2MQTT, Tasmota, ESPHome, Shelly), REST/HTTP (manuelle Geräte) · Verbindung testen vor dem Speichern
- **Automatische Erkennung**: „Neue Geräte gefunden“ → auswählen → hinzufügen, Räume werden aus Home-Assistant-Bereichen übernommen
- **Gerätemanager** (Leiste → Geräte): nach Räumen gruppiert, direkt steuern (Ein/Aus, Helligkeit, Rollladen, Thermostat, Schloss), Details, umbenennen, Raum/Typ/Gruppen ändern, entfernen
- **Räume**: anlegen, umbenennen, Symbol, Reihenfolge
- **Live**: Zustände per WebSocket (`/api/v1/events`) in Echtzeit
- **Widgets**: „Gerät“ und „Raum“ für Dashboards

## Phase 3 (Meldungen & Automationen)

- **Meldungen**: Stufen Info / Warnung / Kritisch / Notfall · Info+Warnung als Toast, Kritisch/Notfall als Vollbild mit „Bestätigen“ (Notfall pulsiert + Alarmton) · Glocke mit Zähler, Meldungszentrale (auch Wischen von oben) · `POST /api/v1/notifications` für externe Systeme
- **Automationen** (Leiste → Regeln): WENN (Uhrzeit, Sonne ± Versatz, Intervall, Gerätezustand, Geräteverbindung, Systemstart) · UND NUR WENN (Zeitraum, Wochentag, hell/dunkel, Gerätezustand) · DANN (Gerät schalten, Meldung mit `{device.name}`/`{value}`, Dashboard zeigen, Display an/dimmen/aus, Ton, Warten, andere Automation)
- Sperrzeit, Schleifenschutz, „Jetzt ausführen“, Verlauf · läuft serverseitig ohne offenes Display
- **Einstellungen → Allgemein**: Standort (für Sonnenauf-/untergang) und Zeitzone

## Phase 4 (Plugins)

- **Plugin-Engine**: jedes Plugin-Backend läuft als eigener Prozess (Node-Permission-Modell: kein Datei-Schreiben, nur Lesen des eigenen Ordners, keine Prozesse) in einem `vm`-Kontext ohne `require`/`eval`. Plugin-UIs laufen in `<iframe sandbox>` mit CSP und sprechen nur über die postMessage-Bridge.
- **Berechtigungen** (im Manifest, einzeln entziehbar): Internet, Standort, Speicher, Meldungen, Geräte lesen, Geräte steuern, Kalender
- **Signaturen**: `.sbp`-Pakete mit Ed25519 signiert; nicht signierte oder unbekannte Schlüssel nur nach Bestätigung; veränderte Pakete werden abgelehnt
- **Verwaltung** (Einstellungen → Plugins): installieren (Datei-Upload), aktivieren/deaktivieren, Berechtigungen, Einstellungen, neu starten, entfernen, Status; Absturz → automatischer Neustart (max. 5×)
- **Widget-Typ „Plugin“**: jedes Plugin-Widget auf jedes Dashboard
- **Mitgeliefert**:
  - Wetter (Open-Meteo, ohne Schlüssel): „Wetter jetzt“, „Vorhersage“, Unwetter-Meldung
  - Kalender (ICS-Links, Wiederholungen, Erinnerungen): „Termine“
  - Energie (PV · Netz · Batterie · Haus aus beliebigen Geräten): „Energiefluss“, „Energie heute“ (kWh, Autarkie, Kosten)
- **SDK**: `sdk/` – Anleitung, Beispiel-Plugin, Werkzeug `sbp.mjs` (Schlüssel erzeugen, packen, signieren)
- Bekannte Grenze: Netzwerkzugriff ist im Docker-Betrieb nur über die API gesperrt; harte Sperre per Firewall pro Plugin folgt mit Phase 5 (Linux-Image).

## Phase 5 (Smart-Display-OS)

- **Gerät statt Docker**: Raspberry-Pi-Image (Releases) oder Installer für Debian / Pi OS / x86 → startet direkt ins Dashboard (cage + Chromium-Kiosk) – Details: [`os/README.md`](os/README.md)
- **Ersteinrichtung am Display** (Admin + PIN), **Bildschirmtastatur** (DE/EN, Weiter/Absenden)
- **Einstellungen**: Display (Helligkeit, Drehung, automatisch aus/dimmen, Wecken per Touch), Netzwerk (WLAN suchen/verbinden, gespeicherte Netze, Gerätename), Bluetooth (suchen, koppeln, verbinden), Audio (Ausgabe/Mikrofon, Lautstärke, Stumm, Standard, Testton), Update (Kanal, automatisch, jetzt installieren), Neustart/Ausschalten
- **Updates mit Rollback**: GitHub Actions erzeugt bei jeder neuen Version ein Release (Core + Pi-Image); Geräte installieren es, prüfen den Start und springen bei Fehler automatisch zurück
- **Plugins ohne Internet-Recht** laufen auf dem Gerät komplett ohne Netzwerk
- Im Docker-Betrieb bleiben die Hardware-Seiten ausgeblendet (Host verwaltet Netzwerk/Audio)

## Widgets

| Typ | Datenquellen |
|---|---|
| Uhr & Datum, Text, Webseite | – |
| Wert (KPI), Anzeige (Gauge) | Fester Wert, REST/JSON, Home Assistant |
| Diagramm | Fester Wert, REST/JSON (Zahlenliste) |
| Termine | iCal-URL (Google, iCloud, Nextcloud) |
| Schalter | Home Assistant (toggle) |

## Datenquellen

- **Home Assistant**: URL + Long-Lived Access Token (Profil → Sicherheit), im Widget die Entity-ID
- **REST/JSON**: beliebige URL, im Widget JSON-Pfad wie `data.current.temp`
- **iCal**: geheime iCal-Adresse des Kalenders

## Entwicklung

```
cd server && npm i && HOMEOS_ADMIN_PASSWORD=dev npm start
cd web && npm i && npm run dev
```

## Sicherheit

- Nur im LAN betreiben oder über Cloudflare Tunnel + Cloudflare Access; dann `HOMEOS_SECURE_COOKIE=true`
- Zugangsdaten der Quellen liegen in `/data/homeos.db` → Volume sichern und schützen
