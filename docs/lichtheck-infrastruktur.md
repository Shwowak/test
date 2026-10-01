# Lichtheck OS – Infrastrukturkonzept

Stand: 2026-10-01 · Status: Entwurf, noch nichts installiert

Leitlinie: **Heute 1 Node, einfach betreibbar. Später 2 Nodes + Quorum-Gerät, ohne Umbau.**

Rahmen: ca. 100 Nutzer, eigene Hardware statt VPS.

---

## Standorte

```
Feuerwehrhaus (Produktion)                 Daheim (Backup / Quorum)
┌──────────────────────────────┐           ┌──────────────────────────┐
│ Node 1 ─┐                    │ WireGuard │ PBS-Host                 │
│ Node 2 ─┼─ 10G-Switch ─ USV  │◄─────────►│  ├ Proxmox Backup Server │
│         └─ Router ─ Internet │           │  ├ corosync-qnetd        │
└──────────────┬───────────────┘           │  └ etcd-Witness          │
               │ Cloudflare Tunnel         └────────────┬─────────────┘
           Cloudflare ◄── Nutzer                        │ verschlüsselt
                                             Offsite: Storage Box / S3
```

- Proxmox-Cluster nur an **einem** Standort, weil Corosync < 5 ms Latenz braucht.
- QDevice und etcd-Witness vertragen WAN-Latenz und stehen deshalb daheim → dritte Stimme an einem anderen Ort.
- Keine Portfreigaben: App über Cloudflare Tunnel, Standortkopplung über WireGuard (ausgehend initiiert).
- Vorab klären: Zustimmung Träger/Gemeinde, Raum/Rack/Lüftung, Stromkosten (~10 €/Monat), AV-Vereinbarung für Daten daheim, Upload ≥ 20–50 Mbit/s.

## Hardware (Budget max. 1.500 €, gebraucht)

Für 100 Nutzer reichen Business-Mini-PCs: leise, ~10–20 W, 24/7-tauglich.

| Teil | Modell | Anzahl | ca. € |
|---|---|---|---|
| Node 1 + 2 | Lenovo ThinkCentre M920q, i5-8500T/i7-8700T, 32 GB RAM | 2 | 2 × 220 |
| VM-Storage | Micron 7400 PRO 960 GB M.2 2280 (PLP) | 2 | 2 × 130 |
| Mirror-Partner | Samsung PM893 480 GB SATA (PLP) → ZFS-Mirror mit NVMe | 2 | 2 × 70 |
| 10 GbE (optional) | M920q-PCIe-Riser + Intel X520-DA1/X710 SFP+ | 2 | 2 × 60 |
| Switch | MikroTik CRS305-1G-4S+IN (4 × SFP+) + 3 DAC | 1 | 180 |
| USV | APC Back-UPS Pro 900 (USB → NUT-Shutdown) | 1 | 150 |
| PBS daheim | 3. M920q oder gebrauchter Office-PC + 2 × 4 TB HDD (Mirror) | 1 | 250 |
| **Summe mit 10 GbE** | | | **≈ 1.500** |
| **Summe ohne 10 GbE** | 1 GbE reicht für 100 Nutzer, später nachrüstbar | | **≈ 1.200** |

Abweichung vom Auftrag: 10 GbE optional statt Pflicht. Bei 100 Nutzern ist 1 GbE kein Engpass; ZFS-Replikation und Corosync laufen problemlos.

Grenzen: 1 CPU, kein ECC-RAM, kein BMC/IPMI, 1 Netzteil → Ausfall eines Nodes wird durch den 2. Node abgefangen. Bei Wachstum Upgrade auf EPYC-Server (H12SSL-i) ohne Architekturänderung.

Ausbaureihenfolge: Node 1 + PBS + Switch + USV → Go-Live → Node 2 → Cluster/HA.

---

## Phase 1 – Anforderungen

| Bereich | Anforderung | Konsequenz |
|---|---|---|
| Daten | Verlust inakzeptabel (Einsätze, Mitglieder, Hydranten) | RPO ≤ 5 min, PITR |
| Verfügbarkeit | Einsatzrelevant, aber kein Rechenzentrumsbetrieb | RTO: Phase 1 ≤ 4 h, Phase 2 ≤ 5 min |
| Schreiblast | Viele Clients (iOS, Android, Web, GroupAlarm, Jobs) schreiben parallel | SQLite (1 Writer) ersetzen |
| Betrieb | Kleines Team | Keine Komponente ohne klaren Nutzen |
| Zugriff | Nur über Cloudflare Tunnel | 0 offene Ports eingehend |

**Kernproblem SQLite:** pro Datenbank ist nur ein Schreiber gleichzeitig möglich (`database is locked`), kein Netzwerkzugriff, keine Replikation. Damit sind weder mehrere App-Instanzen noch HA möglich.

---

## Phase 2 – Single Points of Failure

| SPOF | Phase 1 (1 Node) | Lösung Phase 2 |
|---|---|---|
| Proxmox-Host | bleibt SPOF → Backup + Restore-Plan | 2. Node + QDevice |
| Festplatte | ZFS-Mirror | ZFS-Mirror |
| Datenbank | 1 Instanz + WAL-Archiv | Streaming-Replica + Patroni |
| App-VM | Proxmox-Neustart / Restore | Proxmox HA + ZFS-Replikation |
| Docker-Container | `restart: unless-stopped` + Healthcheck | gleich |
| Redis | AOF-Persistenz | gleich (Neuaufbau unkritisch, siehe Phase 4) |
| Cloudflare Tunnel | 1 Connector | 2 Connectoren (1 je Node) |
| Switch / Uplink | SPOF (akzeptiert) | 2. Switch, LACP/Active-Backup |
| Strom | USV | USV je Node |
| Standort | Offsite-Backup | Offsite-Backup (kein Geo-HA geplant) |

---

## Phase 3 – Datenbankvergleich

### Bewertung (++ sehr gut, + gut, o neutral, – schwach)

| Kriterium | PostgreSQL 17/18 | MariaDB 11 (InnoDB) | MySQL 8.4 | CockroachDB |
|---|---|---|---|---|
| Parallele Writes | ++ MVCC, Zeilensperren, Leser blockieren Schreiber nie | + MVCC, aber Gap-/Next-Key-Locks → mehr Deadlocks | + wie MariaDB | o verteilt, aber jeder Write mit Konsens-Latenz |
| Locking-Verhalten | ++ vorhersehbar, `SKIP LOCKED` | + `SKIP LOCKED` vorhanden | + | – Retries (Fehler 40001) in der App nötig |
| Transaktionen | ++ inkl. **transaktionaler DDL** (Migration rollt komplett zurück) | o DDL nicht transaktional | o | ++ Serializable |
| Horizontale Write-Skalierung | o (vertikal + Partitionierung, später Citus) | o Galera skaliert Writes **nicht** (Zertifizierungskonflikte) | o | ++ einzige echte |
| Replikation/Failover | ++ Streaming + Patroni | + Replikation, Galera, MaxScale | + Group Replication | ++ eingebaut |
| PITR | ++ WAL-Archiv, pgBackRest | + Binlog, umständlicher | + | + nur Enterprise-Features |
| Laravel 13 / Filament | ++ offiziell | ++ offiziell | ++ offiziell | – kein offizieller Treiber, pgsql-Treiber mit Lücken |
| Migration von SQLite | + strikter Typen → findet Datenfehler | + tolerant (verdeckt Fehler) | + | – |
| Ressourcen | + | + | + | – mind. 3 Nodes, viel RAM |
| Lizenz | ++ PostgreSQL License | ++ GPL | o Oracle | – seit 2024 proprietär |
| Betrieb unter Proxmox | ++ | ++ | ++ | o |

### Schreiblast realistisch

- Grenze ist bei Laravel nicht die DB, sondern **Verbindungen, Sperren auf denselben Zeilen und langsame Requests**.
- PostgreSQL auf NVMe mit PLP-SSD (Power Loss Protection): einfache Laravel-Writes (INSERT/UPDATE mit Index) im Bereich **mehrerer tausend Transaktionen/s** auf 8–16 vCPU. Lichtheck braucht bei z. B. 200 Feuerwehren × 50 Mitgliedern in einer Lastspitze (Alarm) geschätzt < 500 Writes/s.
- Faktor gegenüber SQLite: kein globaler Write-Lock mehr. Zwei Rückmeldungen zu unterschiedlichen Einsätzen sperren sich nicht gegenseitig.
- Der Wert wird **nicht übernommen, sondern gemessen**: Lasttest (k6) gegen `/api/v1` mit realem Datenbestand vor Go-Live.

### Entscheidung: **PostgreSQL**

Begründung (nicht „Standard“):
1. MVCC ohne Gap-Locks → weniger Deadlocks bei parallelen Rückmeldungen und Terminzusagen.
2. Transaktionale DDL → fehlgeschlagene Laravel-Migration hinterlässt kein halbes Schema.
3. PITR über WAL ist nativ und mit pgBackRest robust → Priorität 1 (Datensicherheit).
4. Patroni ist ein ausgereifter Weg zu DB-HA auf 2 Nodes + Witness.
5. PostGIS als Option für Hydrantendaten (Umkreissuche, Geometrien).
6. Strikte Typen decken SQLite-Altlasten bei der Migration auf.

Verworfen:
- **MariaDB/MySQL**: gleichwertig nutzbar, aber schwächer bei 2, 3 und 5. Galera löst das Write-Problem nicht.
- **CockroachDB**: würde Write-Skalierung über Nodes bringen, die Lichtheck nicht braucht. Dafür Lizenz, ≥ 3 Nodes, kein offizieller Laravel-Support und Retry-Logik im Code. Der Nutzen ist kleiner als die zusätzliche Komplexität.

### Ergänzende Komponenten

| Komponente | Einsatz | Warum |
|---|---|---|
| Redis | **Ja** | Queue, Cache, Sessions, Locks (`Cache::lock`). Nimmt kurze Schreiblast von der DB. |
| Queue Worker (Horizon) | **Ja** | GroupAlarm, Push-Benachrichtigungen und E-Mail laufen asynchron und kürzen API-Antwortzeiten. |
| PgBouncer (Transaction Pooling) | **Ja, ab Start** | PHP-FPM/Octane-Worker × App-Instanzen übersteigen schnell `max_connections`. Ressourcenarm. |
| Caching (Stammdaten, Hydranten, Rollen) | **Ja** | Lesezugriffe dominieren. |
| Read Replica + getrennte Read/Write-Verbindung | **Später** | erst wenn Monitoring Lese-Engpass zeigt; Laravel unterstützt `read`/`write` nativ. Achtung: Replikationsverzögerung → `sticky => true`. |
| DB-Proxy (HAProxy) | **Phase 2** | leitet zum aktuellen Patroni-Primary (über die REST-API `/primary`). |
| Kubernetes, Ceph, Galera, CockroachDB | **Nein** | kein Nutzen bei dieser Größe. |

---

## Phase 4 – Zielarchitektur

### Ausbaustufe A (Start, 1 Node)

```
Internet → Cloudflare (WAF, Access) → Tunnel
                                        │
┌───────────── Proxmox Node 1 ──────────┼────────────────────┐
│ VM app-1   : cloudflared, nginx, PHP-FPM/Octane, Horizon,  │
│              Scheduler, Redis (AOF)                        │
│ VM db-1    : PostgreSQL, PgBouncer, pgBackRest             │
│ VM mon     : Prometheus, Grafana, Alertmanager, Loki       │
└────────────────────────────────────────────────────────────┘
Separate Hardware: PBS-1 (Backup, später QDevice + etcd-Witness)
Offsite: PBS-Sync-Ziel + pgBackRest S3-Repo (verschlüsselt)
```

Änderungen gegenüber Vorschlag:
- **Backup-VM entfällt** → Proxmox Backup Server läuft auf **eigener Hardware**. Ein Backup auf dem gesicherten Host verschwindet mit dem Host.
- **Management**: kein eigenes VM-Bedürfnis; Admin-Zugriff über WireGuard/Tailscale ins Management-VLAN.
- **Datenbank bleibt eigene VM**, nicht in Docker. Damit sind I/O, Tuning und Patroni später einfacher.

### Ausbaustufe B (2 Nodes + QDevice)

```
            Node 1                      Node 2
   app-1 (HA, Prio Node 1)     app-2 / Failover-Ziel
   db-1  Patroni Primary  ⇄    db-2  Patroni Replica (synchron)
   cloudflared #1              cloudflared #2
            └──── Corosync / Replikation (10 GbE) ────┘
                         │
        PBS-Host: corosync-qnetd + etcd-Witness (3. Stimme)
```

**Zwei HA-Ebenen getrennt:**

| Ebene | Mechanismus | Bei Node-Ausfall |
|---|---|---|
| Proxmox HA | HA-Manager + ZFS-Replikation (alle 1–5 min) | app-VM startet auf Node 2 neu (~2–3 min). Datenverlust nur in der VM, also Uploads seit letzter Replikation → Uploads später nach S3 |
| Datenbank-HA | Patroni + etcd (3 Mitglieder), synchrone Replikation | Replica wird in ~30 s Primary, RPO = 0. **DB-VMs nicht im Proxmox HA**, sondern fest je Node |

Warum nicht DB-VM per ZFS-Replikation verschieben: Es würden bis zu 5 min Transaktionen verloren gehen, und die DB-Dateien wären möglicherweise inkonsistent.

### App aktiv/aktiv (Stufe C, optional)

Voraussetzungen: Sessions/Cache/Queue in Redis (gemeinsam), Uploads in S3-kompatiblem Storage, Scheduler mit `onOneServer()`. Erst umsetzen, wenn Last oder RTO es erfordern.

---

## Phase 5 – Proxmox / VM / Storage

### Host

- Proxmox VE aktuell, Installation auf **ZFS-Mirror** (2 × NVMe Enterprise mit PLP).
- Auf dem Host nur Proxmox, Monitoring-Agent (node_exporter, smartd) und keine Anwendungen.
- No-Subscription- oder Community-Repo, `unattended-upgrades` nur für Security; Kernel-Updates manuell im Wartungsfenster.

### VMs (Startwerte)

| VM | vCPU | RAM | Disk | Hinweis |
|---|---|---|---|---|
| app-1 | 3 | 8 GB | 60 GB | Debian 13, Docker Compose |
| db-1 | 3 | 12 GB | 150 GB | eigenes zvol, `recordsize`/`volblocksize` 16k, `shared_buffers` 25 % RAM |
| mon | 1 | 3 GB | 50 GB | |

VM-Einstellungen: `virtio-scsi-single`, `iothread`, `discard`, `cpu: host`, QEMU-Guest-Agent.

### Storage-Entscheidung

| Option | Bewertung |
|---|---|
| **ZFS-Mirror lokal** | **gewählt**: einfach, schnell, Checksummen, Snapshots, Replikation zwischen Nodes |
| RAIDZ | schlechtere IOPS für DB, kein Vorteil bei 2–4 Disks |
| Shared Storage (NAS/iSCSI) | eigener neuer SPOF |
| Ceph | ≥ 3 Nodes, ideal 25 GbE, viel RAM/CPU, hoher Betriebsaufwand. Erst ab ≥ 3 Nodes mit Live-Failover-Bedarf |

Hardware je Node: siehe Abschnitt „Hardware“ (M920q, 32 GB, NVMe + SATA mit PLP).

### Quorum (Stufe B)

| Variante | Bewertung |
|---|---|
| 2 Nodes ohne Zusatz | ungeeignet: Ausfall eines Nodes = kein Quorum, HA greift nicht |
| 3. vollwertiger Node | teuer, Strom; sinnvoll erst bei Ceph |
| **QDevice (`corosync-qnetd`)** | **gewählt**: läuft auf PBS-Hardware oder Mini-PC, kein Storage nötig |

Derselbe Host stellt das 3. etcd-Mitglied für Patroni. Damit gibt es für **beide** HA-Ebenen eine 3. Stimme.

---

## Phase 6 – Netzwerk & Sicherheit

### VLANs

| VLAN | Zweck | Erreichbar von |
|---|---|---|
| 10 Management | Proxmox-GUI, IPMI, Switch | nur Admin-VPN |
| 20 Cluster | Corosync (eigenes Interface, 2. Ring über VLAN 10) | nur Nodes |
| 30 Replikation/Storage | ZFS-Replikation, Migration, PG-Streaming | nur Nodes/DB |
| 40 Server | App-VMs | Cloudflare Tunnel ausgehend |
| 45 Datenbank | DB-VMs | nur VLAN 40 Port 6432/5432, Monitoring |
| 50 Backup | PBS | Nodes, DB (pgBackRest) |
| 60 Monitoring | Prometheus/Grafana | scrapt alle VLANs |

- 2 × 10 GbE SFP+: Bond oder Trennung (1 × VM/Management, 1 × Cluster/Replikation).
- Corosync braucht niedrige Latenz → nicht über einen ausgelasteten Replikationslink allein führen.

### Internetzugriff

- Eingehend: **keine Portfreigaben**. Nur `cloudflared` (ausgehend 7844).
- `lichtheck.example.de` → Tunnel → nginx in app-VM.
- `/admin` (Filament) zusätzlich hinter **Cloudflare Access** (SSO/OTP).
- `/api/v1` ohne Access, dafür Sanctum-Token, Rate-Limiting (Laravel + Cloudflare WAF-Regeln).
- Grafana und Proxmox nur über VPN, optional Cloudflare Access mit Gerätezertifikat.

### Härtung

- SSH: nur Keys, `PermitRootLogin no`, eigener Admin-User mit `sudo`, nur aus VLAN 10.
- Proxmox: 2FA (TOTP/WebAuthn), eigene Benutzer statt `root@pam`, PVE-Firewall auf Cluster-, Node- und VM-Ebene, Default-Policy DROP.
- VMs: `unattended-upgrades` (Security), nftables-Regeln, Docker-Ports nicht auf `0.0.0.0` binden.
- PostgreSQL: Rollen `lichtheck_app` (DML), `lichtheck_migrate` (DDL), `readonly`; `pg_hba.conf` nur App-Subnetz, `scram-sha-256`, TLS.
- Secrets: `.env` nicht in Git, Ablage in Passwortmanager (Vaultwarden/1Password), Deployment über CI-Secrets oder SOPS-verschlüsselte Datei.
- Logging: zentral (Loki), Laravel-Logs als JSON, Audit-Log für Rollenänderungen.
- Backups verschlüsselt, PBS-Benutzer der Nodes ohne Lösch-/Prune-Recht (Ransomware-Schutz).

---

## Phase 7 – Backup & Recovery

```
Produktion ──► PBS-1 lokal (separate HW, stündlich VMs) ──► PBS-2 Offsite (Sync, nächtlich)
    │
    └─ PostgreSQL ──► pgBackRest: Repo 1 = PBS-Host-Disk, Repo 2 = S3 Offsite (Object Lock)
                      WAL kontinuierlich (archive_timeout 60 s) → PITR
```

| Ebene | Werkzeug | Intervall | Aufbewahrung |
|---|---|---|---|
| VM komplett | PBS | stündlich app/mon, täglich db | 24 h / 14 d / 8 w / 12 m |
| Datenbank | pgBackRest full/diff + WAL | wöchentlich full, täglich diff, WAL laufend | 4 Wochen PITR, 12 Monatsstände |
| Logischer Dump | `pg_dump -Fc` | täglich | 14 Tage (Schutz gegen Tool-Fehler) |
| Konfiguration | Git (ohne Secrets) + `/etc/pve` Backup | bei Änderung | dauerhaft |
| Secrets/Recovery | verschlüsselter Export: PBS-Keys, pgBackRest-Passphrase, `.env`, Cloudflare-Token | bei Änderung | **Papier + Tresor offline** |

- **Restore-Tests**: monatlich automatisiert (Restore in Test-VM, `php artisan` Smoke-Test, Zeilenzählung), halbjährlich vollständiger Desaster-Test.
- Zielwerte: RPO ≤ 1 min (DB), RTO Einzel-VM ≤ 30 min, Komplettstandort ≤ 1 Arbeitstag.

---

## Monitoring

| Ziel | Werkzeug |
|---|---|
| Proxmox, VMs, ZFS, Temperaturen | `prometheus-pve-exporter`, node_exporter, smartctl_exporter, ZFS-Metriken |
| Docker | cAdvisor |
| PostgreSQL, Replikation, Locks, Deadlocks | postgres_exporter, `pg_stat_statements` |
| Redis, Queue-Länge | redis_exporter, Horizon-Metriken |
| API, Tunnel, Zertifikate | blackbox_exporter (HTTPS-Check von außen), cloudflared-Metriken |
| Backup | PBS-Job-Status, pgBackRest `check`, Alter des letzten Backups |
| Logs | Loki + Promtail |

Alarmierung: Alertmanager → E-Mail + Push (ntfy/Pushover). Kritisch: DB down, Replikationsverzögerung > 60 s, Backup älter als 26 h, Disk > 80 %, ZFS degraded, Tunnel down, Zertifikat < 14 Tage.

---

## Phase 8 – Migration SQLite → PostgreSQL

### Code-Prüfung (vor jeder Datenübernahme)

- [ ] Alle Migrations auf frischer PG-DB ausführen (`migrate:fresh`) → Fehler beheben.
- [ ] `DB::raw`, `whereRaw`, `selectRaw`: SQLite-Funktionen (`strftime`, `julianday`, `ifnull`, `group_concat`) ersetzen.
- [ ] `LIKE` ist in PG case-sensitiv → `ILIKE` bzw. `whereLike(..., caseSensitive: false)`.
- [ ] Booleans: SQLite 0/1 → PG `boolean`; Casts im Model prüfen.
- [ ] String-Längen: SQLite ignoriert `string(50)` → zu lange Werte finden.
- [ ] Fremdschlüssel: in SQLite oft nicht erzwungen → **verwaiste Datensätze** bereinigen.
- [ ] Datumswerte: Formate/Zeitzonen vereinheitlichen (`timestampTz` empfohlen).
- [ ] JSON-Spalten → `jsonb`.
- [ ] Sortierung/Collation (Umlaute) prüfen.
- [ ] Test-Suite (Pest/PHPUnit) in CI gegen PostgreSQL laufen lassen.

### Ablauf

1. Schema per Laravel-Migrations in PG erzeugen (nicht von SQLite übernehmen).
2. Datenexport mit eigenem Artisan-Command (tabellenweise, in Chunks, gleiche IDs) oder `pgloader` mit `data only`.
3. Sequenzen setzen: `SELECT setval(pg_get_serial_sequence(...), max(id))` für alle Tabellen.
4. Prüfung: Zeilenanzahl je Tabelle, Checksummen ausgewählter Spalten, FK-Constraints aktiv.
5. Staging mit Kopie der Produktivdaten: Web, API, iOS, Android (Test-Build auf Staging-URL), GroupAlarm (Testalarm), Lasttest k6.
6. Generalprobe der Umschaltung inklusive Zeitmessung; danach Backup und Restore der neuen DB testen.

### Umschaltung (geringe Ausfallzeit)

1. Ankündigung, Wartungsfenster außerhalb typischer Einsatzzeiten (Erfahrung: < 30 min).
2. Alte Installation `php artisan down` (Read-only) → finaler Export → Import → Prüfskript.
3. Cloudflare-Tunnel-Route auf neue App-VM.
4. Smoke-Tests (Login, API, Push, GroupAlarm).
5. **Fallback**: alte Installation und SQLite-Datei bleiben unverändert 30 Tage erhalten; Rückweg = Tunnel-Route zurück. Ab Go-Live geschriebene Daten fehlen dort → Rückweg nur in den ersten Stunden sinnvoll.

Go-Live-Freigabe nur bei erfüllter Checkliste: DB-Migration ✓, App ✓, API ✓, iOS ✓, Android ✓, GroupAlarm ✓, Backup ✓, Restore ✓.

---

## Ausfallszenarien (Testplan)

| # | Szenario | Stufe A (1 Node) | Stufe B (2 Nodes + QDevice) | Test |
|---|---|---|---|---|
| 1 | Proxmox-Node fällt aus | Ausfall bis Hardware repariert oder Restore auf Ersatz-HW | app-VM startet auf Node 2 (~3 min), Patroni promotet db-2 (~30 s) | Node hart ausschalten |
| 2 | App-VM fällt aus | Proxmox-Neustart / PBS-Restore (≤ 30 min) | HA-Manager startet VM neu bzw. auf Node 2 | `qm stop` |
| 3 | Container fällt aus | Docker-Restart-Policy + Healthcheck, Sekunden | gleich | `docker kill` |
| 4 | Datenbank fällt aus | App liefert 503, Neustart/PITR-Restore | Patroni-Failover, HAProxy zeigt auf neuen Primary | `systemctl stop patroni` / VM stoppen |
| 5 | Replikation bricht ab | – | Alarm; bei sync-Mode schaltet Patroni auf async (Verfügbarkeit vor RPO=0), Replica per `patronictl reinit` neu | Netz VLAN 30 trennen |
| 6 | Festplatte defekt | ZFS-Mirror läuft degraded weiter, Alarm, Tausch + `zpool replace` | gleich | Disk ziehen |
| 7 | Versehentlich gelöscht | PITR auf Zeitpunkt vor Löschung in Test-DB, Datensätze gezielt zurückspielen | gleich | Testlöschung + Wiederherstellung |
| 8 | Kompletter Server weg | Neuinstallation Proxmox → VMs aus PBS → DB per pgBackRest auf letzten WAL-Stand | übernimmt 2. Node | jährlicher DR-Test |
| 9 | Standort weg | Ersatz-HW/Cloud-VM → PBS-2 Offsite + S3-Repo → Tunnel neu verbinden (DNS bleibt bei Cloudflare) | gleich | jährlich, Runbook mit Zeitmessung |

---

## Phase 9 – Umsetzungsreihenfolge

1. Hardware: Node 1 + PBS-Host + Switch (10 GbE SFP+) + USV.
2. Proxmox, ZFS, VLANs, Firewall, 2FA, VPN.
3. db-1 (PostgreSQL + PgBouncer + pgBackRest) → Backup/Restore testen.
4. app-1 (Docker, Redis, Horizon, cloudflared) → Staging.
5. Monitoring + Alarme.
6. Migration (Phase 8) → Go-Live.
7. Später: Node 2, QDevice, Patroni, Proxmox HA → Tests 1–5 wiederholen.

## Offene Punkte

- Aktuelle Nutzerzahlen / Spitzenlast (Requests/s) → Basis für Lasttest.
- Laravel-Laufzeit: PHP-FPM oder Octane?
- Uploads (Dateien/Bilder) vorhanden und Menge?
- Budget Hardware und Offsite-Ziel (zweiter Standort, Hetzner, S3-Anbieter).
- Datenschutz: AV-Vertrag mit Cloudflare und Offsite-Anbieter (Mitgliederdaten, DSGVO).
