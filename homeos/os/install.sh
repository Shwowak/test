#!/bin/bash
# SmartBoard OS installer – turns Debian 12/13 or Raspberry Pi OS (arm64/amd64) into a SmartBoard.
#
#   curl -fsSL https://raw.githubusercontent.com/shwowak/test/claude/zen-cray-34x5xu/homeos/os/install.sh | sudo bash
#
# Options:
#   --core <file.tar.gz>   install this core release instead of downloading the latest
#   --repo owner/name      GitHub repository for releases (default shwowak/test)
#   --token <token>        GitHub token (only for private repositories)
#   --password <pw>        initial admin password (default: random, printed at the end)
#   --hostname <name>      device name (default: smartboard)
#   --image                build mode inside a chroot (no service start, no hardware access)
#   --no-kiosk             core only, no display
set -euo pipefail

NODE_VERSION=22.22.2
REPO=shwowak/test
TOKEN=
CORE=
PASSWORD=
HOSTNAME_NEW=smartboard
IMAGE=0
KIOSK=1
SRC=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || echo "")

while [ $# -gt 0 ]; do
  case "$1" in
    --core) CORE=$2; shift 2 ;;
    --repo) REPO=$2; shift 2 ;;
    --token) TOKEN=$2; shift 2 ;;
    --password) PASSWORD=$2; shift 2 ;;
    --hostname) HOSTNAME_NEW=$2; shift 2 ;;
    --image) IMAGE=1; shift ;;
    --no-kiosk) KIOSK=0; shift ;;
    *) echo "unknown option $1" >&2; exit 1 ;;
  esac
done

[ "$(id -u)" = 0 ] || { echo "bitte mit sudo ausführen" >&2; exit 1; }
. /etc/os-release
case "$(uname -m)" in
  aarch64|arm64) ARCH=arm64 ;;
  x86_64|amd64) ARCH=x64 ;;
  *) echo "nicht unterstützte Architektur $(uname -m)" >&2; exit 1 ;;
esac
log() { printf '\n\033[1;36m▶ %s\033[0m\n' "$*"; }

fetch_file() {
  local name=$1 dest=$2
  if [ -n "$SRC" ] && [ -f "$SRC/files/$name" ]; then cp "$SRC/files/$name" "$dest"
  else curl -fsSL "https://raw.githubusercontent.com/$REPO/claude/zen-cray-34x5xu/homeos/os/files/$name" -o "$dest"; fi
}

log "Pakete installieren ($PRETTY_NAME)"
export DEBIAN_FRONTEND=noninteractive
apt-get update -q
PKGS="curl ca-certificates jq xz-utils openssl network-manager bluez pipewire pipewire-pulse wireplumber
  avahi-daemon nftables unattended-upgrades polkitd ddcutil i2c-tools util-linux fonts-noto-color-emoji fonts-dejavu-core"
if [ "$KIOSK" = 1 ]; then
  PKGS="$PKGS cage wlr-randr libinput-bin"
  if apt-cache show chromium >/dev/null 2>&1; then PKGS="$PKGS chromium"; else PKGS="$PKGS chromium-browser"; fi
fi
apt-cache show polkitd >/dev/null 2>&1 || PKGS="${PKGS/polkitd/policykit-1}"
# shellcheck disable=SC2086
apt-get install -y -q --no-install-recommends $PKGS

log "Node.js $NODE_VERSION"
if [ "$(/opt/smartboard/node/bin/node -v 2>/dev/null)" != "v$NODE_VERSION" ]; then
  mkdir -p /opt/smartboard
  curl -fsSL "https://nodejs.org/dist/v$NODE_VERSION/node-v$NODE_VERSION-linux-$ARCH.tar.xz" -o /tmp/node.tar.xz
  rm -rf /opt/smartboard/node && mkdir -p /opt/smartboard/node
  tar -xJf /tmp/node.tar.xz -C /opt/smartboard/node --strip-components=1
  rm -f /tmp/node.tar.xz
fi

log "Benutzer smartboard"
getent group i2c >/dev/null || groupadd -r i2c
if ! id smartboard >/dev/null 2>&1; then
  useradd -m -d /home/smartboard -s /usr/sbin/nologin -c "SmartBoard" smartboard
fi
for g in video render input audio bluetooth netdev i2c; do getent group $g >/dev/null && usermod -aG $g smartboard; done
SB_UID=$(id -u smartboard)
mkdir -p /var/lib/smartboard /etc/smartboard /usr/local/lib/smartboard
chown smartboard:smartboard /var/lib/smartboard
chmod 750 /var/lib/smartboard
mkdir -p /var/lib/systemd/linger && touch /var/lib/systemd/linger/smartboard

log "SmartBoard Core"
if [ -z "$CORE" ]; then
  AUTH=()
  [ -n "$TOKEN" ] && AUTH=(-H "Authorization: Bearer $TOKEN")
  REL=$(curl -fsSL "${AUTH[@]}" -H "Accept: application/vnd.github+json" "https://api.github.com/repos/$REPO/releases?per_page=30")
  VER=$(echo "$REL" | jq -r '[.[] | select(.tag_name | startswith("core-v")) | select(.prerelease | not) | .tag_name | ltrimstr("core-v")] | .[]' | sort -V | tail -1)
  [ -n "$VER" ] || { echo "keine Core-Version gefunden" >&2; exit 1; }
  URL=$(echo "$REL" | jq -r --arg t "core-v$VER" --arg n "smartboard-core-$VER.tar.gz" '.[] | select(.tag_name == $t) | .assets[] | select(.name == $n) | .url')
  curl -fsSL "${AUTH[@]}" -H "Accept: application/octet-stream" "$URL" -o /tmp/core.tar.gz
  CORE=/tmp/core.tar.gz
fi
VER=$(tar -xzOf "$CORE" ./VERSION 2>/dev/null || tar -xzOf "$CORE" VERSION)
DEST=/opt/smartboard/releases/$VER
rm -rf "$DEST" && mkdir -p "$DEST"
tar -xzf "$CORE" -C "$DEST"
ln -sfn "$DEST" /opt/smartboard/current
echo "  Version $VER"

log "Konfiguration"
if [ ! -f /etc/smartboard/core.env ]; then
  TZ_NAME=$(cat /etc/timezone 2>/dev/null || echo Europe/Berlin)
  if [ "$IMAGE" = 1 ] && [ -z "$PASSWORD" ]; then
    printf 'SMARTBOARD_SETUP=1\nTZ=%s\n' "$TZ_NAME" > /etc/smartboard/core.env
  else
    [ -n "$PASSWORD" ] || PASSWORD=$(tr -dc 'A-HJ-NP-Za-km-z2-9' < /dev/urandom | head -c 10)
    printf 'HOMEOS_ADMIN_USER=admin\nHOMEOS_ADMIN_PASSWORD=%s\nSMARTBOARD_SETUP=1\nTZ=%s\n' "$PASSWORD" "$TZ_NAME" > /etc/smartboard/core.env
    NEW_PASSWORD=$PASSWORD
  fi
  chmod 600 /etc/smartboard/core.env
fi
[ -f /etc/smartboard/update.conf ] || printf 'REPO=%s\nTOKEN=%s\n' "$REPO" "$TOKEN" > /etc/smartboard/update.conf
chmod 600 /etc/smartboard/update.conf

fetch_file smartboard-core.service /etc/systemd/system/smartboard-core.service
sed -i "s/@UID@/$SB_UID/" /etc/systemd/system/smartboard-core.service
fetch_file smartboard-update.service /etc/systemd/system/smartboard-update.service
fetch_file smartboard-update-timer.service /etc/systemd/system/smartboard-update-timer.service
fetch_file smartboard-update.timer /etc/systemd/system/smartboard-update.timer
fetch_file smartboard-update /usr/local/sbin/smartboard-update && chmod 755 /usr/local/sbin/smartboard-update
fetch_file wait-core /usr/local/lib/smartboard/wait-core && chmod 755 /usr/local/lib/smartboard/wait-core
fetch_file 50-smartboard.rules /etc/polkit-1/rules.d/50-smartboard.rules
fetch_file 90-smartboard.rules /etc/udev/rules.d/90-smartboard.rules
fetch_file nftables.conf /etc/nftables.conf
mkdir -p /etc/avahi/services && fetch_file smartboard.avahi.service /etc/avahi/services/smartboard.service
echo i2c-dev > /etc/modules-load.d/smartboard.conf
if [ "$KIOSK" = 1 ]; then
  fetch_file smartboard-kiosk.service /etc/systemd/system/smartboard-kiosk.service
  fetch_file kiosk-browser /usr/local/lib/smartboard/kiosk-browser && chmod 755 /usr/local/lib/smartboard/kiosk-browser
fi

cat > /etc/apt/apt.conf.d/52smartboard-unattended <<'EOF'
Unattended-Upgrade::Origins-Pattern { "origin=Debian,codename=${distro_codename}-security"; "origin=Debian,codename=${distro_codename}-updates"; "origin=Raspberry Pi Foundation"; "origin=Raspbian"; };
Unattended-Upgrade::Automatic-Reboot "false";
EOF
printf 'APT::Periodic::Update-Package-Lists "1";\nAPT::Periodic::Unattended-Upgrade "1";\n' > /etc/apt/apt.conf.d/20auto-upgrades

if [ -f /etc/NetworkManager/NetworkManager.conf ] && [ -d /etc/netplan ] && ! grep -q NetworkManager /etc/netplan/*.yaml 2>/dev/null; then
  printf 'network:\n  version: 2\n  renderer: NetworkManager\n' > /etc/netplan/90-smartboard.yaml
fi

for f in /boot/firmware/cmdline.txt /boot/cmdline.txt; do
  if [ -f "$f" ] && ! grep -q 'vt.global_cursor_default=0' "$f"; then
    sed -i '1 s/$/ quiet loglevel=3 logo.nologo vt.global_cursor_default=0 consoleblank=0/' "$f"
    break
  fi
done

log "Dienste"
UNITS="smartboard-core.service smartboard-update.timer nftables.service avahi-daemon.service NetworkManager.service bluetooth.service"
[ "$KIOSK" = 1 ] && UNITS="$UNITS smartboard-kiosk.service"
systemctl disable userconfig.service 2>/dev/null || true
if [ "$KIOSK" = 1 ]; then systemctl set-default graphical.target; fi
if [ "$IMAGE" = 1 ]; then
  echo "$HOSTNAME_NEW" > /etc/hostname
  sed -i "s/127.0.1.1.*/127.0.1.1\t$HOSTNAME_NEW/" /etc/hosts
  # shellcheck disable=SC2086
  systemctl enable $UNITS
else
  CUR_HOST=$(hostname)
  case "$CUR_HOST" in raspberrypi|debian|localhost) hostnamectl set-hostname "$HOSTNAME_NEW" ;; esac
  systemctl daemon-reload
  udevadm control --reload-rules && udevadm trigger --subsystem-match=backlight --subsystem-match=i2c-dev || true
  modprobe i2c-dev 2>/dev/null || true
  loginctl enable-linger smartboard || true
  # shellcheck disable=SC2086
  systemctl enable $UNITS
  systemctl restart nftables.service avahi-daemon.service smartboard-core.service
  [ "$KIOSK" = 1 ] && systemctl restart smartboard-kiosk.service
fi

IP=$(hostname -I 2>/dev/null | awk '{print $1}')
echo
echo "════════════════════════════════════════════════════"
echo " SmartBoard OS $VER installiert"
echo " Aufruf:   http://${HOSTNAME_NEW}.local  oder  http://${IP:-<ip>}"
if [ -n "${NEW_PASSWORD:-}" ]; then
  echo " Anmeldung: admin / $NEW_PASSWORD   (bitte danach ändern)"
fi
echo "════════════════════════════════════════════════════"
