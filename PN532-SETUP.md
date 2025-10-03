# PN532 NFC Reader Setup Guide

This guide will help you set up your **HiLetgo PN532 NFC NXP RFID Module V3 Kit** to work with the merchant payment terminal.

## 🔧 Hardware Requirements

- **HiLetgo PN532 NFC NXP RFID Module V3 Kit**
- USB-to-Serial adapter (FTDI or similar) OR direct UART connection
- Jumper wires for connections
- Computer/Raspberry Pi with available USB port or UART pins

## 📋 Hardware Setup

### Option 1: USB Serial Connection (Recommended)

1. **Connect PN532 to USB-Serial Adapter:**
   ```
   PN532 Module    →    USB-Serial Adapter
   VCC (3.3V)      →    3.3V
   GND             →    GND
   TXD             →    RXD
   RXD             →    TXD
   ```

2. **Set PN532 to UART Mode:**
   - Set DIP switches on PN532 module:
     - SW1: OFF (UART mode)
     - SW2: OFF (UART mode)

3. **Connect USB-Serial adapter to your computer**

### Option 2: I2C Connection (Raspberry Pi) - **RECOMMENDED**

1. **Connect PN532 to Raspberry Pi I2C:**
   ```
   PN532 Module    →    Raspberry Pi GPIO
   VCC (3.3V)      →    Pin 1 (3.3V)
   GND             →    Pin 6 (GND)
   SDA             →    Pin 3 (GPIO 2, SDA)
   SCL             →    Pin 5 (GPIO 3, SCL)
   ```

2. **Set PN532 to I2C Mode:**
   - Set DIP switches on PN532 module:
     - SW1: ON (I2C mode)
     - SW2: OFF (I2C mode)

3. **Enable I2C on Raspberry Pi:**
   ```bash
   sudo raspi-config
   # Navigate to: Interface Options → I2C
   # Enable I2C: YES
   ```

4. **Install I2C tools and verify connection:**
   ```bash
   sudo apt-get install i2c-tools
   # Scan for I2C devices (should show 0x24)
   sudo i2cdetect -y 1
   ```

5. **Reboot Raspberry Pi**

### Option 3: Direct UART Connection (Raspberry Pi)

1. **Connect PN532 to Raspberry Pi GPIO:**
   ```
   PN532 Module    →    Raspberry Pi GPIO
   VCC (3.3V)      →    Pin 1 (3.3V)
   GND             →    Pin 6 (GND)
   TXD             →    Pin 10 (GPIO 15, RXD)
   RXD             →    Pin 8 (GPIO 14, TXD)
   ```

2. **Set PN532 to UART Mode:**
   - Set DIP switches on PN532 module:
     - SW1: OFF (UART mode)
     - SW2: OFF (UART mode)

3. **Enable UART on Raspberry Pi:**
   ```bash
   sudo raspi-config
   # Navigate to: Interface Options → Serial Port
   # Enable serial port hardware: YES
   # Enable serial console: NO
   ```

4. **Add to `/boot/config.txt`:**
   ```
   enable_uart=1
   dtoverlay=disable-bt
   ```

5. **Reboot Raspberry Pi**

## 🚀 Software Installation

### 1. Install Dependencies

```bash
# Navigate to your merchant app directory
cd /path/to/merchant-app

# Install the new PN532 dependencies
npm install pn532 ndef serialport i2c-bus

# Install additional type definitions (if needed)
npm install --save-dev @types/node
```

### 2. Configure Environment Variables

Copy the example environment file and configure it:

```bash
cp .env.example .env
```

Edit your `.env` file:

```env
# Set NFC reader type to PN532
NFC_READER_TYPE=PN532

# Configure PN532 serial port
# Common values:
# - Linux/Raspberry Pi: /dev/ttyUSB0, /dev/ttyAMA0, /dev/ttyS0
# - macOS: /dev/tty.usbserial-XXXX
# - Windows: COM1, COM2, etc.
PN532_SERIAL_PORT=/dev/ttyUSB0

# Baud rate (usually 115200)
PN532_BAUD_RATE=115200

# Connection type
PN532_CONNECTION_TYPE=UART
```

### 3. Find Your Serial Port

#### Linux/Raspberry Pi:
```bash
# List available serial ports
ls /dev/tty*

# Check for USB serial devices
ls /dev/ttyUSB*

# Check for UART devices
ls /dev/ttyAMA* /dev/ttyS*
```

#### macOS:
```bash
# List serial ports
ls /dev/tty.usbserial-*
ls /dev/cu.usbserial-*
```

#### Windows:
- Open Device Manager
- Look under "Ports (COM & LPT)"
- Note the COM port number (e.g., COM3)

### 4. Set Permissions (Linux/Raspberry Pi)

```bash
# Add your user to the dialout group
sudo usermod -a -G dialout $USER

# Set permissions for the serial port
sudo chmod 666 /dev/ttyUSB0  # Replace with your actual port

# Log out and log back in for group changes to take effect
```

## 🧪 Testing Your Setup

### 1. Test Serial Connection

Create a simple test script to verify the connection:

```javascript
// test-pn532.js
import { SerialPort } from 'serialport';
import { PN532 } from 'pn532';

const serialPort = new SerialPort({
  path: '/dev/ttyUSB0', // Replace with your port
  baudRate: 115200,
  autoOpen: false
});

serialPort.open((err) => {
  if (err) {
    console.error('Failed to open serial port:', err.message);
    return;
  }
  
  console.log('✅ Serial port opened successfully');
  
  const pn532 = new PN532(serialPort);
  
  pn532.on('ready', () => {
    console.log('✅ PN532 is ready!');
    
    pn532.getFirmwareVersion().then((version) => {
      console.log('📋 Firmware version:', version);
      process.exit(0);
    }).catch((error) => {
      console.error('❌ Error getting firmware version:', error);
      process.exit(1);
    });
  });
  
  pn532.on('error', (error) => {
    console.error('❌ PN532 error:', error);
    process.exit(1);
  });
});
```

Run the test:
```bash
node test-pn532.js
```

### 2. Test NFC Reading

```javascript
// test-nfc-read.js
import { SerialPort } from 'serialport';
import { PN532 } from 'pn532';

const serialPort = new SerialPort({
  path: '/dev/ttyUSB0', // Replace with your port
  baudRate: 115200
});

const pn532 = new PN532(serialPort);

pn532.on('ready', () => {
  console.log('✅ PN532 ready - Place an NFC tag near the reader...');
  
  // Poll for tags
  setInterval(async () => {
    try {
      const tag = await pn532.scanTag();
      if (tag) {
        console.log('📱 Tag detected:', tag.uid);
      }
    } catch (error) {
      // Ignore timeout errors during polling
      if (!error.message.includes('Timeout')) {
        console.error('Error:', error);
      }
    }
  }, 1000);
});

pn532.on('error', (error) => {
  console.error('❌ PN532 error:', error);
});
```

## 🚨 Troubleshooting

### Common Issues:

#### 1. "Permission denied" error
```bash
# Fix permissions
sudo chmod 666 /dev/ttyUSB0
# Or add user to dialout group
sudo usermod -a -G dialout $USER
```

#### 2. "Port not found" error
- Check if the USB-Serial adapter is properly connected
- Verify the correct port name using `ls /dev/tty*`
- Try different USB ports

#### 3. "Device not responding" error
- Check wiring connections
- Verify PN532 DIP switch settings (SW1: OFF, SW2: OFF for UART)
- Try different baud rates (9600, 38400, 115200)
- Check power supply (3.3V, not 5V)

#### 4. Raspberry Pi UART issues
```bash
# Disable Bluetooth to free up UART
sudo systemctl disable hciuart

# Add to /boot/config.txt
echo "dtoverlay=disable-bt" | sudo tee -a /boot/config.txt

# Use /dev/ttyS0 instead of /dev/ttyAMA0 on Pi 3/4
```

#### 5. "Module not found" errors
```bash
# Install missing dependencies
npm install pn532 ndef serialport i2c-bus @types/node
```

## 🎯 Running the Payment Terminal

Once everything is set up:

```bash
# Start the payment terminal
npm start
```

You should see:
```
🏭 NFCFactory: Creating NFC service for reader type: PN532
🔧 Creating PN532Service with serial port: /dev/ttyUSB0, baud rate: 115200
✅ Serial port /dev/ttyUSB0 opened successfully
💳 Instance #1 - PN532 Reader Ready
📡 PN532 Service is now listening for NFC tags.
```

## 📱 Testing Payments

1. Open the web interface at `http://localhost:3000`
2. Enter a payment amount and click "Charge"
3. Tap your NFC-enabled phone to the PN532 reader
4. The payment request should appear on your phone

## 🔄 Switching Back to ACR1252U

To switch back to the original ACR1252U reader:

1. Update your `.env` file:
   ```env
   NFC_READER_TYPE=ACR1252U
   ```

2. Restart the application:
   ```bash
   npm start
   ```

## 📞 Support

If you encounter issues:

1. Check the console logs for error messages
2. Verify all hardware connections
3. Test with the provided test scripts
4. Ensure all dependencies are installed correctly

The PN532 module should now work seamlessly with your merchant payment terminal! 🎉
