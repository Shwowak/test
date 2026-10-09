#!/bin/bash
# Called by smartboard-update after a successful core update: refreshes system files shipped with the release.
set -uo pipefail
F=$(cd "$(dirname "$0")" && pwd)/files
SB_UID=$(id -u smartboard 2>/dev/null) || exit 0
changed=0

put() {
  local src=$F/$1 dest=$2 mode=${3:-644} tmp
  [ -f "$src" ] || return 0
  tmp=$(mktemp)
  cp "$src" "$tmp"
  [ "$1" = smartboard-core.service ] && sed -i "s/@UID@/$SB_UID/" "$tmp"
  if ! cmp -s "$tmp" "$dest"; then
    install -m "$mode" "$tmp" "$dest"
    echo "apply: $dest"
    changed=1
  fi
  rm -f "$tmp"
}

put smartboard-core.service /etc/systemd/system/smartboard-core.service
put smartboard-update.service /etc/systemd/system/smartboard-update.service
put smartboard-update-timer.service /etc/systemd/system/smartboard-update-timer.service
put smartboard-update.timer /etc/systemd/system/smartboard-update.timer
put smartboard-update /usr/local/sbin/smartboard-update 755
put wait-core /usr/local/lib/smartboard/wait-core 755
put 50-smartboard.rules /etc/polkit-1/rules.d/50-smartboard.rules
put 90-smartboard.rules /etc/udev/rules.d/90-smartboard.rules
[ -f /etc/systemd/system/smartboard-kiosk.service ] && put smartboard-kiosk.service /etc/systemd/system/smartboard-kiosk.service
[ -f /etc/systemd/system/smartboard-kiosk.service ] && put kiosk-browser /usr/local/lib/smartboard/kiosk-browser 755
[ -x /opt/smartboard/go2rtc ] && put go2rtc.service /etc/systemd/system/smartboard-go2rtc.service
[ -f /etc/smartboard/go2rtc.yaml ] || put go2rtc.yaml /etc/smartboard/go2rtc.yaml

if [ "$changed" = 1 ]; then
  systemctl daemon-reload
  systemctl restart smartboard-update.timer 2>/dev/null
  [ -x /opt/smartboard/go2rtc ] && systemctl enable --now smartboard-go2rtc.service 2>/dev/null
fi
exit 0
