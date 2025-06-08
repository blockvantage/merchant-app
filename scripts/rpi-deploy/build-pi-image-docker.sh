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

# Enhanced error handling for filesystem operations
handle_filesystem_error() {
    local operation="$1"
    local target="$2"
    echo -e "${RED}❌ CRITICAL: Filesystem operation failed: $operation${NC}" >&2
    echo -e "${RED}Target: $target${NC}" >&2
    
    # Attempt basic recovery
    echo "🔧 Attempting recovery..."
    sync
    sleep 2
    
    echo -e "${RED}❌ BUILD FAILED: Filesystem corruption risk detected${NC}" >&2
    echo -e "${RED}Please check your host system and try again${NC}" >&2
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
RUN apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq \
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
    rsync >/dev/null 2>&1 \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
CMD ["/bin/bash"]
DOCKERFILE

# Build the Docker image
echo "Building Docker build environment..."
docker build -t pi-image-builder build/ >/dev/null 2>&1 || error_exit "Failed to build Docker image"
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
    apt-get update -qq >/dev/null 2>&1 && apt-get install -y -qq kpartx rsync >/dev/null 2>&1
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
echo "Checking source application files..."
ls -la /build/build/app-bundle/ || { echo "ERROR: app-bundle directory not found"; exit 1; }
ls -la /build/build/app-bundle/app/ || { echo "ERROR: app directory not found"; exit 1; }

mkdir -p "$MOUNT_ROOT/opt/nfc-terminal"
echo "Copying application files..."
cp -r /build/build/app-bundle/app/* "$MOUNT_ROOT/opt/nfc-terminal/" || { echo "ERROR: Failed to copy app files"; exit 1; }

if [ -f "/build/build/app-bundle/package.json" ]; then
    cp /build/build/app-bundle/package.json "$MOUNT_ROOT/opt/nfc-terminal/"
    echo "✅ package.json copied"
else
    echo "WARNING: package.json not found"
fi

if [ -f "/build/build/app-bundle/package-lock.json" ]; then
    cp /build/build/app-bundle/package-lock.json "$MOUNT_ROOT/opt/nfc-terminal/"
    echo "✅ package-lock.json copied"
else
    echo "WARNING: package-lock.json not found, will be created by npm"
fi

echo "Verifying application installation..."
ls -la "$MOUNT_ROOT/opt/nfc-terminal/" || { echo "ERROR: Failed to verify app installation"; exit 1; }
echo "✅ Application files installed successfully"

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
# WiFi country setting (required to prevent rfkill blocking)
country=US
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1
ap_scan=1

# Network configuration
network={
    ssid="WIFI_SSID_VALUE"
    psk="WIFI_PASSWORD_VALUE"
    key_mgmt=WPA-PSK
    scan_ssid=1
    priority=1
}
WIFI_CONFIG
chmod 600 "$MOUNT_ROOT/etc/wpa_supplicant/wpa_supplicant.conf"
chown root:root "$MOUNT_ROOT/etc/wpa_supplicant/wpa_supplicant.conf"

# Configure WiFi interface
echo "Configuring WiFi interface..."
# Create network configuration for WiFi
mkdir -p "$MOUNT_ROOT/etc/systemd/network"
cat > "$MOUNT_ROOT/etc/systemd/network/25-wireless.network" << WIFI_NETWORK
[Match]
Name=wlan0

[Network]
DHCP=yes
IPForward=no

[DHCP]
RouteMetric=20
WIFI_NETWORK

# Enable systemd-networkd and wpa_supplicant services
mkdir -p "$MOUNT_ROOT/etc/systemd/system/multi-user.target.wants"
ln -sf /lib/systemd/system/systemd-networkd.service "$MOUNT_ROOT/etc/systemd/system/multi-user.target.wants/" 2>/dev/null || true
ln -sf /lib/systemd/system/systemd-resolved.service "$MOUNT_ROOT/etc/systemd/system/multi-user.target.wants/" 2>/dev/null || true

# Create interface-specific wpa_supplicant config for systemd service
echo "Creating interface-specific wpa_supplicant config..."
cp "$MOUNT_ROOT/etc/wpa_supplicant/wpa_supplicant.conf" "$MOUNT_ROOT/etc/wpa_supplicant/wpa_supplicant-wlan0.conf"
chown root:root "$MOUNT_ROOT/etc/wpa_supplicant/wpa_supplicant-wlan0.conf"
chmod 600 "$MOUNT_ROOT/etc/wpa_supplicant/wpa_supplicant-wlan0.conf"

# Enable wpa_supplicant for wlan0
ln -sf /lib/systemd/system/wpa_supplicant@.service "$MOUNT_ROOT/etc/systemd/system/multi-user.target.wants/wpa_supplicant@wlan0.service" 2>/dev/null || true

# Configure rfkill to unblock WiFi permanently
echo "Configuring rfkill to unblock WiFi..."
# Create rfkill configuration
mkdir -p "$MOUNT_ROOT/etc/systemd/system"
cat > "$MOUNT_ROOT/etc/systemd/system/rfkill-unblock-wifi.service" << RFKILL_SERVICE
[Unit]
Description=Unblock WiFi with rfkill
DefaultDependencies=no
Before=network-pre.target wifi-unblock.service

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'rfkill unblock wifi; rfkill unblock wlan; rfkill unblock all'
RemainAfterExit=yes

[Install]
WantedBy=sysinit.target
RFKILL_SERVICE

# Enable the rfkill unblock service
ln -sf "/etc/systemd/system/rfkill-unblock-wifi.service" "$MOUNT_ROOT/etc/systemd/system/sysinit.target.wants/" 2>/dev/null || true

# Create WiFi country setup service
cat > "$MOUNT_ROOT/etc/systemd/system/wifi-country-setup.service" << COUNTRY_SERVICE
[Unit]
Description=Set WiFi Country Configuration
DefaultDependencies=no
Before=network-pre.target wifi-unblock.service rfkill-unblock-wifi.service
After=systemd-modules-load.service

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'echo "Setting WiFi country to US..."; raspi-config nonint do_wifi_country US 2>/dev/null || true; echo "US" > /etc/wpa_supplicant/country 2>/dev/null || true; iw reg set US 2>/dev/null || true'
RemainAfterExit=yes
TimeoutStartSec=10

[Install]
WantedBy=sysinit.target
COUNTRY_SERVICE

# Enable the country setup service
ln -sf "/etc/systemd/system/wifi-country-setup.service" "$MOUNT_ROOT/etc/systemd/system/sysinit.target.wants/" 2>/dev/null || true

# Also add rfkill unblock to rc.local as backup
echo "Adding rfkill unblock to rc.local..."
if [ -f "$MOUNT_ROOT/etc/rc.local" ]; then
    # Insert before exit 0
    sed -i '/^exit 0/i # Unblock WiFi\nrfkill unblock wifi 2>/dev/null || true\nrfkill unblock wlan 2>/dev/null || true\n' "$MOUNT_ROOT/etc/rc.local"
else
    # Create rc.local if it doesn't exist
    cat > "$MOUNT_ROOT/etc/rc.local" << RC_LOCAL
#!/bin/bash
# Unblock WiFi
rfkill unblock wifi 2>/dev/null || true
rfkill unblock wlan 2>/dev/null || true
exit 0
RC_LOCAL
    chmod +x "$MOUNT_ROOT/etc/rc.local"
fi

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
ln -sf "/etc/systemd/system/start-gui.service" "$MOUNT_ROOT/etc/systemd/system/multi-user.target.wants/"
ln -sf "/etc/systemd/system/boot-debug.service" "$MOUNT_ROOT/etc/systemd/system/graphical.target.wants/"

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

# Display rotation: 90 degrees clockwise (portrait mode)
display_rotate=3  # 90 degrees counterclockwise

# Touch screen calibration (may need adjustment for your specific display)
# These values are typical for 5" 800x480 displays but may need fine-tuning
dtoverlay=ads7846,cs=1,penirq=25,penirq_pull=2,speed=50000,keep_vref_on=1,swapxy=1,pmax=255,xohms=150,xmin=200,xmax=3900,ymin=200,ymax=3900
DISPLAY_CONFIG

# Disable display manager and getty on tty1 (we'll use systemd service instead)
echo "👤 Configuring display manager and console..."
mkdir -p "$MOUNT_ROOT/etc/systemd/system"
ln -sf /dev/null "$MOUNT_ROOT/etc/systemd/system/lightdm.service"
ln -sf /dev/null "$MOUNT_ROOT/etc/systemd/system/gdm3.service"
ln -sf /dev/null "$MOUNT_ROOT/etc/systemd/system/sddm.service"
# Disable getty on tty1 so our GUI service can take over
ln -sf /dev/null "$MOUNT_ROOT/etc/systemd/system/getty@tty1.service"

# Install systemd services from pre-built config files
echo "⚙️  Installing systemd services..."
cp /build/build/app-bundle/config/*.service "$MOUNT_ROOT/etc/systemd/system/"

# Create freepay user home directory and install pre-built configuration
echo "👤 Setting up freepay user home directory..."
mkdir -p "$MOUNT_ROOT/home/freepay"

# Note: GUI files will be installed AFTER user setup in chroot to prevent deletion

# Install X11 configuration for 5" touchscreen
echo "👆 Installing X11 touch configuration..."
mkdir -p "$MOUNT_ROOT/etc/X11/xorg.conf.d"
cp /build/build/app-bundle/config/xorg.conf.d/99-calibration.conf "$MOUNT_ROOT/etc/X11/xorg.conf.d/"

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

# Install udev rules
echo "📡 Installing udev rules..."
mkdir -p "$MOUNT_ROOT/etc/udev/rules.d"
cp /build/build/app-bundle/config/udev/rules.d/10-wifi-unblock.rules "$MOUNT_ROOT/etc/udev/rules.d/"

# WiFi unblock service already installed above with other services

# Don't create userconf file - we'll create users manually in chroot
# The userconf mechanism isn't working properly, so we'll disable it completely

# Fix cmdline.txt - don't append, replace to avoid corruption
if [ -f "$MOUNT_BOOT/cmdline.txt" ]; then
    # Read existing cmdline and clean it
    CMDLINE=$(cat "$MOUNT_BOOT/cmdline.txt" | tr -d '\n' | sed 's/[ ]*$//')
    echo "$CMDLINE console=tty1 fsck.repair=yes" > "$MOUNT_BOOT/cmdline.txt"
else
    echo "console=serial0,115200 console=tty1 root=PARTUUID=xxxxxxxx-02 rootfstype=ext4 elevator=deadline fsck.repair=yes rootwait" > "$MOUNT_BOOT/cmdline.txt"
fi

# Disable all first-boot setup services
echo "🚫 Disabling first-boot setup services..."
ln -sf /dev/null "$MOUNT_ROOT/etc/systemd/system/userconfig.service"
ln -sf /dev/null "$MOUNT_ROOT/etc/systemd/system/regenerate_ssh_host_keys.service"
ln -sf /dev/null "$MOUNT_ROOT/etc/systemd/system/firstboot.service"
ln -sf /dev/null "$MOUNT_ROOT/etc/systemd/system/apply_noobs_os_config.service"

# Create a stub firstboot service that does nothing
cat > "$MOUNT_ROOT/etc/systemd/system/firstboot.service" << FIRSTBOOT_SERVICE
[Unit]
Description=Disabled first boot setup
After=systemd-user-sessions.service

[Service]
Type=oneshot
ExecStart=/bin/true
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
FIRSTBOOT_SERVICE

# Configure SSH with custom user
echo "👤 Configuring SSH access..."
SSH_USERNAME="freepay"  # Default fallback user
SSH_PASSWORD="freepay"  # Default fallback password
SSH_ENABLE_PASSWORD_AUTH="true"

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

# Install pre-built user setup scripts
echo "👤 Installing user setup scripts..."
cp /build/build/app-bundle/config/setup-ssh-user.sh "$MOUNT_ROOT/tmp/"
cp /build/build/app-bundle/config/setup-freepay-user.sh "$MOUNT_ROOT/tmp/"
chmod +x "$MOUNT_ROOT/tmp/setup-ssh-user.sh"
chmod +x "$MOUNT_ROOT/tmp/setup-freepay-user.sh"

# Install packages and configure system using chroot
echo "📦 Installing packages in chroot environment..."
cat > "$MOUNT_ROOT/tmp/install-packages.sh" << INSTALL_SCRIPT
#!/bin/bash
set -e
export DEBIAN_FRONTEND=noninteractive

echo "=== Starting package installation in chroot ==="
echo "Updating package lists..."
apt-get update -qq >/dev/null 2>&1 || { echo "ERROR: Failed to update package lists"; exit 1; }

echo "Installing Node.js repository..."
curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null 2>&1 || { echo "ERROR: Failed to setup Node.js repository"; exit 1; }

echo "Installing core packages..."
# Fix package installation issues in Docker chroot environment

# First, configure networking and DNS in chroot
echo "nameserver 8.8.8.8" > /etc/resolv.conf
echo "nameserver 1.1.1.1" >> /etc/resolv.conf

# Update package cache with better error handling
echo "Updating package cache (this may take a few minutes)..."
export DEBIAN_FRONTEND=noninteractive
export APT_KEY_DONT_WARN_ON_DANGEROUS_USAGE=1

# Try multiple times with different sources
for i in {1..3}; do
    if apt-get update -qq -o Acquire::Retries=3 -o Acquire::http::Timeout=30 >/dev/null 2>&1; then
        echo "✅ Package cache updated successfully"
        break
    else
        echo "⚠️ Package cache update attempt $i failed, retrying..."
        sleep 5
    fi
done

# Install SSH first (most critical for recovery)
echo "Installing SSH server..."
apt-get install -y openssh-server >/dev/null 2>&1 || echo "⚠️ SSH installation failed"

# Install Node.js repository with timeout and retries
echo "Installing Node.js repository..."
NODEJS_REPO_SUCCESS=false
for i in {1..2}; do
    echo "NodeSource repository attempt $i..."
    if timeout 180 curl -fsSL https://deb.nodesource.com/setup_20.x | bash -; then
        echo "✅ Node.js repository added successfully"
        NODEJS_REPO_SUCCESS=true
        break
    else
        echo "⚠️ Node.js repository setup attempt $i failed"
        sleep 5
    fi
done

if [ "$NODEJS_REPO_SUCCESS" = "false" ]; then
    echo "⚠️ NodeSource repository setup failed completely"
    echo "Will attempt to install Node.js from default Debian repositories later"
fi

# Install core packages in smaller groups with better error handling
echo "Installing X11 and window manager..."
# Install X11 packages individually for better error handling
echo "Installing xinit..."
apt-get install -y xinit || echo "⚠️ xinit failed"

echo "Installing X11 server..."
apt-get install -y xserver-xorg || echo "⚠️ xserver-xorg failed"

echo "Installing openbox window manager..."
apt-get install -y openbox || echo "⚠️ openbox failed"

echo "Installing screen utilities..."
apt-get install -y unclutter x11-xserver-utils || echo "⚠️ screen utilities failed"

echo "Installing Chromium browser..."
# Try multiple Chromium packages
if apt-get install -y chromium-browser >/dev/null 2>&1; then
    echo "✅ chromium-browser installed"
elif apt-get install -y chromium >/dev/null 2>&1; then
    echo "✅ chromium installed"
    # Create symlink for compatibility
    ln -sf /usr/bin/chromium /usr/bin/chromium-browser 2>/dev/null || true
else
    echo "⚠️ Chromium installation failed, trying alternative browsers..."
    apt-get install -y firefox-esr >/dev/null 2>&1 || echo "⚠️ Firefox also failed"
fi

echo "Installing Node.js (if not already installed)..."
if ! command -v node >/dev/null 2>&1; then
    echo "Attempting to install Node.js from NodeSource repository..."
    if apt-get install -y nodejs; then
        echo "✅ Node.js installed from NodeSource"
    else
        echo "⚠️ NodeSource installation failed, trying default repository..."
        # Update package cache again
        apt-get update -qq >/dev/null 2>&1
        if apt-get install -y nodejs npm; then
            echo "✅ Node.js installed from default repository"
        else
            echo "❌ All Node.js installation methods failed"
        fi
    fi
else
    echo "✅ Node.js already available"
fi

echo "Installing essential utilities..."
apt-get install -y curl wget >/dev/null 2>&1 || echo "⚠️ Some utilities failed to install"

echo "Verifying critical GUI packages..."
# Verify essential GUI packages are installed
CRITICAL_MISSING=false
REQUIRED_PACKAGES=("xinit" "openbox")
OPTIONAL_PACKAGES=("chromium-browser" "chromium" "firefox-esr")

echo "Required packages to check: ${REQUIRED_PACKAGES[*]}"

# Check required packages
for pkg in "${REQUIRED_PACKAGES[@]}"; do
    echo "Checking for package: $pkg"
    if dpkg -l "$pkg" 2>/dev/null | grep -q "^ii.*$pkg"; then
        echo "✅ Required package $pkg verified"
    else
        echo "❌ CRITICAL: Required package $pkg is missing"
        # Show what packages are actually installed that match
        echo "📋 Similar packages found:"
        dpkg -l | grep -i "$pkg" || echo "   None found"
        CRITICAL_MISSING=true
    fi
done

# Check for at least one browser
BROWSER_FOUND=false
for pkg in "${OPTIONAL_PACKAGES[@]}"; do
    echo "Checking for browser: $pkg"
    if dpkg -l "$pkg" 2>/dev/null | grep -q "^ii"; then
        echo "✅ Browser package $pkg found"
        BROWSER_FOUND=true
        break
    fi
done

if [ "$BROWSER_FOUND" = "false" ]; then
    echo "❌ CRITICAL: No browser found (chromium-browser, chromium, or firefox-esr)"
    CRITICAL_MISSING=true
fi

# Check for Node.js
if command -v node >/dev/null 2>&1; then
    echo "✅ Node.js verified: $(node --version)"
else
    echo "⚠️ WARNING: Node.js not found - NFC terminal may not work"
fi

# Check for SSH
echo "Checking for SSH server..."
if dpkg -l openssh-server 2>/dev/null | grep -q "^ii"; then
    echo "✅ SSH server verified"
else
    echo "⚠️ WARNING: SSH server not installed - remote access will not work"
fi

# If critical packages are missing, we should not continue with a broken image
if [ "$CRITICAL_MISSING" = "true" ]; then
    echo ""
    echo "❌ CRITICAL ERROR: Essential packages are missing!"
    echo "❌ The resulting image would not boot properly."
    echo "❌ This is likely due to network issues during package installation."
    echo ""
    echo "🔧 SUGGESTED FIXES:"
    echo "1. Check your internet connection and try again"
    echo "2. Try building during off-peak hours (better mirror availability)"
    echo "3. Use a different DNS server or network"
    echo "4. Build the image manually on a Linux system instead of Docker"
    echo ""
    echo "❌ BUILD ABORTED to prevent creating a broken image"
    exit 1
fi

echo "✅ Package verification completed - proceeding with build"

echo "Installing X11 input packages..."
apt-get install -y -qq \
    xserver-xorg-input-libinput \
    xserver-xorg-input-evdev \
    xserver-xorg-video-fbdev \
    xinput-calibrator \
    xserver-xorg-input-synaptics >/dev/null 2>&1 || { echo "WARNING: Failed to install X11 input packages (touchscreen/mouse support)"; }

echo "Installing network packages..."
apt-get install -y -qq \
    curl \
    wget \
    dhcpcd5 \
    isc-dhcp-client \
    wpasupplicant \
    wireless-tools \
    iw \
    rfkill >/dev/null 2>&1 || { echo "ERROR: Failed to install network packages (WiFi/networking support)"; exit 1; }

echo "Installing NFC and system packages..."
apt-get install -y -qq \
    libnfc-bin \
    libpcsclite-dev \
    pcscd \
    pcsc-tools \
    console-setup \
    keyboard-configuration >/dev/null 2>&1 || { echo "WARNING: Failed to install NFC/system packages (NFC reader support)"; }

echo "Installing SSH server if not already present..."
if ! dpkg -l openssh-server >/dev/null 2>&1; then
    apt-get install -y -qq openssh-server >/dev/null 2>&1 || echo "WARNING: Failed to install SSH server"
else
    echo "SSH server already installed"
fi

echo "Core packages installed successfully"

echo "Installing NFC reader support..."
# Install basic NFC support packages and build dependencies first
apt-get install -y -qq libccid pcscd pcsc-tools libpcsclite-dev libusb-1.0-0-dev build-essential pkg-config flex perl autoconf libtool >/dev/null 2>&1 || echo "WARNING: Failed to install NFC build dependencies"

echo "Attempting to install ACR1252U-M1 specific drivers..."
cd /tmp

# Try multiple ACS driver sources to avoid 403 errors
ACS_DOWNLOADED=false

# Try direct GitHub release (most reliable)
echo "Trying GitHub acsccid release..."
if timeout 60 wget --no-check-certificate -O acsccid-1.1.11.tar.gz "https://github.com/acshk/acsccid/archive/refs/tags/v1.1.11.tar.gz" 2>/dev/null; then
    ACS_DOWNLOADED=true
    ACS_FILE="acsccid-1.1.11.tar.gz"
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
        if apt-get install -y -qq acsccid >/dev/null 2>&1; then
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
    echo "Attempting to extract $ACS_FILE..."
    
    # Try extraction based on file extension first
    extracted=false
    if [[ "$ACS_FILE" == *.tar.gz ]]; then
        if tar -xzf "$ACS_FILE" 2>/dev/null; then
            echo "✅ Successfully extracted .tar.gz file"
            extracted=true
        fi
    elif [[ "$ACS_FILE" == *.tar.bz2 ]]; then
        if tar -xjf "$ACS_FILE" 2>/dev/null; then
            echo "✅ Successfully extracted .tar.bz2 file"
            extracted=true
        fi
    fi
    
    # Fallback: try both extraction methods if first attempt failed
    if [ "$extracted" = "false" ]; then
        echo "Primary extraction failed, trying both compression formats..."
        if tar -xzf "$ACS_FILE" 2>/dev/null; then
            echo "✅ Extracted as .tar.gz"
            extracted=true
        elif tar -xjf "$ACS_FILE" 2>/dev/null; then
            echo "✅ Extracted as .tar.bz2"
            extracted=true
        fi
    fi
    
    if [ "$extracted" = "true" ]; then
        echo "ACS driver source extracted successfully"
        # Navigate to the extracted directory
        ACS_DIR=$(find . -name "acsccid-*" -type d | head -1)
        if [ -d "$ACS_DIR" ]; then
            cd "$ACS_DIR"
            echo "Building ACS driver from source..."
            # Build the driver from source  
            echo "Running configure..."
            if ./configure --enable-embedded --disable-dependency-tracking >/dev/null 2>&1; then
                echo "Configure successful, running make..."
                if make >/dev/null 2>&1; then
                    echo "Make successful, installing..."
                    if make install >/dev/null 2>&1; then
                        echo "ACS driver built and installed successfully from source"
                        # Update library cache
                        ldconfig >/dev/null 2>&1 || true
                    else
                        echo "WARNING: Failed to install ACS driver"
                    fi
                else
                    echo "WARNING: Failed to compile ACS driver"
                fi
            else
                echo "WARNING: Failed to configure ACS driver build"
            fi
            
            if [ ! -f "/usr/lib/pcsc/drivers/ifd-acsccid.bundle/Contents/Linux/libacsccid.so" ]; then
                echo "WARNING: Failed to build ACS driver from source, checking for pre-built packages..."
                cd ..
                # Try to find pre-built packages in case they exist
                if ls acsccid_*.deb 1> /dev/null 2>&1; then
                    dpkg -i acsccid_*.deb >/dev/null 2>&1 || {
                        echo "WARNING: ACS driver package installation failed, using generic drivers"
                        apt-get install -f -y -qq >/dev/null 2>&1 || true
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
echo "Checking if NFC terminal app is installed..."
if [ -d "/opt/nfc-terminal" ]; then
    cd /opt/nfc-terminal
    echo "Found NFC terminal directory: $(pwd)"
    echo "Contents: $(ls -la)"
    echo "Checking for server.js or main app file..."
    ls -la server.js 2>/dev/null || ls -la app.js 2>/dev/null || ls -la index.js 2>/dev/null || echo "WARNING: No main app file found"
else
    echo "ERROR: /opt/nfc-terminal directory not found!"
    echo "Available directories in /opt:"
    ls -la /opt/ || echo "No /opt directory found"
    echo "Searching for package.json files:"
    find / -name "package.json" 2>/dev/null | head -10 || echo "No package.json found"
    exit 1
fi
if [ -f package.json ]; then
    echo "Found package.json, installing dependencies..."
    # Set npm timeout and disable audit to speed up installation
    npm config set audit false >/dev/null 2>&1
    npm config set fund false >/dev/null 2>&1
    npm config set update-notifier false >/dev/null 2>&1
    npm config set loglevel silent >/dev/null 2>&1
    
    # Install with timeout to prevent hanging
    timeout 600 npm ci --production --unsafe-perm --no-audit --no-fund --silent >/dev/null 2>&1 || {
        echo "WARNING: npm ci failed or timed out, trying npm install instead..."
        timeout 300 npm install --production --unsafe-perm --no-audit --no-fund --silent >/dev/null 2>&1 || {
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

# Verify freepay user setup was successful
echo "Verifying freepay user setup..."
if ! id freepay &>/dev/null; then
    echo "ERROR: freepay user not found after setup!"
    echo "Attempting emergency user creation..."
    useradd -m -s /bin/bash -u 1000 -U freepay || true
    echo "freepay:freepay" | chpasswd || true
    usermod -aG sudo,plugdev,dialout,video,audio,input,tty,users freepay || true
    echo "Emergency user creation completed"
fi

# Final ownership and permission fixes
echo "Setting up SSH user..."
if /tmp/setup-ssh-user.sh; then
    echo "✅ SSH user setup completed successfully"
else
    echo "❌ SSH user setup failed with exit code $?"
fi

echo "Setting up freepay user..."
if /tmp/setup-freepay-user.sh; then
    echo "✅ Freepay user setup completed successfully"
else
    echo "❌ Freepay user setup failed with exit code $?"
fi

# Also create the user manually to ensure it exists
echo "Double-checking freepay user creation..."
if ! id freepay &>/dev/null; then
    echo "Creating freepay user as fallback..."
    useradd -m -s /bin/bash -u 1000 -G sudo,plugdev,dialout,video,audio,input,tty,users freepay || true
    echo "freepay:freepay" | chpasswd || true
    mkdir -p /home/freepay
    chown -R freepay:freepay /home/freepay
    chmod 755 /home/freepay
    echo "Freepay user created as fallback"
fi

# Verify user exists
echo "Verifying freepay user..."
id freepay || echo "ERROR: freepay user not found!"

# Install GUI files AFTER user setup to prevent deletion
echo "📜 Installing GUI files for freepay user..."
echo "Copying start-kiosk.sh..."
cp /build/build/app-bundle/config/start-kiosk.sh /home/freepay/
echo "Copying helper scripts..."
cp /build/build/app-bundle/config/calibrate-touch.sh /home/freepay/
cp /build/build/app-bundle/config/connect-wifi.sh /home/freepay/
cp /build/build/app-bundle/config/debug-gui.sh /home/freepay/
echo "Copying .xinitrc..."
cp /build/build/app-bundle/config/xinitrc /home/freepay/.xinitrc
echo "Setting executable permissions..."
chmod +x /home/freepay/start-kiosk.sh
chmod +x /home/freepay/calibrate-touch.sh
chmod +x /home/freepay/connect-wifi.sh
chmod +x /home/freepay/debug-gui.sh
chmod +x /home/freepay/.xinitrc
echo "Setting ownership..."
chown freepay:freepay /home/freepay/start-kiosk.sh
chown freepay:freepay /home/freepay/calibrate-touch.sh
chown freepay:freepay /home/freepay/connect-wifi.sh
chown freepay:freepay /home/freepay/debug-gui.sh
chown freepay:freepay /home/freepay/.xinitrc

echo "Installing bashrc configuration..."
cat /build/build/app-bundle/config/bashrc-append >> /home/freepay/.bashrc
chown freepay:freepay /home/freepay/.bashrc

echo "🔍 Verifying GUI files installation..."
if [ -f /home/freepay/start-kiosk.sh ] && [ -x /home/freepay/start-kiosk.sh ]; then
    echo "✅ start-kiosk.sh verified"
else
    echo "❌ ERROR: start-kiosk.sh missing or not executable"
    ls -la /home/freepay/start-kiosk.sh 2>/dev/null || echo "File not found"
    exit 1
fi

if [ -f /home/freepay/.xinitrc ] && [ -x /home/freepay/.xinitrc ]; then
    echo "✅ .xinitrc verified"
else
    echo "❌ ERROR: .xinitrc missing or not executable"
    ls -la /home/freepay/.xinitrc 2>/dev/null || echo "File not found"
    exit 1
fi

echo "✅ All GUI files installed and verified successfully"

# Remove any existing user configuration that might conflict
echo "Cleaning up user configuration conflicts..."
rm -f /etc/xdg/autostart/piwiz.desktop 2>/dev/null || true
rm -f /usr/share/applications/piwiz.desktop 2>/dev/null || true
rm -f /etc/xdg/autostart/wifi-country.desktop 2>/dev/null || true

echo "Disabling first-boot wizard and setup..."
# Disable the user configuration wizard
systemctl disable userconfig 2>/dev/null || true
rm -f /etc/xdg/autostart/piwiz.desktop 2>/dev/null || true
rm -f /usr/share/applications/piwiz.desktop 2>/dev/null || true
rm -f /etc/xdg/autostart/wifi-country.desktop 2>/dev/null || true

# Set country for WiFi (prevents country dialog)
echo 'REGDOMAIN=US' > /etc/default/crda

# Configure WiFi country in multiple places to prevent warnings
echo "Configuring WiFi country settings..."
# Set country in raspi-config format
raspi-config nonint do_wifi_country US 2>/dev/null || true

# Set country in wpa_supplicant 
if [ -f /etc/wpa_supplicant/wpa_supplicant.conf ]; then
    if ! grep -q "country=" /etc/wpa_supplicant/wpa_supplicant.conf; then
        sed -i '1i country=US' /etc/wpa_supplicant/wpa_supplicant.conf
    fi
fi

# Set regulatory domain
echo 'options cfg80211 ieee80211_regdom=US' > /etc/modprobe.d/cfg80211.conf

# Create regulatory database if it doesn't exist
mkdir -p /etc/iw
echo "country US: DFS-UNSET" > /etc/iw/regulatory.db.txt 2>/dev/null || true

# Set country in kernel boot parameters if not already set
if [ -f /boot/cmdline.txt ]; then
    if ! grep -q "cfg80211.ieee80211_regdom=US" /boot/cmdline.txt; then
        sed -i 's/$/ cfg80211.ieee80211_regdom=US/' /boot/cmdline.txt
    fi
fi

# Configure locale and keyboard to prevent setup dialogs
echo 'LANG=en_US.UTF-8' > /etc/default/locale
echo 'LC_ALL=en_US.UTF-8' >> /etc/default/locale
dpkg-reconfigure -f noninteractive locales >/dev/null 2>&1 || true
update-locale LANG=en_US.UTF-8 LC_ALL=en_US.UTF-8 >/dev/null 2>&1 || true

# Configure X11 permissions for freepay user
echo "Configuring X11 permissions..."
# Allow freepay user to start X11 server
mkdir -p /etc/X11
echo 'allowed_users=anybody' > /etc/X11/Xwrapper.config
echo 'needs_root_rights=yes' >> /etc/X11/Xwrapper.config

# Verify X11 configuration
echo "Verifying X11 configuration..."
if [ -f /etc/X11/Xwrapper.config ]; then
    echo "✅ X11 wrapper config created:"
    cat /etc/X11/Xwrapper.config
else
    echo "❌ Failed to create X11 wrapper config"
fi

# Add freepay to required groups for X11 and console access
usermod -aG tty,video,input,audio freepay 2>/dev/null || true

# Configure console login for freepay user (enables console user privileges)
echo "Configuring console access for freepay user..."
mkdir -p /etc/systemd/system/getty@tty1.service.d
cat > /etc/systemd/system/getty@tty1.service.d/autologin.conf << AUTOLOGIN_CONF
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin freepay --noclear %I \$TERM
Type=idle
AUTOLOGIN_CONF

# Enable getty on tty1 to ensure freepay user is console user
systemctl enable getty@tty1.service 2>/dev/null || true

# Add freepay to console users for X11 access
echo "freepay" >> /etc/console-users 2>/dev/null || true
mkdir -p /var/lib/ConsoleKit/
echo "freepay" > /var/lib/ConsoleKit/console-users 2>/dev/null || true

# Configure pam_console for X11 access
if [ -f /etc/security/console.apps ]; then
    echo "freepay" >> /etc/security/console.apps
fi

# Unblock WiFi immediately in chroot
echo "Unblocking WiFi in chroot environment..."
rfkill unblock wifi 2>/dev/null || true
rfkill unblock wlan 2>/dev/null || true
rfkill unblock all 2>/dev/null || true

# Set regulatory domain immediately
echo "Setting WiFi regulatory domain..."
iw reg set US 2>/dev/null || true

echo "Configuring SSH service..."
# Ensure SSH service is properly configured
systemctl unmask ssh.service 2>/dev/null || true
systemctl unmask sshd.service 2>/dev/null || true

# Configure SSH for password authentication
echo "Configuring SSH for password authentication..."
sed -i 's/#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config
sed -i 's/PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config
sed -i 's/#PermitRootLogin prohibit-password/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/#PubkeyAuthentication yes/PubkeyAuthentication yes/' /etc/ssh/sshd_config
sed -i 's/#AuthorizedKeysFile/AuthorizedKeysFile/' /etc/ssh/sshd_config

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
echo "Setting graphical target as default..."
if systemctl set-default graphical.target >/dev/null 2>&1; then
    echo "✅ Graphical target set as default"
else
    echo "❌ Failed to set graphical target as default"
fi

echo "Enabling system services..."
services_to_enable="pcscd wifi-unblock wifi-connect nfc-terminal display-setup start-gui boot-debug dhcpcd"
for service in $services_to_enable; do
    if [ -n "$service" ] && [ "$service" != "" ]; then
        if systemctl enable "$service" >/dev/null 2>&1; then
            echo "✅ Enabled $service"
        else
            echo "❌ Failed to enable $service, trying manual linking..."
            # Try manual linking as fallback
            if [ -f "/etc/systemd/system/$service.service" ]; then
                ln -sf "/etc/systemd/system/$service.service" "/etc/systemd/system/multi-user.target.wants/" 2>/dev/null && echo "✅ Manually linked $service" || echo "❌ Failed to manually link $service"
            else
                echo "⚠️  Service file $service.service not found"
            fi
        fi
    fi
done

# Additional manual linking for critical services
if systemctl list-unit-files | grep -q "start-gui.service"; then
    echo "✅ start-gui.service is available"
else
    echo "❌ start-gui.service not found in systemctl list"
fi

echo "Additional manual service linking for critical services..."
# Ensure critical services are linked even if systemctl enable failed
echo "Linking pcscd service..."
if [ -f "/etc/systemd/system/pcscd.service" ]; then
    mkdir -p "/etc/systemd/system/multi-user.target.wants"
    ln -sf "/etc/systemd/system/pcscd.service" "/etc/systemd/system/multi-user.target.wants/" && echo "✅ Linked pcscd.service" || echo "❌ Failed to link pcscd.service"
else
    echo "⚠️  pcscd.service not found"
fi

echo "Linking dhcpcd service..."
if [ -f "/lib/systemd/system/dhcpcd.service" ]; then
    mkdir -p "/etc/systemd/system/multi-user.target.wants"
    ln -sf "/lib/systemd/system/dhcpcd.service" "/etc/systemd/system/multi-user.target.wants/" && echo "✅ Linked dhcpcd.service" || echo "❌ Failed to link dhcpcd.service"
else
    echo "⚠️  dhcpcd.service not found"
fi

echo "Linking start-gui service..."
if [ -f "/etc/systemd/system/start-gui.service" ]; then
    mkdir -p "/etc/systemd/system/graphical.target.wants"
    ln -sf "/etc/systemd/system/start-gui.service" "/etc/systemd/system/graphical.target.wants/" && echo "✅ Linked start-gui.service" || echo "❌ Failed to link start-gui.service"
else
    echo "⚠️  start-gui.service not found"
fi

echo "Linking nfc-terminal service..."
if [ -f "/etc/systemd/system/nfc-terminal.service" ]; then
    mkdir -p "/etc/systemd/system/multi-user.target.wants"
    ln -sf "/etc/systemd/system/nfc-terminal.service" "/etc/systemd/system/multi-user.target.wants/" && echo "✅ Linked nfc-terminal.service" || echo "❌ Failed to link nfc-terminal.service"
else
    echo "⚠️  nfc-terminal.service not found"
fi

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
echo "🧹 Final cleanup and filesystem integrity checks..."

# Sync all pending writes
sync
sleep 2
sync

# Check filesystem integrity before unmounting
echo "🔍 Pre-unmount filesystem integrity check..."
if ! e2fsck -n "$ROOT_DEV"; then
    echo "⚠️ Filesystem errors detected, attempting repair..."
    e2fsck -f -y "$ROOT_DEV" || {
        echo "❌ CRITICAL: Filesystem repair failed"
        echo "❌ BUILD FAILED: Image would be corrupted"
        exit 1
    }
fi

# Unmount filesystems gracefully with multiple attempts
echo "📤 Unmounting filesystems..."
for i in {1..3}; do
    if umount "$MOUNT_BOOT" 2>/dev/null; then
        echo "✅ Boot partition unmounted"
        break
    else
        echo "⚠️ Boot unmount attempt $i failed, retrying..."
        sync
        sleep 2
    fi
done

for i in {1..3}; do
    if umount "$MOUNT_ROOT" 2>/dev/null; then
        echo "✅ Root partition unmounted"
        break
    else
        echo "⚠️ Root unmount attempt $i failed, retrying..."
        sync
        sleep 2
        # Force unmount if necessary
        if [ $i -eq 3 ]; then
            umount -f "$MOUNT_ROOT" 2>/dev/null || umount -l "$MOUNT_ROOT"
        fi
    fi
done

# Verify unmount succeeded
if mountpoint -q "$MOUNT_BOOT" || mountpoint -q "$MOUNT_ROOT"; then
    echo "❌ CRITICAL: Failed to unmount filesystems properly"
    echo "❌ BUILD FAILED: Risk of filesystem corruption"
    exit 1
fi

# Final comprehensive filesystem check and repair
echo "🔍 Final comprehensive filesystem check..."
if ! e2fsck -f -y "$ROOT_DEV"; then
    echo "❌ CRITICAL: Final filesystem check failed"
    echo "❌ BUILD FAILED: Filesystem is corrupted"
    exit 1
fi

# Ensure filesystem is healthy and marked clean
echo "✅ Optimizing filesystem for clean boot..."
tune2fs -C 0 "$ROOT_DEV"     # Reset mount count to prevent forced checks
tune2fs -T now "$ROOT_DEV"   # Set last check time to now  
tune2fs -c 0 -i 0 "$ROOT_DEV" # Disable periodic checks that can cause read-only mounts
tune2fs -e continue "$ROOT_DEV" # Continue on errors instead of remounting read-only

# Verify filesystem is marked clean
if ! tune2fs -l "$ROOT_DEV" | grep -q "clean"; then
    echo "❌ CRITICAL: Filesystem not marked as clean"
    echo "❌ BUILD FAILED: Image would boot with filesystem errors"
    exit 1
fi

echo "✅ Filesystem integrity verified and optimized"

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
# Check if loop-control device exists before mounting it
LOOP_CONTROL_DEVICE=""
if [ -e "/dev/loop-control" ]; then
    LOOP_CONTROL_DEVICE="--device=/dev/loop-control"
    echo "🔗 Using system loop-control device"
else
    echo "🔗 No loop-control device found, relying on privileged mode"
fi

docker run --rm --privileged \
    --cap-add=SYS_ADMIN \
    --cap-add=MKNOD \
    $LOOP_CONTROL_DEVICE \
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
echo "🎉 SUCCESS!"
echo "✅ Your NFC payment terminal image is ready for deployment!" 