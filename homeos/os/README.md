# SmartBoard OS (Gerät)

Display-Betriebssystem: Debian / Raspberry Pi OS + Wayland-Kiosk (`cage` + Chromium) + SmartBoard Core als Systemdienst.

## Variante A – fertiges Image (Raspberry Pi 4/5)

1. GitHub → **Releases** → neueste `SmartBoard OS x.y.z` → `smartboard-os-…-rpi-arm64.img.xz` laden
2. Mit **Raspberry Pi Imager** → „Eigenes Image“ auf SD-Karte/SSD schreiben (optional WLAN dort voreinstellen)
3. Pi mit Touch-Display/Monitor starten → **Ersteinrichtung** direkt am Display (Admin anlegen, PIN)
4. Einstellungen → Netzwerk → WLAN wählen (Bildschirmtastatur)

## Variante B – Installer (Raspberry Pi OS Lite, Debian 12/13, Intel N100 / beliebiger PC)

```
curl -fsSL https://raw.githubusercontent.com/shwowak/test/claude/zen-cray-34x5xu/homeos/os/install.sh | sudo bash
```

Am Ende werden Adresse und Admin-Passwort angezeigt. Optionen: `--password`, `--hostname`, `--no-kiosk`, `--token` (privates Repository).

## Was installiert wird

| Teil | Umsetzung |
|---|---|
| Anzeige | `smartboard-kiosk.service`: cage (Wayland) + Chromium-Kiosk auf tty1, Neustart bei Absturz |
| Core | `smartboard-core.service` (Node 22, Benutzer `smartboard`, Daten `/var/lib/smartboard`) |
| Hardware | NetworkManager (WLAN/LAN), BlueZ (Bluetooth), PipeWire (Audio), Backlight-sysfs + DDC/CI (Helligkeit, Ein/Aus), wlr-randr (Drehung) – Rechte per polkit/udev, kein root |
| Updates | `smartboard-update.timer` täglich: neue Core-Version laden → Prüfsumme (+ Signatur, falls `/etc/smartboard/update.pub`) → parallel installieren → umschalten → Health-Check → bei Fehler **automatischer Rollback**. Debian-Sicherheitsupdates über unattended-upgrades |
| Sicherheit | nftables: nur LAN darf auf Port 80/8080/22; Plugins ohne Internet-Recht laufen ohne Netzwerk (eigener Network-Namespace) |
| Netzwerk | erreichbar als `http://smartboard.local` (Avahi/mDNS), Port 80 → 8080 |

## Update-Signatur (optional, empfohlen)

```
openssl genpkey -algorithm ed25519 -out update.key
openssl pkey -in update.key -pubout -out update.pub
```

- `update.key` → GitHub → Settings → Secrets → Actions → `UPDATE_SIGNING_KEY`
- `update.pub` → auf dem Gerät nach `/etc/smartboard/update.pub` (dann werden nur signierte Updates installiert)

## Grenzen (Stand Phase 5)

- Updates tauschen den SmartBoard-Core (A/B auf Anwendungsebene mit Rollback). Vollständige OS-A/B-Updates (RAUC) folgen, sobald die Serien-Hardware feststeht.
- Bluetooth-Kopplung ohne PIN-Eingabe (Lautsprecher, Kopfhörer, die meisten Tastaturen). Geräte mit PIN-Abfrage folgen.
- Image-Build aktuell nur Raspberry Pi (arm64). x86 (N100) über den Installer.
