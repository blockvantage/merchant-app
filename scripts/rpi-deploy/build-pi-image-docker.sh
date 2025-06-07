#!/bin/bash
set -e

echo "🐳 Building Raspberry Pi Image using Docker (macOS Compatible)"
echo "=============================================================="

# Configuration
CONFIG_FILE="build-config.env"
BASE_IMAGE_URL="https://downloads.raspberrypi.org/raspios_lite_arm64/images/raspios_lite_arm64-2024-11-19/2024-11-19-raspios-bookworm-arm64-lite.img.xz"
BASE_IMAGE_NAME="2024-11-19-raspios-bookworm-arm64-lite.img"
OUTPUT_IMAGE="nfc-terminal-$(date +%Y%m%d).img"

# Check if Docker is available
if ! command -v docker &> /dev/null; then
    echo "❌ Docker is required for macOS builds but not found"
    echo "Please install Docker Desktop from: https://docker.com/products/docker-desktop"
    exit 1
fi

# Step 1: Validate configuration
echo "✅ Step 1: Validating configuration..."
source build/validate-config.sh
validate_config "$CONFIG_FILE"
source "$CONFIG_FILE"

# Step 2: Download base image if needed
echo "📥 Step 2: Preparing base Raspberry Pi OS image..."
if [ ! -f "build/images/$BASE_IMAGE_NAME" ]; then
    echo "Downloading Raspberry Pi OS Lite..."
    mkdir -p build/images
    wget -O "build/images/$BASE_IMAGE_NAME.xz" "$BASE_IMAGE_URL"
    echo "Extracting image..."
    cd build/images
    xz -d "$BASE_IMAGE_NAME.xz"
    cd ../..
else
    echo "Base image already exists."
fi

# Step 3: Build application
echo "🏗️  Step 3: Building application for production..."
./build-app-production.sh

# Step 4: Create Docker build environment
echo "🐳 Step 4: Setting up Docker build environment..."

# Create Dockerfile for the build environment
cat > build/Dockerfile << 'DOCKERFILE'
FROM ubuntu:22.04

RUN apt-get update && apt-get install -y \
    fdisk \
    e2fsprogs \
    dosfstools \
    wget \
    curl \
    xz-utils \
    mount \
    qemu-user-static \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /build
DOCKERFILE

# Build the Docker image
echo "Building Docker image..."
docker build -t pi-image-builder build/

# Step 5: Run the build in Docker
echo "🏗️  Step 5: Running image build in Docker..."

# Create the Docker build script
cat > build/docker-build-script.sh << 'BUILD_SCRIPT'
#!/bin/bash
set -e

echo "🔧 Building image inside Docker container..."

# Copy image to working location
cp "/build/images/IMAGE_NAME" "/build/OUTPUT_IMAGE"

# Expand image size
dd if=/dev/zero bs=1M count=2048 >> "/build/OUTPUT_IMAGE"

# Get partition information and expand
echo "📈 Expanding filesystem..."
START_SECTOR=$(fdisk -l "/build/OUTPUT_IMAGE" | grep "OUTPUT_IMAGE2" | awk '{print $2}')

# Expand partition 2
fdisk "/build/OUTPUT_IMAGE" << FDISK_INPUT
d
2
n
p
2
$START_SECTOR

w
FDISK_INPUT

# Create loop device and mount
echo "🔗 Setting up loop device..."
LOOP_DEV=$(losetup --show -f -P "/build/OUTPUT_IMAGE")
echo "Loop device: $LOOP_DEV"

# Mount partitions
mkdir -p /mnt/boot /mnt/root
mount "${LOOP_DEV}p1" /mnt/boot
mount "${LOOP_DEV}p2" /mnt/root

# Install application
echo "📦 Installing application..."
mkdir -p /mnt/root/opt/nfc-terminal
cp -r /build/app-bundle/app/* /mnt/root/opt/nfc-terminal/
cp /build/app-bundle/package*.json /mnt/root/opt/nfc-terminal/

# Create .env file
cat > /mnt/root/opt/nfc-terminal/.env << ENV_FILE
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
ALCHEMY_API_KEY=ALCHEMY_KEY_PLACEHOLDER
MERCHANT_ETH_ADDRESS=MERCHANT_ADDRESS_PLACEHOLDER
BLOCKCHAIN_NETWORKS=BLOCKCHAIN_NETWORKS_PLACEHOLDER
ENV_FILE

# Configure WiFi
mkdir -p /mnt/root/etc/wpa_supplicant
cat > /mnt/root/etc/wpa_supplicant/wpa_supplicant.conf << WIFI_CONFIG
country=US
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1

network={
    ssid="WIFI_SSID_PLACEHOLDER"
    psk="WIFI_PASSWORD_PLACEHOLDER"
    key_mgmt=WPA-PSK
}
WIFI_CONFIG
chmod 600 /mnt/root/etc/wpa_supplicant/wpa_supplicant.conf

# Install systemd services
cp /build/app-bundle/config/*.service /mnt/root/etc/systemd/system/

# Enable services
mkdir -p /mnt/root/etc/systemd/system/multi-user.target.wants
ln -sf "/etc/systemd/system/wifi-connect.service" "/mnt/root/etc/systemd/system/multi-user.target.wants/"
ln -sf "/etc/systemd/system/nfc-terminal.service" "/mnt/root/etc/systemd/system/multi-user.target.wants/"

# Configure display
if ! grep -q "gpu_mem" /mnt/boot/config.txt; then
    echo "gpu_mem=128" >> /mnt/boot/config.txt
fi

cat >> /mnt/boot/config.txt << DISPLAY_CONFIG

# 7" Display Configuration
hdmi_group=2
hdmi_mode=87
hdmi_cvt=800 480 60 6 0 0 0
hdmi_drive=1
display_rotate=0
DISPLAY_CONFIG

# Configure auto-login
mkdir -p /mnt/root/etc/systemd/system/getty@tty1.service.d
cat > /mnt/root/etc/systemd/system/getty@tty1.service.d/autologin.conf << AUTOLOGIN_CONFIG
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin pi --noclear %I \$TERM
AUTOLOGIN_CONFIG

# Create kiosk startup script
mkdir -p /mnt/root/home/pi
cat > /mnt/root/home/pi/start-kiosk.sh << KIOSK_SCRIPT
#!/bin/bash
sleep 10
export DISPLAY=:0
if [ -z "\$DISPLAY" ]; then
    startx &
    sleep 5
fi
xset -dpms; xset s off; xset s noblank
unclutter -idle 1 &
until curl -f http://localhost:3000 > /dev/null 2>&1; do sleep 2; done
chromium-browser --kiosk --no-sandbox --disable-infobars --disable-session-crashed-bubble --disable-restore-session-state --disable-features=TranslateUI --no-first-run --fast --fast-start --disable-default-apps --disable-popup-blocking --disable-translate --disable-background-timer-throttling --disable-renderer-backgrounding --disable-device-discovery-notifications --autoplay-policy=no-user-gesture-required --disable-dev-shm-usage http://localhost:3000
KIOSK_SCRIPT
chmod +x /mnt/root/home/pi/start-kiosk.sh

# Enable SSH
touch /mnt/root/boot/ssh

# Install packages using chroot
echo "📦 Installing packages in chroot..."
cat > /mnt/root/tmp/install-packages.sh << INSTALL_SCRIPT
#!/bin/bash
export DEBIAN_FRONTEND=noninteractive
apt-get update
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs chromium-browser openbox unclutter libnfc-bin libpcsclite-dev pcscd pcsc-tools xserver-xorg xinit curl wget
systemctl enable pcscd ssh
cd /opt/nfc-terminal && npm ci --production
chown -R pi:pi /opt/nfc-terminal /home/pi
usermod -a -G plugdev pi
INSTALL_SCRIPT
chmod +x /mnt/root/tmp/install-packages.sh

# Run in chroot
chroot /mnt/root /tmp/install-packages.sh

# Cleanup
rm /mnt/root/tmp/install-packages.sh

# Unmount and cleanup
echo "🧹 Cleaning up..."
umount /mnt/boot /mnt/root
e2fsck -f -y "${LOOP_DEV}p2" || true
resize2fs "${LOOP_DEV}p2"
losetup -d "$LOOP_DEV"

echo "✅ Build complete in container"
BUILD_SCRIPT

# Replace placeholders in the build script
sed -i '' "s|IMAGE_NAME|$BASE_IMAGE_NAME|g" build/docker-build-script.sh
sed -i '' "s|OUTPUT_IMAGE|$OUTPUT_IMAGE|g" build/docker-build-script.sh
sed -i '' "s|ALCHEMY_KEY_PLACEHOLDER|$ALCHEMY_API_KEY|g" build/docker-build-script.sh
sed -i '' "s|MERCHANT_ADDRESS_PLACEHOLDER|$MERCHANT_ETH_ADDRESS|g" build/docker-build-script.sh
sed -i '' "s|BLOCKCHAIN_NETWORKS_PLACEHOLDER|$BLOCKCHAIN_NETWORKS|g" build/docker-build-script.sh
sed -i '' "s|WIFI_SSID_PLACEHOLDER|$WIFI_SSID|g" build/docker-build-script.sh
sed -i '' "s|WIFI_PASSWORD_PLACEHOLDER|$WIFI_PASSWORD|g" build/docker-build-script.sh

chmod +x build/docker-build-script.sh

# Run the build in Docker with privileged mode for loop devices
echo "🚀 Running build in Docker container..."
docker run --rm --privileged \
    -v "$(pwd)/build:/build" \
    -v "$(pwd)/$OUTPUT_IMAGE:/build/$OUTPUT_IMAGE" \
    pi-image-builder \
    /build/docker-build-script.sh

# Compress the final image
echo "🗜️  Compressing final image..."
gzip -c "$OUTPUT_IMAGE" > "$OUTPUT_IMAGE.gz"
rm "$OUTPUT_IMAGE"

echo ""
echo "🎉 SUCCESS! Raspberry Pi image created successfully!"
echo "=============================================="
echo ""
echo "📁 Output file: $OUTPUT_IMAGE.gz"
echo "💾 Image size: $(du -h "$OUTPUT_IMAGE.gz" | cut -f1)"
echo ""
echo "🚀 To deploy:"
echo "1. Flash $OUTPUT_IMAGE.gz to a 32GB+ MicroSD card using Raspberry Pi Imager"
echo "2. Insert SD card into Raspberry Pi 4 with 7\" screen connected"
echo "3. Power on - the terminal will boot automatically"
echo ""
echo "⚙️  Configuration used:"
echo "   WiFi Network: $WIFI_SSID"
echo "   Merchant Address: $MERCHANT_ETH_ADDRESS"
echo "   Blockchain Networks: $BLOCKCHAIN_NETWORKS" 