# HomeOS

Selbst gehostetes Touch-Dashboard für Zuhause (Phase 1). Plan: `../docs/home-dashboard-plan.md`.

## Start (Docker)

```
cp .env.example .env      # Passwort setzen
docker compose up -d --build
```

Aufrufen: `http://<server>:8080` · Anmeldung mit `HOMEOS_ADMIN_USER` / `HOMEOS_ADMIN_PASSWORD` (wird nur beim ersten Start angelegt).

## Bedienung (Touch)

- Linke Leiste: Dashboards wechseln, Wischen links/rechts wechselt ebenfalls; „⟨ Ausblenden“ versteckt die Leiste, ☰ oben rechts holt sie zurück (wird gemerkt)
- **✎ Bearbeiten**: Widgets verschieben (ziehen), Größe ändern (Ecke unten rechts), ⚙ zum Konfigurieren, „＋ Widget hinzufügen“, „＋ Neu“ für Dashboards
- **Quellen**: Datenquellen anlegen, danach im Widget auswählen
- **◐ Design** wechselt pro Dashboard: Nahtlos (ohne Rahmen), Kacheln (HUD), Glas
- **Vollbild** für Wand-Tablet/Kiosk

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
