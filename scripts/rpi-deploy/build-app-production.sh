#!/bin/bash
set -e

echo "🏗️  Building NFC Payment Terminal for Production Deployment..."

# Clean previous builds
echo "🧹 Cleaning previous builds..."
rm -rf ../../dist/
rm -rf build/app-bundle/

# Create production bundle directory
mkdir -p build/app-bundle

# Install dependencies and build TypeScript (from root)
echo "📦 Installing dependencies..."
cd ../../
npm ci --production=false

echo "🔨 Building TypeScript..."
npm run build

# Return to deployment directory
cd scripts/rpi-deploy

# Create production bundle structure
echo "📁 Creating production bundle..."
mkdir -p build/app-bundle/{app,config}

# Copy built application (from root dist)
cp -r ../../dist/* build/app-bundle/app/

# Copy package files for production install (from root)
cp ../../package.json build/app-bundle/
cp ../../package-lock.json build/app-bundle/

# Copy source files that might be needed (from root)
cp -r ../../src/web build/app-bundle/app/

# Create production package.json (remove dev dependencies)
echo "📦 Creating production package.json..."
node -e "
const pkg = require('../../package.json');
delete pkg.devDependencies;
pkg.scripts = {
  'start': 'node app/server.js'
};
require('fs').writeFileSync('build/app-bundle/package.json', JSON.stringify(pkg, null, 2));
"

# Create systemd service file
echo "⚙️  Creating systemd service file..."
cat > build/app-bundle/config/nfc-terminal.service << 'EOF'
[Unit]
Description=NFC Payment Terminal
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=pi
WorkingDirectory=/opt/nfc-terminal
Environment=NODE_ENV=production
EnvironmentFile=/opt/nfc-terminal/.env
ExecStart=/usr/bin/node app/server.js
Restart=always
RestartSec=10
StandardOutput=journal
StandardError=journal

# Security settings
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/opt/nfc-terminal

[Install]
WantedBy=multi-user.target
EOF

# Create WiFi connection service
echo "📶 Creating WiFi connection service..."
cat > build/app-bundle/config/wifi-connect.service << 'EOF'
[Unit]
Description=WiFi Connection Service
Before=network-online.target
After=systemd-networkd.service wifi-unblock.service
Wants=wifi-unblock.service

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'wpa_supplicant -B -i wlan0 -c /etc/wpa_supplicant/wpa_supplicant.conf && dhclient wlan0'
RemainAfterExit=yes
TimeoutStartSec=30

[Install]
WantedBy=multi-user.target
EOF

# Create display setup service
echo "🖥️  Creating display setup service..."
cat > build/app-bundle/config/display-setup.service << 'EOF'
[Unit]
Description=Setup 7inch Display
Before=graphical.target

[Service]
Type=oneshot
ExecStart=/bin/bash -c 'echo "Display setup complete"'
RemainAfterExit=yes

[Install]
WantedBy=graphical.target
EOF

# Create Chromium kiosk service
echo "🌐 Creating Chromium kiosk service..."
cat > build/app-bundle/config/chromium-kiosk.service << 'EOF'
[Unit]
Description=Chromium Kiosk Mode
After=graphical-session.target nfc-terminal.service
Requires=nfc-terminal.service

[Service]
Type=simple
User=pi
Environment=DISPLAY=:0
ExecStartPre=/bin/bash -c 'until curl -f http://localhost:3000; do sleep 2; done'
ExecStart=/usr/bin/chromium-browser --kiosk --disable-infobars --disable-session-crashed-bubble --disable-restore-session-state --disable-features=TranslateUI --no-first-run --fast --fast-start --disable-default-apps --disable-popup-blocking --disable-translate --disable-background-timer-throttling --disable-renderer-backgrounding --disable-device-discovery-notifications --autoplay-policy=no-user-gesture-required --no-sandbox --disable-dev-shm-usage http://localhost:3000
Restart=always
RestartSec=5

[Install]
WantedBy=graphical-session.target
EOF

# Create first-boot configuration script
echo "🚀 Creating first-boot setup script..."
cat > build/app-bundle/config/first-boot-setup.sh << 'EOF'
#!/bin/bash
set -e

echo "🚀 NFC Payment Terminal - First Boot Setup"

# Enable auto-login for pi user
echo "⚙️  Configuring auto-login..."
sudo systemctl set-default graphical.target
sudo mkdir -p /etc/systemd/system/getty@tty1.service.d/
cat > /tmp/autologin.conf << AUTOLOGIN
[Service]
ExecStart=
ExecStart=-/sbin/agetty --autologin pi --noclear %I \$TERM
AUTOLOGIN
sudo mv /tmp/autologin.conf /etc/systemd/system/getty@tty1.service.d/

# Configure X11 to start automatically
echo "🖥️  Configuring X11 auto-start..."
sudo -u pi mkdir -p /home/pi/.config/autostart
cat > /tmp/autostart-x.desktop << AUTOSTART
[Desktop Entry]
Type=Application
Name=Start X and Chromium
Exec=startx
Hidden=false
NoDisplay=false
X-GNOME-Autostart-enabled=true
AUTOSTART
sudo mv /tmp/autostart-x.desktop /home/pi/.config/autostart/
sudo chown pi:pi /home/pi/.config/autostart/autostart-x.desktop

# Create .xinitrc for pi user
echo "🌐 Configuring X11 startup..."
cat > /tmp/xinitrc << XINITRC
#!/bin/bash
# Disable screen blanking
xset -dpms
xset s off
xset s noblank

# Hide cursor
unclutter -idle 1 &

# Start window manager (lightweight)
openbox-session &

# Wait for window manager
sleep 2

# Start Chromium kiosk
chromium-browser --kiosk --no-sandbox --disable-infobars --disable-session-crashed-bubble --disable-restore-session-state --disable-features=TranslateUI --no-first-run --fast --fast-start --disable-default-apps --disable-popup-blocking --disable-translate --disable-background-timer-throttling --disable-renderer-backgrounding --disable-device-discovery-notifications --autoplay-policy=no-user-gesture-required --disable-dev-shm-usage http://localhost:3000
XINITRC
sudo mv /tmp/xinitrc /home/pi/.xinitrc
sudo chown pi:pi /home/pi/.xinitrc
sudo chmod +x /home/pi/.xinitrc

echo "✅ First boot setup complete"
echo "System will reboot to apply changes..."
sudo reboot
EOF
chmod +x build/app-bundle/config/first-boot-setup.sh

# Create install script for the Pi
echo "📥 Creating Pi installation script..."
cat > build/app-bundle/install-on-pi.sh << 'EOF'
#!/bin/bash
set -e

echo "📦 Installing NFC Payment Terminal on Raspberry Pi..."

# Update system
echo "🔄 Updating system packages..."
sudo apt update && sudo apt upgrade -y

# Install required packages
echo "📦 Installing required packages..."
sudo apt install -y nodejs npm chromium-browser openbox unclutter libnfc-bin libpcsclite-dev pcscd pcsc-tools

# Install ACR1252U-M1 specific drivers
echo "📡 Installing ACR1252U-M1 NFC reader drivers..."
wget -O /tmp/acsccid.deb http://downloads.acs.com.hk/drivers/en/API-ACR1252U-M1-P1.5.01/API-ACR1252U-M1-P1.5.01.tar.gz
cd /tmp && tar -xzf API-ACR1252U-M1-P1.5.01.tar.gz
sudo dpkg -i acsccid_*.deb || sudo apt-get install -f -y

# Install application
echo "📁 Installing application..."
sudo mkdir -p /opt/nfc-terminal
sudo cp -r app/* /opt/nfc-terminal/
sudo cp .env /opt/nfc-terminal/ 2>/dev/null || echo "⚠️  No .env file found - will be created by build script"
sudo chown -R pi:pi /opt/nfc-terminal

# Install application dependencies
echo "📦 Installing Node.js dependencies..."
cd /opt/nfc-terminal
sudo -u pi npm ci --production

# Install systemd services
echo "⚙️  Installing systemd services..."
sudo cp config/*.service /etc/systemd/system/
sudo systemctl daemon-reload

# Enable services
echo "🚀 Enabling services..."
sudo systemctl enable wifi-connect.service
sudo systemctl enable nfc-terminal.service
sudo systemctl enable display-setup.service

# Configure PCSC for NFC
echo "📡 Configuring NFC services..."
sudo systemctl enable pcscd
sudo usermod -a -G plugdev pi

echo "✅ Installation complete!"
echo "Run first-boot setup with: sudo ./config/first-boot-setup.sh"
EOF
chmod +x build/app-bundle/install-on-pi.sh

# Create environment template
echo "📝 Creating environment template..."
cat > build/app-bundle/.env.template << 'EOF'
# This file will be populated by the build script
# with values from build-config.env

NODE_ENV=production
PORT=3000
LOG_LEVEL=info

# These will be injected during build:
# ALCHEMY_API_KEY=
# MERCHANT_ETH_ADDRESS=
# BLOCKCHAIN_NETWORKS=
EOF

echo ""
echo "✅ Production build complete!"
echo ""
echo "Created files:"
echo "  - build/app-bundle/ (complete application bundle)"
echo "  - build/app-bundle/app/ (built application)"
echo "  - build/app-bundle/config/ (systemd services)"
echo "  - build/app-bundle/install-on-pi.sh (Pi installation script)"
echo "  - build/app-bundle/.env.template (environment template)"
echo ""
echo "Next: Run image creation script to embed this into Raspberry Pi image" 