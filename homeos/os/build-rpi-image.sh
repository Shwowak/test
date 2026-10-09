#!/bin/bash
# Builds a ready-to-flash SmartBoard OS image for Raspberry Pi 4/5 (arm64) from Raspberry Pi OS Lite.
#   sudo ./build-rpi-image.sh <smartboard-core-X.tar.gz> <output.img.xz>
# Needs: qemu-user-static + binfmt (on non-arm64 hosts), parted, e2fsprogs, xz-utils, curl.
set -euo pipefail

CORE=$(realpath "$1")
OUT=$(realpath -m "$2")
BASE_URL=${RPI_BASE_URL:-https://downloads.raspberrypi.com/raspios_lite_arm64_latest}
HERE=$(cd "$(dirname "$0")" && pwd)
W=$(mktemp -d)
M=$W/root
LOOP=

cleanup() {
  set +e
  for p in dev/pts dev proc sys run boot/firmware; do mountpoint -q "$M/$p" && umount -l "$M/$p"; done
  mountpoint -q "$M" && umount -l "$M"
  [ -n "$LOOP" ] && losetup -d "$LOOP"
  rm -rf "$W"
}
trap cleanup EXIT

echo "▶ Basis-Image laden"
curl -fL --retry 3 -o "$W/base.img.xz" "$BASE_URL"
xz -d -T0 "$W/base.img.xz"
IMG=$W/base.img

echo "▶ Vergrößern"
truncate -s +3G "$IMG"
parted -s "$IMG" resizepart 2 100%
LOOP=$(losetup -fP --show "$IMG")
e2fsck -fy "${LOOP}p2" || true
resize2fs "${LOOP}p2"

echo "▶ Einhängen"
mkdir -p "$M"
mount "${LOOP}p2" "$M"
mount "${LOOP}p1" "$M/boot/firmware"
mount --bind /dev "$M/dev"
mount --bind /dev/pts "$M/dev/pts"
mount -t proc proc "$M/proc"
mount -t sysfs sys "$M/sys"
mount -t tmpfs tmpfs "$M/run"
cp --remove-destination /etc/resolv.conf "$M/etc/resolv.conf.sb"
mv "$M/etc/resolv.conf" "$M/etc/resolv.conf.orig" 2>/dev/null || true
cp "$M/etc/resolv.conf.sb" "$M/etc/resolv.conf"
printf '#!/bin/sh\nexit 101\n' > "$M/usr/sbin/policy-rc.d" && chmod +x "$M/usr/sbin/policy-rc.d"

echo "▶ SmartBoard installieren"
mkdir -p "$M/tmp/sbos"
cp -r "$HERE/install.sh" "$HERE/files" "$M/tmp/sbos/"
cp "$CORE" "$M/tmp/sbos/core.tar.gz"
chroot "$M" /bin/bash /tmp/sbos/install.sh --image --core /tmp/sbos/core.tar.gz

echo "▶ Aufräumen"
chroot "$M" apt-get clean
rm -rf "$M/tmp/sbos" "$M/usr/sbin/policy-rc.d" "$M/var/lib/apt/lists/"* "$M/etc/resolv.conf.sb"
rm -f "$M/etc/resolv.conf"
if [ -e "$M/etc/resolv.conf.orig" ] || [ -L "$M/etc/resolv.conf.orig" ]; then mv "$M/etc/resolv.conf.orig" "$M/etc/resolv.conf"; fi
rm -f "$M/etc/ssh/ssh_host_"*
sync
cleanup_mounts() { for p in dev/pts dev proc sys run boot/firmware; do umount -l "$M/$p"; done; umount "$M"; }
cleanup_mounts
e2fsck -fy "${LOOP}p2" || true
losetup -d "$LOOP"; LOOP=

echo "▶ Komprimieren"
xz -T0 -6 -c "$IMG" > "$OUT"
sha256sum "$OUT" | sed "s#$(dirname "$OUT")/##" > "$OUT.sha256"
ls -lh "$OUT"
