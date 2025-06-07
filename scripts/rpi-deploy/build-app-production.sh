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

# Create updated systemd services and helpers for freepay user
echo "⚙️  Creating freepay user services and helpers..."

# Update NFC terminal service for freepay user
cat > build/app-bundle/config/nfc-terminal.service << 'EOF'
[Unit]
Description=NFC Payment Terminal
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=freepay
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

# Create start-gui service
cat > build/app-bundle/config/start-gui.service << 'EOF'
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
EOF

# Create WiFi unblock service
cat > build/app-bundle/config/wifi-unblock.service << 'EOF'
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
EOF

# Create kiosk startup script
echo "🖥️  Creating kiosk startup script..."
cat > build/app-bundle/config/start-kiosk.sh << 'EOF'
#!/bin/bash
echo "Starting NFC Terminal Kiosk GUI..."

# Wait a moment for X11 to initialize
sleep 3

# Wait for NFC terminal service to be ready
echo "Waiting for NFC terminal service..."
timeout=120
while [ $timeout -gt 0 ]; do
    if curl -f http://localhost:3000 > /dev/null 2>&1; then
        echo "NFC terminal service ready"
        break
    fi
    echo "NFC terminal not ready, waiting... ($timeout seconds left)"
    sleep 2
    timeout=$((timeout - 2))
done

if [ $timeout -le 0 ]; then
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
EOF
chmod +x build/app-bundle/config/start-kiosk.sh

# Create touch screen calibration script
echo "📱 Creating touch screen calibration script..."
cat > build/app-bundle/config/calibrate-touch.sh << 'EOF'
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
echo "- Touch offset: adjust xmin, xmax, ymin, ymax values"
echo "- Sensitivity: adjust 'pmax' value"
echo ""
echo "Current configuration:"
grep "ads7846" /boot/config.txt || echo "No ads7846 configuration found"
EOF
chmod +x build/app-bundle/config/calibrate-touch.sh

# Create WiFi connection helper script
echo "📶 Creating WiFi helper script..."
cat > build/app-bundle/config/connect-wifi.sh << 'EOF'
#!/bin/bash
echo "WiFi Connection Helper"
echo "======================"
echo ""

# Check current WiFi status
echo "Current WiFi status:"
if rfkill list wifi | grep -q "Soft blocked: yes"; then
    echo "❌ WiFi is blocked by rfkill"
    echo "   Attempting to unblock..."
    sudo rfkill unblock wifi
    sleep 2
fi

iwconfig wlan0 2>/dev/null | grep ESSID

echo ""
echo "Attempting WiFi connection..."

# Check if wpa_supplicant is running
if pgrep -x "wpa_supplicant" > /dev/null; then
    echo "✅ wpa_supplicant is running"
else
    echo "🔄 Starting wpa_supplicant..."
    if sudo wpa_supplicant -B -i wlan0 -c /etc/wpa_supplicant/wpa_supplicant.conf; then
        echo "✅ wpa_supplicant started"
        sleep 5
        
        # Check if associated
        if iwconfig wlan0 2>/dev/null | grep -q "Access Point"; then
            echo "✅ WiFi associated"
            echo "   Getting IP address..."
            if sudo dhclient wlan0; then
                echo "✅ DHCP successful"
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
EOF
chmod +x build/app-bundle/config/connect-wifi.sh

# Create GUI debug script
echo "🔍 Creating GUI debug script..."
cat > build/app-bundle/config/debug-gui.sh << 'EOF'
#!/bin/bash
echo "🔍 NFC Terminal GUI Debug Script"
echo "================================="
echo ""

echo "📊 System Status:"
echo "- Uptime: $(uptime)"
echo "- Default target: $(systemctl get-default)"
echo "- Current user: $(whoami)"
echo "- Groups: $(groups)"
echo ""

echo "🔧 Service Status:"
echo "- NFC Terminal: $(systemctl is-active nfc-terminal.service)"
echo "- Start GUI: $(systemctl is-active start-gui.service)"
echo "- Display Setup: $(systemctl is-active display-setup.service)"
echo ""

echo "🌐 Network Status:"
echo "- NFC Terminal responding: $(curl -s -o /dev/null -w "%{http_code}" http://localhost:3000 || echo "No response")"
echo ""

echo "🖥️ Display Status:"
echo "- X11 processes: $(ps aux | grep -E '[Xx]org|xinit|startx' | wc -l) running"
echo "- Chromium processes: $(ps aux | grep -v grep | grep chromium | wc -l) running"
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
EOF
chmod +x build/app-bundle/config/debug-gui.sh

# Create .xinitrc for X11 startup
echo "🪟 Creating .xinitrc..."
cat > build/app-bundle/config/xinitrc << 'EOF'
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
EOF
chmod +x build/app-bundle/config/xinitrc

# Create .bashrc append for freepay user
echo "📝 Creating bashrc configuration..."
cat > build/app-bundle/config/bashrc-append << 'EOF'

# Auto-start X11 on login for display :0
if [ -z "$DISPLAY" ] && [ "$(tty)" = "/dev/tty1" ] && [ -z "$X11_STARTED" ]; then
    echo "Starting X11 session..."
    export X11_STARTED=1
    exec startx
fi
EOF

# Create X11 input configuration for 5" touchscreen
echo "👆 Creating X11 touch configuration..."
mkdir -p build/app-bundle/config/xorg.conf.d
cat > build/app-bundle/config/xorg.conf.d/99-calibration.conf << 'EOF'
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
EOF

# Create udev rule for WiFi unblocking
echo "📡 Creating udev rules..."
mkdir -p build/app-bundle/config/udev/rules.d
cat > build/app-bundle/config/udev/rules.d/10-wifi-unblock.rules << 'EOF'
# Automatically unblock WiFi on boot
ACTION=="add", SUBSYSTEM=="rfkill", ATTR{type}=="wlan", ATTR{state}="0"
EOF

# Create user setup scripts
echo "👤 Creating user setup scripts..."

# SSH user setup script
cat > build/app-bundle/config/setup-ssh-user.sh << 'EOF'
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
EOF
chmod +x build/app-bundle/config/setup-ssh-user.sh

# Freepay user setup script
cat > build/app-bundle/config/setup-freepay-user.sh << 'EOF'
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
EOF
chmod +x build/app-bundle/config/setup-freepay-user.sh

echo ""
echo "✅ Production build complete!"
echo ""
echo "Created files:"
echo "  - build/app-bundle/ (complete application bundle)"
echo "  - build/app-bundle/app/ (built application)"
echo "  - build/app-bundle/config/ (systemd services & helper scripts)"
echo "  - build/app-bundle/install-on-pi.sh (Pi installation script)"
echo "  - build/app-bundle/.env.template (environment template)"
echo ""
echo "Configuration files created:"
echo "  - *.service files (systemd services)"
echo "  - Helper scripts (start-kiosk.sh, debug-gui.sh, etc.)"
echo "  - X11 configuration (xinitrc, touch calibration)"
echo "  - User setup scripts (freepay & SSH users)"
echo ""
echo "Next: Run image creation script to embed this into Raspberry Pi image" 