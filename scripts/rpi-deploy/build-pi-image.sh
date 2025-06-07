#!/bin/bash
set -e

echo "🍓 Building Complete Raspberry Pi Image for NFC Payment Terminal"
echo "=============================================================="

# Configuration
CONFIG_FILE="build-config.env"
BASE_IMAGE_URL="https://downloads.raspberrypi.org/raspios_lite_arm64/images/raspios_lite_arm64-2024-11-19/2024-11-19-raspios-bookworm-arm64-lite.img.xz"
BASE_IMAGE_NAME="2024-11-19-raspios-bookworm-arm64-lite.img"
OUTPUT_IMAGE="nfc-terminal-$(date +%Y%m%d).img"
MOUNT_DIR="build/mount"

# Cleanup function
cleanup() {
    echo "🧹 Cleaning up..."
    source build/fdisk-util.sh
    unmount_image_partitions "$MOUNT_DIR" 2>/dev/null || true
    sudo losetup -D 2>/dev/null || true
}
trap cleanup EXIT

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

# Step 4: Create working copy of image
echo "💾 Step 4: Creating working copy of image..."
cp "build/images/$BASE_IMAGE_NAME" "build/$OUTPUT_IMAGE"

# Expand image to have more space (add 2GB)
echo "📈 Expanding image size..."
dd if=/dev/zero bs=1M count=2048 >> "build/$OUTPUT_IMAGE"

# Fix partition table and expand filesystem
echo "🔧 Expanding filesystem..."
# Get the start of partition 2
START_SECTOR=$(fdisk -l "build/$OUTPUT_IMAGE" | grep "${OUTPUT_IMAGE}2" | awk '{print $2}')

# Use fdisk to expand partition 2
fdisk "build/$OUTPUT_IMAGE" << FDISK_INPUT
d
2
n
p
2
$START_SECTOR

w
FDISK_INPUT

# Step 5: Mount image partitions
echo "🔗 Step 5: Mounting image partitions..."
source build/fdisk-util.sh
mount_image_partitions "build/$OUTPUT_IMAGE" "$MOUNT_DIR"

# Step 6: Install application in image
echo "📦 Step 6: Installing application in image..."

# Create application directory
sudo mkdir -p "$MOUNT_DIR/root/opt/nfc-terminal"

# Copy application files
sudo cp -r build/app-bundle/app/* "$MOUNT_DIR/root/opt/nfc-terminal/"
sudo cp build/app-bundle/package*.json "$MOUNT_DIR/root/opt/nfc-terminal/"

# Create .env file with actual values
echo "📝 Creating environment file..."
cat > /tmp/nfc-terminal.env << ENV_FILE
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
ALCHEMY_API_KEY=$ALCHEMY_API_KEY
MERCHANT_ETH_ADDRESS=$MERCHANT_ETH_ADDRESS
BLOCKCHAIN_NETWORKS=$BLOCKCHAIN_NETWORKS
ENV_FILE
sudo mv /tmp/nfc-terminal.env "$MOUNT_DIR/root/opt/nfc-terminal/.env"

# Step 7: Configure WiFi
echo "📶 Step 7: Configuring WiFi..."
sudo mkdir -p "$MOUNT_DIR/root/etc/wpa_supplicant"
cat > /tmp/wpa_supplicant.conf << WIFI_CONFIG
country=US
ctrl_interface=DIR=/var/run/wpa_supplicant GROUP=netdev
update_config=1

network={
    ssid="$WIFI_SSID"
    psk="$WIFI_PASSWORD"
    key_mgmt=WPA-PSK
}
WIFI_CONFIG
sudo mv /tmp/wpa_supplicant.conf "$MOUNT_DIR/root/etc/wpa_supplicant/wpa_supplicant.conf"
sudo chmod 600 "$MOUNT_DIR/root/etc/wpa_supplicant/wpa_supplicant.conf"

# Enable WiFi interface
echo "interface wlan0" | sudo tee -a "$MOUNT_DIR/root/etc/dhcpcd.conf"

# Step 8: Install systemd services
echo "⚙️  Step 8: Installing systemd services..."
sudo cp build/app-bundle/config/*.service "$MOUNT_DIR/root/etc/systemd/system/"

# Enable services by creating symlinks
sudo mkdir -p "$MOUNT_DIR/root/etc/systemd/system/multi-user.target.wants"
sudo ln -sf "/etc/systemd/system/wifi-connect.service" "$MOUNT_DIR/root/etc/systemd/system/multi-user.target.wants/"
sudo ln -sf "/etc/systemd/system/nfc-terminal.service" "$MOUNT_DIR/root/etc/systemd/system/multi-user.target.wants/"

# Step 9: Configure display and kiosk mode
echo "🖥️  Step 9: Configuring display and kiosk mode..."

# Enable GPU memory split for graphics
if ! grep -q "gpu_mem" "$MOUNT_DIR/boot/config.txt"; then
    echo "gpu_mem=128" | sudo tee -a "$MOUNT_DIR/boot/config.txt"
fi

# Configure display for 7" screen
cat | sudo tee -a "$MOUNT_DIR/boot/config.txt" << DISPLAY_CONFIG

# 7" Display Configuration
hdmi_group=2
hdmi_mode=87
hdmi_cvt=800 480 60 6 0 0 0
hdmi_drive=1
display_rotate=0
DISPLAY_CONFIG

# Create auto-login configuration
sudo mkdir -p "$MOUNT_DIR/root/etc/systemd/system/getty@tty1.service.d"
cat > /tmp/autologin.conf << AUTOLOGIN_CONFIG
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin pi --noclear %I \$TERM
AUTOLOGIN_CONFIG
sudo mv /tmp/autologin.conf "$MOUNT_DIR/root/etc/systemd/system/getty@tty1.service.d/"

# Configure X11 auto-start for pi user
sudo mkdir -p "$MOUNT_DIR/root/home/pi/.config/autostart"
cat > /tmp/kiosk-autostart.desktop << KIOSK_CONFIG
[Desktop Entry]
Type=Application
Name=NFC Terminal Kiosk
Exec=/home/pi/start-kiosk.sh
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
KIOSK_CONFIG
sudo mv /tmp/kiosk-autostart.desktop "$MOUNT_DIR/root/home/pi/.config/autostart/"

# Create kiosk startup script
cat > /tmp/start-kiosk.sh << KIOSK_SCRIPT
#!/bin/bash
# Wait for network and application
sleep 10

# Start X if not running
if [ -z "\$DISPLAY" ]; then
    export DISPLAY=:0
    startx &
    sleep 5
fi

# Configure display
xset -dpms
xset s off 
xset s noblank

# Hide cursor
unclutter -idle 1 &

# Wait for application to be ready
until curl -f http://localhost:3000 > /dev/null 2>&1; do
    sleep 2
done

# Start Chromium in kiosk mode
chromium-browser --kiosk --no-sandbox --disable-infobars --disable-session-crashed-bubble --disable-restore-session-state --disable-features=TranslateUI --no-first-run --fast --fast-start --disable-default-apps --disable-popup-blocking --disable-translate --disable-background-timer-throttling --disable-renderer-backgrounding --disable-device-discovery-notifications --autoplay-policy=no-user-gesture-required --disable-dev-shm-usage http://localhost:3000
KIOSK_SCRIPT
sudo mv /tmp/start-kiosk.sh "$MOUNT_DIR/root/home/pi/"
sudo chmod +x "$MOUNT_DIR/root/home/pi/start-kiosk.sh"

# Step 10: Install required packages (chroot)
echo "📦 Step 10: Installing required packages..."

# Enable SSH for easier debugging (optional)
sudo touch "$MOUNT_DIR/root/boot/ssh"

# Create package installation script
cat > /tmp/install-packages.sh << INSTALL_SCRIPT
#!/bin/bash
export DEBIAN_FRONTEND=noninteractive

# Update package lists
apt-get update

# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | bash -
apt-get install -y nodejs

# Install other required packages
apt-get install -y \
    chromium-browser \
    openbox \
    unclutter \
    libnfc-bin \
    libpcsclite-dev \
    pcscd \
    pcsc-tools \
    xserver-xorg \
    xinit \
    curl \
    wget

# Enable required services
systemctl enable pcscd
systemctl enable ssh

# Install Node.js dependencies for the app
cd /opt/nfc-terminal
npm ci --production

# Set proper ownership
chown -R pi:pi /opt/nfc-terminal
chown -R pi:pi /home/pi

# Add pi user to required groups
usermod -a -G plugdev pi
INSTALL_SCRIPT

# Copy and run the script in chroot
sudo mv /tmp/install-packages.sh "$MOUNT_DIR/root/tmp/"
sudo chmod +x "$MOUNT_DIR/root/tmp/install-packages.sh"

# Run installation in chroot
echo "Running package installation in chroot..."
sudo chroot "$MOUNT_DIR/root" /tmp/install-packages.sh

# Step 11: Final cleanup and unmount
echo "🏁 Step 11: Final cleanup..."
sudo rm -f "$MOUNT_DIR/root/tmp/install-packages.sh"

# Unmount partitions
unmount_image_partitions "$MOUNT_DIR"

# Run filesystem check and resize
echo "🔧 Running filesystem check and resize..."
# First, we need to setup loop device to access partition 2
LOOP_DEV=$(sudo losetup --show -f -P "build/$OUTPUT_IMAGE")
sudo e2fsck -f -y "${LOOP_DEV}p2" || true
sudo resize2fs "${LOOP_DEV}p2"
sudo losetup -d "$LOOP_DEV"

# Compress final image
echo "🗜️  Compressing final image..."
gzip -c "build/$OUTPUT_IMAGE" > "$OUTPUT_IMAGE.gz"
rm "build/$OUTPUT_IMAGE"

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
echo ""
echo "✅ The device will automatically:"
echo "   - Connect to WiFi"
echo "   - Start the NFC payment terminal"
echo "   - Display the interface fullscreen"
echo "   - Accept NFC payments to your merchant address" 