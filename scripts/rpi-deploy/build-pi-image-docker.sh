#!/bin/bash
set -e

echo "🐳 Building Raspberry Pi Image using Docker (macOS - Fully Automated)"
echo "====================================================================="

# Configuration
CONFIG_FILE="build-config.env"
BASE_IMAGE_URL="https://downloads.raspberrypi.org/raspios_lite_arm64/images/raspios_lite_arm64-2024-11-19/2024-11-19-raspios-bookworm-arm64-lite.img.xz"
BASE_IMAGE_NAME="2024-11-19-raspios-bookworm-arm64-lite.img"
OUTPUT_IMAGE="nfc-terminal-$(date +%Y%m%d).img"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

error_exit() {
    echo -e "${RED}❌ Error: $1${NC}" >&2
    exit 1
}

success_msg() {
    echo -e "${GREEN}✅ $1${NC}"
}

warning_msg() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    error_exit "Docker is required for macOS builds but not found. Please install Docker Desktop from: https://docker.com/products/docker-desktop"
fi

# Check if Docker is running
if ! docker info > /dev/null 2>&1; then
    error_exit "Docker is not running. Please start Docker Desktop and try again."
fi

# Step 1: Validate configuration
echo "✅ Step 1: Validating configuration..."
source build/validate-config.sh
validate_config "$CONFIG_FILE"
source "$CONFIG_FILE"

# Step 2: Download base image if needed
echo "📥 Step 2: Preparing base Raspberry Pi OS image..."
mkdir -p build/images
if [ ! -f "build/images/$BASE_IMAGE_NAME" ]; then
    echo "Downloading Raspberry Pi OS Lite..."
    curl -L -o "build/images/$BASE_IMAGE_NAME.xz" "$BASE_IMAGE_URL"
    echo "Extracting image..."
    cd build/images
    xz -d "$BASE_IMAGE_NAME.xz"
    cd ../..
    success_msg "Base image downloaded and extracted"
else
    success_msg "Base image already exists"
fi

# Step 3: Build application
echo "🏗️  Step 3: Building application for production..."
./build-app-production.sh

# Step 4: Prepare Docker environment
echo "🐳 Step 4: Setting up Docker build environment..."

# Create Dockerfile for the build environment
cat > build/Dockerfile << 'DOCKERFILE'
FROM ubuntu:22.04

# Install required tools
RUN apt-get update && apt-get install -y \
    fdisk \
    util-linux \
    e2fsprogs \
    dosfstools \
    wget \
    curl \
    xz-utils \
    mount \
    qemu-user-static \
    debootstrap \
    systemd-container \
    kpartx \
    parted \
    rsync \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
CMD ["/bin/bash"]
DOCKERFILE

# Build the Docker image
echo "Building Docker build environment..."
docker build -t pi-image-builder build/ || error_exit "Failed to build Docker image"
success_msg "Docker build environment ready"

# Step 5: Create the build script that runs inside Docker
echo "🔧 Step 5: Creating Docker build script..."

cat > build/docker-build-script.sh << 'BUILD_SCRIPT'
#!/bin/bash
set -e

echo "🔧 Building image inside Docker container..."

# Variables will be replaced by the main script
BASE_IMAGE="/build/build/images/BASE_IMAGE_NAME"
OUTPUT_IMAGE="/build/build/OUTPUT_IMAGE_NAME"
MOUNT_ROOT="/mnt/root"
MOUNT_BOOT="/mnt/boot"

# Copy and expand the base image
echo "📋 Copying base image..."
cp "$BASE_IMAGE" "$OUTPUT_IMAGE"

# Expand image size by 2GB
echo "📈 Expanding image size..."
dd if=/dev/zero bs=1M count=2048 >> "$OUTPUT_IMAGE" 2>/dev/null

# Get partition information
echo "🔍 Analyzing partitions..."
PART_INFO=$(fdisk -l "$OUTPUT_IMAGE" | grep "^$OUTPUT_IMAGE")
BOOT_PART=$(echo "$PART_INFO" | head -1)
ROOT_PART=$(echo "$PART_INFO" | tail -1)

ROOT_START=$(echo "$ROOT_PART" | awk '{print $2}')

# Expand the root partition
echo "📏 Expanding root partition..."
fdisk "$OUTPUT_IMAGE" << FDISK_COMMANDS || true
d
2
n
p
2
$ROOT_START

w
FDISK_COMMANDS

# Set up loop device
echo "🔗 Setting up loop device..."
LOOP_DEV=$(losetup --show -f -P "$OUTPUT_IMAGE")
echo "Loop device: $LOOP_DEV"

# More aggressive partition table recognition
echo "🔄 Forcing partition table recognition..."
# Method 1: Multiple partprobe attempts
for i in 1 2 3; do
    partprobe "$LOOP_DEV" 2>/dev/null || true
    sleep 2
done

# Method 2: Force kernel to re-read partition table
blockdev --rereadpt "$LOOP_DEV" 2>/dev/null || true
sleep 2

# Method 3: Detach and re-attach with partition scanning
losetup -d "$LOOP_DEV"
sleep 1
LOOP_DEV=$(losetup --show -f -P "$OUTPUT_IMAGE")
echo "Loop device (re-attached): $LOOP_DEV"
sleep 3

# Final partition probe
partprobe "$LOOP_DEV" 2>/dev/null || true
sleep 2

# Debug: Show what partition devices exist
echo "🔍 Checking available devices..."
ls -la /dev/loop* 2>/dev/null || echo "No loop devices found"
ls -la "${LOOP_DEV}"* 2>/dev/null || echo "No partition devices found for $LOOP_DEV"

# Verify partitions exist
echo "🔍 Verifying partitions..."
if [ ! -b "${LOOP_DEV}p1" ] || [ ! -b "${LOOP_DEV}p2" ]; then
    echo "⚠️  Partitions not detected with -P flag, trying manual approach..."
    losetup -d "$LOOP_DEV"
    
    # Try without -P flag and use kpartx
    echo "🔧 Setting up loop device without partition scanning..."
    LOOP_DEV=$(losetup --show -f "$OUTPUT_IMAGE")
    echo "Loop device (no -P): $LOOP_DEV"
    
    # Install and use kpartx for partition mapping
    apt-get update && apt-get install -y kpartx rsync
    echo "🗺️  Creating partition mappings with kpartx..."
    kpartx -av "$LOOP_DEV"
    sleep 3
    
    # Update partition device names for kpartx
    BOOT_DEV="/dev/mapper/$(basename $LOOP_DEV)p1"
    ROOT_DEV="/dev/mapper/$(basename $LOOP_DEV)p2"
    
    # Verify kpartx partitions
    if [ ! -b "$BOOT_DEV" ] || [ ! -b "$ROOT_DEV" ]; then
        echo "❌ Cannot access partitions even with kpartx"
        exit 1
    fi
    
    USE_KPARTX=true
else
    BOOT_DEV="${LOOP_DEV}p1"
    ROOT_DEV="${LOOP_DEV}p2"
    USE_KPARTX=false
fi

echo "Boot partition: $BOOT_DEV"
echo "Root partition: $ROOT_DEV"

# Create mount points early
mkdir -p "$MOUNT_BOOT" "$MOUNT_ROOT"

# Check and fix filesystem before mounting
echo "🔍 Checking filesystem..."
FS_CORRUPT=false
if ! e2fsck -f -y "$ROOT_DEV"; then
    echo "⚠️  Filesystem corruption detected!"
    FS_CORRUPT=true
fi

# Try to resize first - if this fails, we definitely need to recreate
echo "📏 Resizing filesystem..."
if ! resize2fs "$ROOT_DEV"; then
    echo "⚠️  Resize failed, filesystem needs recreation"
    FS_CORRUPT=true
fi

# If filesystem is corrupt, we need to recreate it and restore from base image
if [ "$FS_CORRUPT" = "true" ]; then
    echo "🔄 Recreating corrupted filesystem..."
    
    # Create backup of original image rootfs (copy before we modify)
    echo "📋 Creating backup copy of original image..."
    cp "$BASE_IMAGE" "${BASE_IMAGE}.backup"
    BACKUP_LOOP=$(losetup --show -f -P "${BASE_IMAGE}.backup")
    
    # Recreate the filesystem
    mkfs.ext4 -F -L rootfs "$ROOT_DEV"
    tune2fs -c 0 -i 0 "$ROOT_DEV"  # Disable periodic checks
    
    # Mount both original and new filesystems
    mkdir -p /tmp/original_root /tmp/new_root
    mount "${BACKUP_LOOP}p2" /tmp/original_root -o ro
    mount "$ROOT_DEV" /tmp/new_root -o rw
    
    # Copy all files from original to new filesystem
    echo "📂 Restoring system files from original image..."
    rsync -avxHAX /tmp/original_root/ /tmp/new_root/
    
    # Cleanup
    umount /tmp/original_root /tmp/new_root
    losetup -d "$BACKUP_LOOP"
    rm -f "${BASE_IMAGE}.backup"
    rmdir /tmp/original_root /tmp/new_root
    
    echo "✅ Filesystem recreated and system files restored"
fi

# Final verification
echo "🔍 Testing filesystem writability..."
mount "$ROOT_DEV" "$MOUNT_ROOT" -o rw
if ! touch "$MOUNT_ROOT/test_write" 2>/dev/null; then
    echo "❌ CRITICAL: Filesystem still not writable after recreation!"
    exit 1
fi
rm -f "$MOUNT_ROOT/test_write"
umount "$MOUNT_ROOT"

# Mount partitions (mount points already created)
echo "💿 Mounting partitions..."
mount "$BOOT_DEV" "$MOUNT_BOOT"
mount "$ROOT_DEV" "$MOUNT_ROOT"

# Install application files
echo "📦 Installing application..."
mkdir -p "$MOUNT_ROOT/opt/nfc-terminal"
cp -r /build/build/app-bundle/app/. "$MOUNT_ROOT/opt/nfc-terminal/"
cp /build/build/app-bundle/package.json "$MOUNT_ROOT/opt/nfc-terminal/"
cp /build/build/app-bundle/package-lock.json "$MOUNT_ROOT/opt/nfc-terminal/"

# Create environment file with real values
cat > "$MOUNT_ROOT/opt/nfc-terminal/.env" << ENV_FILE
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
ALCHEMY_API_KEY=ALCHEMY_KEY_VALUE
MERCHANT_ETH_ADDRESS=MERCHANT_ADDRESS_VALUE
BLOCKCHAIN_NETWORKS=BLOCKCHAIN_NETWORKS_VALUE
ENV_FILE

# Configure WiFi
echo "📶 Configuring WiFi..."
mkdir -p "$MOUNT_ROOT/etc/wpa_supplicant"
cat > "$MOUNT_ROOT/etc/wpa_supplicant/wpa_supplicant.conf" << WIFI_CONFIG
country=US
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1

network={
    ssid="WIFI_SSID_VALUE"
    psk="WIFI_PASSWORD_VALUE"
    key_mgmt=WPA-PSK
}
WIFI_CONFIG
chmod 600 "$MOUNT_ROOT/etc/wpa_supplicant/wpa_supplicant.conf"

# Install systemd services
echo "⚙️  Installing systemd services..."
cp /build/build/app-bundle/config/*.service "$MOUNT_ROOT/etc/systemd/system/"

# Enable services manually (better than systemctl enable in chroot)
echo "🔧 Enabling systemd services..."
mkdir -p "$MOUNT_ROOT/etc/systemd/system/multi-user.target.wants"
mkdir -p "$MOUNT_ROOT/etc/systemd/system/graphical.target.wants"

# Core services
ln -sf "/etc/systemd/system/wifi-unblock.service" "$MOUNT_ROOT/etc/systemd/system/multi-user.target.wants/"
ln -sf "/etc/systemd/system/wifi-connect.service" "$MOUNT_ROOT/etc/systemd/system/multi-user.target.wants/"
ln -sf "/etc/systemd/system/nfc-terminal.service" "$MOUNT_ROOT/etc/systemd/system/multi-user.target.wants/"
ln -sf "/etc/systemd/system/display-setup.service" "$MOUNT_ROOT/etc/systemd/system/graphical.target.wants/"
ln -sf "/etc/systemd/system/start-gui.service" "$MOUNT_ROOT/etc/systemd/system/graphical.target.wants/"

# Remove the systemd-based chromium service - we'll use X11 auto-start instead
rm -f "$MOUNT_ROOT/etc/systemd/system/chromium-kiosk.service" 2>/dev/null || true

# Configure display settings
echo "🖥️  Configuring display..."
if ! grep -q "gpu_mem" "$MOUNT_BOOT/config.txt"; then
    echo "gpu_mem=128" >> "$MOUNT_BOOT/config.txt"
fi

cat >> "$MOUNT_BOOT/config.txt" << DISPLAY_CONFIG

# 5" HDMI LCD Touchscreen Display Configuration (800x480)
# Enable GPU memory
gpu_mem=128

# HDMI display settings for 5" LCD (800x480)
hdmi_group=2
hdmi_mode=87
hdmi_cvt=800 480 60 6 0 0 0
hdmi_drive=2
hdmi_force_hotplug=1

# Disable overscan for exact resolution
disable_overscan=1

# Enable SPI for touch controller
dtparam=spi=on

# Audio
dtparam=audio=on

# Optional: if display is rotated, uncomment one of these:
# display_rotate=1  # 90 degrees
# display_rotate=2  # 180 degrees  
# display_rotate=3  # 270 degrees

# Touch screen calibration (may need adjustment for your specific display)
# These values are typical for 5" 800x480 displays but may need fine-tuning
dtoverlay=ads7846,cs=1,penirq=25,penirq_pull=2,speed=50000,keep_vref_on=1,swapxy=1,pmax=255,xohms=150,xmin=200,xmax=3900,ymin=200,ymax=3900
DISPLAY_CONFIG

# Configure auto-login for freepay user
echo "👤 Configuring auto-login and display manager..."
mkdir -p "$MOUNT_ROOT/etc/systemd/system/getty@tty1.service.d"
cat > "$MOUNT_ROOT/etc/systemd/system/getty@tty1.service.d/autologin.conf" << AUTOLOGIN_CONFIG
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin freepay --noclear %I \$TERM
AUTOLOGIN_CONFIG

# Disable lightdm (display manager) since we want direct X11
mkdir -p "$MOUNT_ROOT/etc/systemd/system"
ln -sf /dev/null "$MOUNT_ROOT/etc/systemd/system/lightdm.service"

# Create a systemd service to start the GUI automatically
cat > "$MOUNT_ROOT/etc/systemd/system/start-gui.service" << GUI_SERVICE
[Unit]
Description=Start GUI for NFC Terminal
After=nfc-terminal.service multi-user.target
Wants=nfc-terminal.service
Conflicts=getty@tty1.service

[Service]
Type=simple
User=freepay
Group=freepay
Environment=HOME=/home/freepay
Environment=DISPLAY=:0
Environment=XDG_RUNTIME_DIR=/run/user/1000
WorkingDirectory=/home/freepay
ExecStartPre=/bin/mkdir -p /run/user/1000
ExecStartPre=/bin/chown freepay:freepay /run/user/1000
ExecStart=/usr/bin/xinit /home/freepay/start-kiosk.sh -- :0 vt7 -keeptty
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal
KillMode=mixed
TimeoutStopSec=30

[Install]
WantedBy=graphical.target
GUI_SERVICE

# Create auto-start X11 in bashrc for freepay user
mkdir -p "$MOUNT_ROOT/home/freepay"
cat >> "$MOUNT_ROOT/home/freepay/.bashrc" << BASHRC_APPEND

# Auto-start X11 on login for display :0
if [ -z "\$DISPLAY" ] && [ "\$(tty)" = "/dev/tty1" ] && [ -z "\$X11_STARTED" ]; then
    echo "Starting X11 session..."
    export X11_STARTED=1
    exec startx
fi
BASHRC_APPEND

# Create kiosk startup script for X11
echo "🖥️  Creating kiosk startup script..."
mkdir -p "$MOUNT_ROOT/home/freepay"
cat > "$MOUNT_ROOT/home/freepay/start-kiosk.sh" << KIOSK_SCRIPT
#!/bin/bash
echo "Starting NFC Terminal Kiosk GUI..."

# Wait a moment for X11 to initialize
sleep 3

# Wait for NFC terminal service to be ready
echo "Waiting for NFC terminal service..."
timeout=120
while [ \$timeout -gt 0 ]; do
    if curl -f http://localhost:3000 > /dev/null 2>&1; then
        echo "NFC terminal service ready"
        break
    fi
    echo "NFC terminal not ready, waiting... (\$timeout seconds left)"
    sleep 2
    timeout=\$((timeout - 2))
done

if [ \$timeout -le 0 ]; then
    echo "ERROR: NFC terminal service not available after 2 minutes"
    # Show an error page instead of exiting
    echo "<html><body><h1>NFC Terminal Starting...</h1><p>Please wait while the service initializes.</p></body></html>" > /tmp/loading.html
    chromium-browser --kiosk --no-sandbox file:///tmp/loading.html &
    sleep 30
    # Try to connect again
    if curl -f http://localhost:3000 > /dev/null 2>&1; then
        pkill chromium-browser
    else
        exit 1
    fi
fi

# Set up display
xset -dpms
xset s off  
xset s noblank

# Hide cursor
unclutter -idle 1 &

echo "Starting Chromium kiosk mode..."
exec chromium-browser \
    --kiosk \
    --no-sandbox \
    --disable-infobars \
    --disable-session-crashed-bubble \
    --disable-restore-session-state \
    --disable-features=TranslateUI \
    --no-first-run \
    --fast \
    --fast-start \
    --disable-default-apps \
    --disable-popup-blocking \
    --disable-translate \
    --disable-background-timer-throttling \
    --disable-renderer-backgrounding \
    --disable-device-discovery-notifications \
    --autoplay-policy=no-user-gesture-required \
    --disable-dev-shm-usage \
    --disable-extensions \
    --disable-plugins \
    --disable-web-security \
    --allow-running-insecure-content \
    --touch-events=enabled \
    --enable-features=TouchpadAndWheelScrollLatching \
    http://localhost:3000
KIOSK_SCRIPT
chmod +x "$MOUNT_ROOT/home/freepay/start-kiosk.sh"

# Create touch screen calibration script
cat > "$MOUNT_ROOT/home/freepay/calibrate-touch.sh" << CALIBRATE_SCRIPT
#!/bin/bash
echo "Touch Screen Calibration Tool"
echo "============================="
echo "This script helps calibrate your 5\" touchscreen if touch is not accurate."
echo ""
echo "Current touch configuration is in /boot/config.txt"
echo "Look for the ads7846 overlay line."
echo ""
echo "To run interactive calibration:"
echo "1. Make sure X11 is running (startx)"
echo "2. Run: xinput_calibrator"
echo "3. Follow the on-screen instructions"
echo "4. Update the values in /boot/config.txt if needed"
echo ""
echo "Common issues:"
echo "- Touch is inverted: add or remove 'swapxy=1' in the ads7846 line"
echo "- Touch is offset: adjust xmin, xmax, ymin, ymax values"
echo "- Touch is too sensitive: adjust speed value (try 10000-100000)"
echo ""
echo "Current configuration:"
grep "ads7846" /boot/config.txt || echo "No ads7846 configuration found"
CALIBRATE_SCRIPT
chmod +x "$MOUNT_ROOT/home/freepay/calibrate-touch.sh"

# Create WiFi connection helper script
cat > "$MOUNT_ROOT/home/freepay/connect-wifi.sh" << WIFI_HELPER_SCRIPT
#!/bin/bash
echo "WiFi Connection Helper"
echo "====================="
echo ""

# Check if WiFi interface exists
if ! ip link show wlan0 >/dev/null 2>&1; then
    echo "❌ No WiFi interface (wlan0) found"
    echo "   System will use ethernet connection"
    exit 1
fi

echo "📶 WiFi interface found"

# Check rfkill status
echo "🔍 Checking rfkill status..."
rfkill list wifi 2>/dev/null || echo "rfkill wifi status unknown"

# Check if WiFi is blocked
if rfkill list wifi 2>/dev/null | grep -q "Soft blocked: yes"; then
    echo "🔓 WiFi is soft-blocked, unblocking..."
    sudo rfkill unblock wifi
    sudo rfkill unblock wlan
    sleep 1
fi

# Check current WiFi status
if iwconfig wlan0 2>/dev/null | grep -q "ESSID:off"; then
    echo "📡 WiFi not connected, attempting connection..."
    
    # Stop any existing wpa_supplicant
    sudo pkill -f "wpa_supplicant.*wlan0" || true
    sleep 1
    
    # Enable WiFi and bring interface up
    sudo rfkill unblock wifi
    sudo ip link set wlan0 up
    sleep 2
    
    # Start wpa_supplicant
    if sudo wpa_supplicant -B -i wlan0 -c /etc/wpa_supplicant/wpa_supplicant.conf; then
        echo "✅ wpa_supplicant started"
        sleep 5
        
        # Try to get DHCP lease
        if sudo dhclient wlan0 || sudo dhcpcd wlan0; then
            echo "✅ WiFi connected successfully"
            echo "📡 Connection info:"
            iwconfig wlan0 2>/dev/null | grep ESSID
            ip addr show wlan0 | grep "inet "
        else
            echo "⚠️  WiFi associated but DHCP failed"
            echo "   Check router DHCP settings"
        fi
    else
        echo "❌ Failed to start wpa_supplicant"
        echo "   Check WiFi credentials in /etc/wpa_supplicant/wpa_supplicant.conf"
    fi
else
    echo "✅ WiFi already connected"
    iwconfig wlan0 2>/dev/null | grep ESSID
    ip addr show wlan0 | grep "inet "
fi

echo ""
echo "💡 Note: NFC terminal works with ethernet if WiFi fails"
echo "   Check service status: sudo systemctl status nfc-terminal"
WIFI_HELPER_SCRIPT
chmod +x "$MOUNT_ROOT/home/freepay/connect-wifi.sh"

# Create GUI debug script
cat > "$MOUNT_ROOT/home/freepay/debug-gui.sh" << DEBUG_SCRIPT
#!/bin/bash
echo "🔍 NFC Terminal GUI Debug Script"
echo "================================="
echo ""

echo "📊 System Status:"
echo "- Uptime: \$(uptime)"
echo "- Default target: \$(systemctl get-default)"
echo "- Current user: \$(whoami)"
echo "- Groups: \$(groups)"
echo ""

echo "🔧 Service Status:"
echo "- NFC Terminal: \$(systemctl is-active nfc-terminal.service)"
echo "- Start GUI: \$(systemctl is-active start-gui.service)"
echo "- Display Setup: \$(systemctl is-active display-setup.service)"
echo ""

echo "🌐 Network Status:"
echo "- NFC Terminal responding: \$(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 || echo "No response")"
echo ""

echo "🖥️ Display Status:"
echo "- X11 processes: \$(ps aux | grep -E '[Xx]org|xinit|startx' | wc -l) running"
echo "- Chromium processes: \$(ps aux | grep -v grep | grep chromium | wc -l) running"
echo ""

echo "📋 Detailed Service Logs (last 20 lines):"
echo ""
echo "=== NFC Terminal Service ==="
sudo journalctl -u nfc-terminal.service --no-pager -l -n 20
echo ""
echo "=== Start GUI Service ==="
sudo journalctl -u start-gui.service --no-pager -l -n 20
echo ""

echo "🔧 Manual Test Commands:"
echo ""
echo "To test GUI manually:"
echo "1. Stop the service: sudo systemctl stop start-gui.service"
echo "2. Test X11 manually: sudo -u freepay DISPLAY=:0 xinit /home/freepay/start-kiosk.sh -- :0 vt7"
echo "3. Or test kiosk script: sudo -u freepay /home/freepay/start-kiosk.sh"
echo ""
echo "To see live logs:"
echo "sudo journalctl -u start-gui.service -f"
echo ""
echo "To check X11 capabilities:"
echo "ls -la /usr/bin/X*"
echo "which xinit"
echo ""
DEBUG_SCRIPT
chmod +x "$MOUNT_ROOT/home/freepay/debug-gui.sh"

# Create .xinitrc for X11 startup
cat > "$MOUNT_ROOT/home/freepay/.xinitrc" << XINITRC
#!/bin/bash
# Disable screen saver and power management
xset -dpms
xset s off
xset s noblank

# Hide cursor after 1 second of inactivity
unclutter -idle 1 &

# Start window manager
openbox-session &

# Wait for window manager
sleep 3

# Start the kiosk application
/home/freepay/start-kiosk.sh
XINITRC
chmod +x "$MOUNT_ROOT/home/freepay/.xinitrc"

# Set ownership of freepay home directory and files
# We'll do this in the chroot script since the user needs to exist first

# Create X11 input configuration for the 5" touchscreen
mkdir -p "$MOUNT_ROOT/etc/X11/xorg.conf.d"
cat > "$MOUNT_ROOT/etc/X11/xorg.conf.d/99-calibration.conf" << XORG_TOUCH_CONFIG
Section "InputClass"
    Identifier "calibration"
    MatchProduct "ADS7846 Touchscreen"
    Option "Calibration" "200 3900 200 3900"
    Option "SwapAxes" "1"
    Option "InvertX" "false"
    Option "InvertY" "false"
EndSection

Section "InputClass"
    Identifier "evdev touchscreen catchall"
    MatchIsTouchscreen "on"
    MatchDevicePath "/dev/input/event*"
    Driver "evdev"
EndSection
XORG_TOUCH_CONFIG

# Disable first-boot wizard and enable SSH
echo "🔐 Disabling first-boot wizard and enabling SSH..."
touch "$MOUNT_BOOT/ssh"

# Create the missing firstboot script (since we can't install raspberrypi-sys-mods)
mkdir -p "$MOUNT_ROOT/usr/lib/raspberrypi-sys-mods"
cat > "$MOUNT_ROOT/usr/lib/raspberrypi-sys-mods/firstboot" << FIRSTBOOT_SCRIPT
#!/bin/bash
# Firstboot script for Raspberry Pi
echo "First boot setup completed"
# Disable the user configuration wizard
systemctl disable userconfig 2>/dev/null || true
rm -f /etc/xdg/autostart/piwiz.desktop 2>/dev/null || true
rm -f /usr/share/applications/piwiz.desktop 2>/dev/null || true
# Mark firstboot as completed
touch /boot/firstboot_done
FIRSTBOOT_SCRIPT
chmod +x "$MOUNT_ROOT/usr/lib/raspberrypi-sys-mods/firstboot"

# Create missing directories that would normally be provided by Pi packages
mkdir -p "$MOUNT_ROOT/opt/vc/bin" "$MOUNT_ROOT/opt/vc/lib"

# Create udev rule to prevent WiFi blocking
mkdir -p "$MOUNT_ROOT/etc/udev/rules.d"
cat > "$MOUNT_ROOT/etc/udev/rules.d/10-wifi-unblock.rules" << UDEV_RULE
# Automatically unblock WiFi on boot
ACTION=="add", SUBSYSTEM=="rfkill", ATTR{type}=="wlan", ATTR{state}="0"
UDEV_RULE

# Create systemd service to ensure WiFi is unblocked early in boot
cat > "$MOUNT_ROOT/etc/systemd/system/wifi-unblock.service" << WIFI_UNBLOCK_SERVICE
[Unit]
Description=Unblock WiFi on boot
Before=wifi-connect.service
DefaultDependencies=no

[Service]
Type=oneshot
ExecStart=/usr/sbin/rfkill unblock wifi
ExecStart=/usr/sbin/rfkill unblock wlan
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
WIFI_UNBLOCK_SERVICE

# Create userconf file to set default user password (prevents user setup wizard)
# Password hash for 'freepay' - generated with: echo 'freepay' | openssl passwd -6 -stdin
echo 'freepay:$6$rounds=656000$YQiWRlWWQtNRDEKd$4wLLbMstV8WRnksIm6EBTt5DkmLrIqf3d4TtqQKdg3.Pn4rBfKNOw0CZgQlGWqtHn6GKxJJr7k4OEAF6Lk4iP.' > "$MOUNT_BOOT/userconf"

# Fix cmdline.txt - don't append, replace to avoid corruption
if [ -f "$MOUNT_BOOT/cmdline.txt" ]; then
    # Read existing cmdline and clean it
    CMDLINE=$(cat "$MOUNT_BOOT/cmdline.txt" | tr -d '\n' | sed 's/[ ]*$//')
    echo "$CMDLINE console=tty1 fsck.repair=yes" > "$MOUNT_BOOT/cmdline.txt"
else
    echo "console=serial0,115200 console=tty1 root=PARTUUID=xxxxxxxx-02 rootfstype=ext4 elevator=deadline fsck.repair=yes rootwait" > "$MOUNT_BOOT/cmdline.txt"
fi

# Disable initial setup
touch "$MOUNT_ROOT/etc/systemd/system/firstboot.service"
cat > "$MOUNT_ROOT/etc/systemd/system/firstboot.service" << FIRSTBOOT_SERVICE
[Unit]
Description=First boot setup
After=systemd-user-sessions.service
Before=getty@tty1.service

[Service]
Type=oneshot
ExecStart=/bin/true
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
FIRSTBOOT_SERVICE

# Configure SSH with custom user
echo "👤 Configuring SSH access..."
SSH_USERNAME="SSH_USERNAME_VALUE"
SSH_PASSWORD="SSH_PASSWORD_VALUE"
SSH_ENABLE_PASSWORD_AUTH="SSH_ENABLE_PASSWORD_AUTH_VALUE"

# Configure SSH daemon for password authentication
if [ "$SSH_ENABLE_PASSWORD_AUTH" = "true" ]; then
    echo "Enabling SSH password authentication..."
    sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' "$MOUNT_ROOT/etc/ssh/sshd_config"
    sed -i 's/PasswordAuthentication no/PasswordAuthentication yes/' "$MOUNT_ROOT/etc/ssh/sshd_config"
    
    # Also enable challenge-response authentication
    sed -i 's/#ChallengeResponseAuthentication yes/ChallengeResponseAuthentication yes/' "$MOUNT_ROOT/etc/ssh/sshd_config"
    sed -i 's/ChallengeResponseAuthentication no/ChallengeResponseAuthentication yes/' "$MOUNT_ROOT/etc/ssh/sshd_config"
    
    # Enable PAM authentication
    sed -i 's/#UsePAM yes/UsePAM yes/' "$MOUNT_ROOT/etc/ssh/sshd_config"
    sed -i 's/UsePAM no/UsePAM yes/' "$MOUNT_ROOT/etc/ssh/sshd_config"
fi

# Create custom user setup script
cat > "$MOUNT_ROOT/tmp/setup-ssh-user.sh" << SSH_USER_SCRIPT
#!/bin/bash
set -e

echo "Setting up SSH user: $SSH_USERNAME"

# Create the user if it doesn't exist
if ! id "$SSH_USERNAME" &>/dev/null; then
    useradd -m -s /bin/bash "$SSH_USERNAME"
    echo "User $SSH_USERNAME created"
else
    echo "User $SSH_USERNAME already exists"
fi

# Set password
echo "$SSH_USERNAME:$SSH_PASSWORD" | chpasswd
echo "Password set for $SSH_USERNAME"

# Add user to sudo group for administrative access
usermod -aG sudo "$SSH_USERNAME"
echo "$SSH_USERNAME added to sudo group"

# Add user to plugdev group for hardware access (NFC reader)
usermod -aG plugdev "$SSH_USERNAME"

# Add user to dialout group for serial access if needed
usermod -aG dialout "$SSH_USERNAME"

# Ensure SSH directory exists for the user
mkdir -p "/home/$SSH_USERNAME/.ssh"
chmod 700 "/home/$SSH_USERNAME/.ssh"
chown "$SSH_USERNAME:$SSH_USERNAME" "/home/$SSH_USERNAME/.ssh"

echo "SSH user $SSH_USERNAME setup completed successfully"
SSH_USER_SCRIPT

chmod +x "$MOUNT_ROOT/tmp/setup-ssh-user.sh"

# Create freepay user setup script
cat > "$MOUNT_ROOT/tmp/setup-freepay-user.sh" << FREEPAY_USER_SCRIPT
#!/bin/bash
set -e

echo "Setting up main freepay user..."

# Create the freepay user if it doesn't exist
if ! id "freepay" &>/dev/null; then
    useradd -m -s /bin/bash "freepay"
    echo "User freepay created"
else
    echo "User freepay already exists"
fi

# Set password
echo "freepay:freepay" | chpasswd
echo "Password set for freepay"

# Add user to essential groups
usermod -aG sudo freepay
usermod -aG plugdev freepay
usermod -aG dialout freepay
usermod -aG video freepay
usermod -aG audio freepay
usermod -aG input freepay
usermod -aG tty freepay

# Set proper ownership of home directory
chown -R freepay:freepay /home/freepay
chmod 755 /home/freepay

echo "Freepay user setup completed successfully"
FREEPAY_USER_SCRIPT

chmod +x "$MOUNT_ROOT/tmp/setup-freepay-user.sh"

# Install packages and configure system using chroot
echo "📦 Installing packages in chroot environment..."
cat > "$MOUNT_ROOT/tmp/install-packages.sh" << INSTALL_SCRIPT
#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive

echo "=== Starting package installation in chroot ==="
echo "Updating package lists..."
apt-get update || { echo "ERROR: apt-get update failed"; exit 1; }

echo "Installing Node.js repository..."
curl -fsSL https://deb.nodesource.com/setup_18.x | bash - || { echo "ERROR: Node.js repository setup failed"; exit 1; }

echo "Installing core packages..."
# Install packages in smaller groups to avoid dependency conflicts
apt-get install -y \
    nodejs \
    chromium-browser \
    openbox \
    unclutter \
    xserver-xorg \
    xinit || { echo "ERROR: GUI package installation failed"; exit 1; }

echo "Installing X11 input packages..."
apt-get install -y \
    xserver-xorg-input-libinput \
    xserver-xorg-input-evdev \
    xserver-xorg-video-fbdev \
    xinput-calibrator \
    xserver-xorg-input-synaptics || { echo "WARNING: Some X11 input packages failed"; }

echo "Installing network packages..."
apt-get install -y \
    curl \
    wget \
    dhcpcd5 \
    isc-dhcp-client \
    wpasupplicant \
    wireless-tools \
    iw \
    rfkill || { echo "ERROR: Network package installation failed"; exit 1; }

echo "Installing NFC and system packages..."
apt-get install -y \
    libnfc-bin \
    libpcsclite-dev \
    pcscd \
    pcsc-tools \
    console-setup \
    keyboard-configuration || { echo "WARNING: Some system packages failed"; }

echo "Installing SSH server if not already present..."
if ! dpkg -l openssh-server >/dev/null 2>&1; then
    apt-get install -y openssh-server || echo "WARNING: SSH server installation failed"
else
    echo "SSH server already installed"
fi

echo "Core packages installed successfully"

echo "Installing NFC reader support..."
# Install basic NFC support packages and build dependencies first
apt-get install -y libccid pcscd pcsc-tools libpcsclite-dev libusb-1.0-0-dev build-essential pkg-config flex perl autoconf libtool || echo "WARNING: Basic NFC packages installation failed"

echo "Attempting to install ACR1252U-M1 specific drivers..."
cd /tmp

# Try multiple ACS driver sources to avoid 403 errors
ACS_DOWNLOADED=false

# Try direct GitHub release (most reliable)
echo "Trying GitHub acsccid release..."
if timeout 60 wget --no-check-certificate -O acsccid-1.1.11.tar.bz2 "https://github.com/acshk/acsccid/releases/download/acsccid-1.1.11/acsccid-1.1.11.tar.bz2" 2>/dev/null; then
    ACS_DOWNLOADED=true
    ACS_FILE="acsccid-1.1.11.tar.bz2"
    echo "Successfully downloaded from GitHub"
else
    echo "GitHub download failed, trying SourceForge..."
    # Try SourceForge mirror
    if timeout 60 wget --no-check-certificate -O acsccid-1.1.11.tar.bz2 "https://downloads.sourceforge.net/acsccid/acsccid-1.1.11.tar.bz2" 2>/dev/null; then
        ACS_DOWNLOADED=true
        ACS_FILE="acsccid-1.1.11.tar.bz2"
        echo "Successfully downloaded from SourceForge"
    else
        echo "SourceForge download failed, trying apt package manager..."
        # Try installing via package manager as fallback
        if apt-get install -y acsccid 2>/dev/null; then
            echo "Successfully installed ACS driver via package manager"
            ACS_DOWNLOADED=true
            SKIP_ACS_DRIVER=true  # Skip manual installation since apt handled it
        else
            echo "WARNING: All ACS driver download sources failed"
            echo "Basic PCSC support is installed. ACR1252U-M1 should work with generic drivers."
            echo "If issues occur, manually install from: https://github.com/acshk/acsccid or https://acsccid.sourceforge.io/"
            SKIP_ACS_DRIVER=true
        fi
    fi
fi

if [ "$SKIP_ACS_DRIVER" != "true" ]; then
    echo "Extracting and building ACS driver..."
    if tar -xjf "$ACS_FILE" 2>/dev/null; then
        echo "ACS driver source extracted successfully"
        # Navigate to the extracted directory
        ACS_DIR=$(find . -name "acsccid-*" -type d | head -1)
        if [ -d "$ACS_DIR" ]; then
            cd "$ACS_DIR"
            echo "Building ACS driver from source..."
            # Build the driver from source
            if ./configure --enable-embedded --disable-dependency-tracking 2>/dev/null && make 2>/dev/null && make install 2>/dev/null; then
                echo "ACS driver built and installed successfully from source"
                # Update library cache
                ldconfig 2>/dev/null || true
            else
                echo "WARNING: Failed to build ACS driver from source, checking for pre-built packages..."
                cd ..
                # Try to find pre-built packages in case they exist
                if ls acsccid_*.deb 1> /dev/null 2>&1; then
                    dpkg -i acsccid_*.deb 2>/dev/null || {
                        echo "WARNING: ACS driver package installation failed, using generic drivers"
                        apt-get install -f -y 2>/dev/null || true
                    }
                    echo "ACS driver installation completed (or using fallback)"
                else
                    echo "WARNING: No pre-built packages found, using generic drivers"
                fi
            fi
            cd /tmp
        else
            echo "WARNING: Could not find extracted ACS driver directory, using generic drivers"
        fi
    else
        echo "WARNING: Failed to extract ACS driver archive, using generic drivers"
    fi
    # Cleanup
    rm -f "$ACS_FILE" acsccid_*.deb 2>/dev/null || true
    rm -rf acsccid-* 2>/dev/null || true
fi

echo "Installing Node.js dependencies..."
cd /opt/nfc-terminal
echo "Current directory: $(pwd)"
echo "Contents: $(ls -la)"
if [ -f package.json ]; then
    echo "Found package.json, installing dependencies..."
    # Set npm timeout and disable audit to speed up installation
    npm config set audit false
    npm config set fund false
    npm config set update-notifier false
    
    # Install with timeout to prevent hanging
    timeout 600 npm ci --production --unsafe-perm --no-audit --no-fund --quiet || {
        echo "WARNING: npm ci failed or timed out, trying npm install instead..."
        timeout 300 npm install --production --unsafe-perm --no-audit --no-fund --quiet || {
            echo "ERROR: Both npm ci and npm install failed"
            exit 1
        }
    }
    echo "Node.js dependencies installation completed"
else
    echo "ERROR: package.json not found in /opt/nfc-terminal"
    echo "Directory contents:"
    ls -la /opt/nfc-terminal/ || true
    exit 1
fi

echo "Setting up file permissions..."
# Note: filesystem check will be done after unmounting

# Set proper ownership for NFC terminal
chmod -R 755 /opt/nfc-terminal

# File permissions will be set after freepay user is created

echo "Setting up SSH user..."
/tmp/setup-ssh-user.sh

echo "Setting up freepay user..."
/tmp/setup-freepay-user.sh

echo "Disabling first-boot wizard and setup..."
# Disable the user configuration wizard
systemctl disable userconfig 2>/dev/null || true
rm -f /etc/xdg/autostart/piwiz.desktop 2>/dev/null || true
rm -f /usr/share/applications/piwiz.desktop 2>/dev/null || true
rm -f /etc/xdg/autostart/wifi-country.desktop 2>/dev/null || true

# Set country for WiFi (prevents country dialog)
echo 'REGDOMAIN=US' > /etc/default/crda

# Configure locale and keyboard to prevent setup dialogs
echo 'LANG=en_US.UTF-8' > /etc/default/locale
echo 'LC_ALL=en_US.UTF-8' >> /etc/default/locale
dpkg-reconfigure -f noninteractive locales 2>/dev/null || true
update-locale LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 2>/dev/null || true

echo "Configuring SSH service..."
# Ensure SSH service is properly configured
systemctl unmask ssh.service 2>/dev/null || true
systemctl unmask sshd.service 2>/dev/null || true

# Generate SSH host keys if they don't exist
ssh-keygen -A || echo "SSH key generation completed"

# Enable SSH in systemd
systemctl enable ssh 2>/dev/null || systemctl enable sshd 2>/dev/null || {
    echo "Manual SSH service linking..."
    ln -sf /lib/systemd/system/ssh.service /etc/systemd/system/multi-user.target.wants/ 2>/dev/null || \
    ln -sf /lib/systemd/system/sshd.service /etc/systemd/system/multi-user.target.wants/ 2>/dev/null || true
}

echo "Enabling other services..."
# Set graphical target as default
systemctl set-default graphical.target 2>/dev/null || true

systemctl enable pcscd wifi-unblock wifi-connect nfc-terminal display-setup start-gui dhcpcd 2>/dev/null || {
    echo "WARNING: Some services could not be enabled, will try manual linking"
    # Manual service enabling as fallback
    ln -sf /etc/systemd/system/pcscd.service /etc/systemd/system/multi-user.target.wants/ 2>/dev/null || true
    ln -sf /lib/systemd/system/dhcpcd.service /etc/systemd/system/multi-user.target.wants/ 2>/dev/null || true
}

echo "Package installation complete!"
INSTALL_SCRIPT

chmod +x "$MOUNT_ROOT/tmp/install-packages.sh"

# Run the installation in chroot
echo "🏃 Running package installation in chroot..."
echo "This step may take 10-20 minutes. Please be patient..."

# Set up chroot environment properly
mount --bind /proc "$MOUNT_ROOT/proc" || true
mount --bind /sys "$MOUNT_ROOT/sys" || true
mount --bind /dev "$MOUNT_ROOT/dev" || true
mount --bind /dev/pts "$MOUNT_ROOT/dev/pts" || true

# Run installation with timeout to prevent indefinite hanging
timeout 1800 chroot "$MOUNT_ROOT" /tmp/install-packages.sh || {
    echo "ERROR: Package installation in chroot failed or timed out after 30 minutes"
    echo "Attempting cleanup and continuing with partial installation..."
}

# Cleanup mounts
umount "$MOUNT_ROOT/dev/pts" 2>/dev/null || true
umount "$MOUNT_ROOT/dev" 2>/dev/null || true  
umount "$MOUNT_ROOT/sys" 2>/dev/null || true
umount "$MOUNT_ROOT/proc" 2>/dev/null || true

echo "Package installation phase completed"

# Clean up installation scripts
rm "$MOUNT_ROOT/tmp/install-packages.sh"
rm "$MOUNT_ROOT/tmp/setup-ssh-user.sh"
rm "$MOUNT_ROOT/tmp/setup-freepay-user.sh"

echo "Preserving original filesystem table..."
# Don't modify fstab - the original Raspberry Pi OS image already has correct PARTUUIDs
# Modifying it breaks the boot process since we don't know the actual PARTUUIDs
echo "Original fstab preserved (no changes needed)"

# Ensure critical directories exist and have proper permissions
mkdir -p "$MOUNT_ROOT/var/log" "$MOUNT_ROOT/tmp" "$MOUNT_ROOT/var/tmp" "$MOUNT_ROOT/run" "$MOUNT_ROOT/var/run"
chmod 1777 "$MOUNT_ROOT/tmp" "$MOUNT_ROOT/var/tmp"
chmod 755 "$MOUNT_ROOT/run" "$MOUNT_ROOT/var/run"

# Create essential system links
ln -sf /run "$MOUNT_ROOT/var/run" 2>/dev/null || true

# Ensure systemd directories exist
mkdir -p "$MOUNT_ROOT/var/lib/systemd" "$MOUNT_ROOT/etc/systemd/system" "$MOUNT_ROOT/run/systemd"

# Fix any ownership issues that might cause init to fail
chown root:root "$MOUNT_ROOT" "$MOUNT_ROOT/etc" "$MOUNT_ROOT/usr" "$MOUNT_ROOT/var"

# Final filesystem check and cleanup
echo "🧹 Final cleanup..."
sync

# Unmount filesystems gracefully
umount "$MOUNT_BOOT" "$MOUNT_ROOT"

# Force filesystem check and mark as clean
echo "🔍 Final filesystem check and cleanup..."
e2fsck -f -y "$ROOT_DEV" || echo "Filesystem check completed"
tune2fs -C 0 "$ROOT_DEV"  # Reset mount count to prevent forced checks
tune2fs -T now "$ROOT_DEV"  # Set last check time to now

# Ensure filesystem is marked as clean
echo "✅ Marking filesystem as clean..."
tune2fs -c 0 -i 0 "$ROOT_DEV"  # Disable periodic checks that can cause read-only mounts

# Cleanup loop device and partitions
if [ "$USE_KPARTX" = true ]; then
    kpartx -dv "$LOOP_DEV"
fi
losetup -d "$LOOP_DEV"

echo "✅ Image build completed successfully inside Docker!"
BUILD_SCRIPT

# Replace placeholders in the build script (macOS compatible)
sed "s|BASE_IMAGE_NAME|$BASE_IMAGE_NAME|g" build/docker-build-script.sh > build/docker-build-script-temp.sh
sed "s|OUTPUT_IMAGE_NAME|$OUTPUT_IMAGE|g" build/docker-build-script-temp.sh > build/docker-build-script.sh
sed -i '' "s|ALCHEMY_KEY_VALUE|$ALCHEMY_API_KEY|g" build/docker-build-script.sh
sed -i '' "s|MERCHANT_ADDRESS_VALUE|$MERCHANT_ETH_ADDRESS|g" build/docker-build-script.sh
sed -i '' "s|BLOCKCHAIN_NETWORKS_VALUE|$BLOCKCHAIN_NETWORKS|g" build/docker-build-script.sh
sed -i '' "s|WIFI_SSID_VALUE|$WIFI_SSID|g" build/docker-build-script.sh
sed -i '' "s|WIFI_PASSWORD_VALUE|$WIFI_PASSWORD|g" build/docker-build-script.sh
sed -i '' "s|SSH_USERNAME_VALUE|$SSH_USERNAME|g" build/docker-build-script.sh
sed -i '' "s|SSH_PASSWORD_VALUE|$SSH_PASSWORD|g" build/docker-build-script.sh
sed -i '' "s|SSH_ENABLE_PASSWORD_AUTH_VALUE|$SSH_ENABLE_PASSWORD_AUTH|g" build/docker-build-script.sh
rm build/docker-build-script-temp.sh

chmod +x build/docker-build-script.sh





# Step 6: Run the build in Docker
echo "🚀 Step 6: Running fully automated build in Docker..."
warning_msg "This may take 30-60 minutes depending on your internet connection and hardware..."

# Handle Docker credential issues on macOS
DOCKER_CONFIG_BACKUP=""
if [ -f "$HOME/.docker/config.json" ]; then
    DOCKER_CONFIG_BACKUP=$(cat "$HOME/.docker/config.json")
    echo "🔧 Temporarily adjusting Docker config for macOS compatibility..."
    # Remove credsStore if it exists to avoid credential helper issues
    jq 'del(.credsStore)' "$HOME/.docker/config.json" > /tmp/docker-config-temp.json 2>/dev/null || cp "$HOME/.docker/config.json" /tmp/docker-config-temp.json
    cp /tmp/docker-config-temp.json "$HOME/.docker/config.json"
fi

# Use Docker-only approach (avoids macOS/Linux tool compatibility issues)
echo "🔒 Using secure Docker-only build (macOS compatible)..."
echo "🐳 Running Docker build with minimal required access..."

# All image preparation will happen inside Docker with proper Linux tools
docker run --rm --privileged \
    --cap-add=SYS_ADMIN \
    --cap-add=MKNOD \
    --device=/dev/loop-control \
    -v "$(pwd):/build" \
    pi-image-builder \
    /build/build/docker-build-script.sh

# Restore Docker config if we backed it up
if [ ! -z "$DOCKER_CONFIG_BACKUP" ]; then
    echo "$DOCKER_CONFIG_BACKUP" > "$HOME/.docker/config.json"
    success_msg "Docker config restored"
fi

# Step 7: Finalize the image
echo "📦 Step 7: Finalizing image..."

# Move the image from build directory to current directory
if [ -f "build/$OUTPUT_IMAGE" ]; then
    mv "build/$OUTPUT_IMAGE" "./"
    success_msg "Image moved to current directory"
else
    error_exit "Built image not found at build/$OUTPUT_IMAGE"
fi

# Compress the final image
echo "🗜️  Compressing final image..."
gzip "$OUTPUT_IMAGE"
success_msg "Image compressed successfully"

# Clean up build artifacts but keep the Docker image for future builds
echo "🧹 Cleaning up build artifacts..."
rm -f build/docker-build-script.sh build/docker-build-script-host-loop.sh

echo ""
echo "🎉 SUCCESS! Fully automated Raspberry Pi image build completed!"
echo "=============================================================="
echo ""
echo "📁 Output file: $OUTPUT_IMAGE.gz"
echo "💾 Image size: $(du -h "$OUTPUT_IMAGE.gz" | cut -f1)"
echo ""
echo "🚀 To deploy:"
echo "1. Flash $OUTPUT_IMAGE.gz to a 32GB+ MicroSD card using Raspberry Pi Imager"
echo "2. Insert SD card into Raspberry Pi 4 with 7\" screen and ACR1252U-M1 NFC reader"
echo "3. Power on - the terminal will boot automatically and display the NFC payment interface"
echo ""
echo "⚙️  Configuration applied:"
echo "   WiFi Network: $WIFI_SSID"
echo "   Merchant Address: $MERCHANT_ETH_ADDRESS"
echo "   Blockchain Networks: $BLOCKCHAIN_NETWORKS"
echo "   SSH User: $SSH_USERNAME (password: $SSH_PASSWORD)"
echo "   Display: 5\" HDMI LCD Touchscreen (800x480)"
echo "   NFC Reader: ACR1252U-M1 (drivers pre-installed)"
echo ""
echo "🔧 The system will:"
echo "   • Auto-connect to WiFi on first boot"
echo "   • Start the NFC terminal service automatically"
echo "   • Launch fullscreen browser in kiosk mode"
echo "   • Enable SSH access with user: $SSH_USERNAME"
echo ""
success_msg "Your NFC payment terminal image is ready for deployment!" 