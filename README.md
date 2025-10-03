# NFC Payment Terminal

A multi-chain NFC payment terminal that processes cryptocurrency payments across 5 blockchain networks with real-time transaction monitoring and comprehensive history tracking.

## 🌐 Supported Networks

- **Ethereum**
- **Base** 
- **Arbitrum** 
- **Optimism** 
- **Polygon** 

### 🎯 **Smart Payment Priority**

Rather than negotiate a chain / token combo with the merchant, the payment terminal handles it automatically. First it figures out a chain the merchant supports that you also have funds on, then sends a transaction with ETH or an ERC-20 token with this priority:

```
L2 Stablecoin > L2 Other > L2 ETH > L1 Stablecoin > L1 Other > L1 ETH
```

## 🚀 Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Environment setup:**
   ```bash
   cp .env.example .env
   # Edit .env and set your values:
   # - ALCHEMY_API_KEY: Get from https://www.alchemy.com/
   # - MERCHANT_ADDRESS: Your Ethereum wallet address to receive payments
   ```

3. **Run the terminal:**
   ```bash
   npm start
   ```

4. **Open the interface:**
   Navigate to `http://localhost:3000`

## ⚙️ Configuration

### Required Environment Variables

Create a `.env` file with the following variables:

```env
# Alchemy API key for blockchain interactions (required)
ALCHEMY_API_KEY=your_alchemy_api_key_here

# Merchant wallet address to receive payments (required)
MERCHANT_ADDRESS=0xYourWalletAddressHere
```

**Important:** 
- The `MERCHANT_ADDRESS` is where all payments will be sent across all supported chains
- Make sure this is an address you control and have the private keys for
- The same address will be used on all networks (Ethereum, Base, Arbitrum, etc.)

## 🏗️ Architecture

```
src/
├── server.ts                   # Express server & WebSocket handler
├── app.ts                     # Main application orchestrator
├── web/index.html             # Payment terminal UI
├── config/index.ts            # Multi-chain configuration
└── services/
    ├── nfcService.ts          # NFC reader & wallet scanning
    ├── alchemyService.ts      # Multi-chain balance & monitoring
    ├── paymentService.ts      # Payment selection & EIP-681 generation
    ├── ethereumService.ts     # Address validation utilities
    └── addressProcessor.ts    # Duplicate processing prevention
scripts/
└── rpi-deploy/
    ├── setup-build-environment.sh  # Install dependencies to allow building a Raspberry Pi image
    └── build-pi-image-osx.sh       # Build a Raspberry Pi image
```

## 💡 Usage

### **Processing Payments**
1. Enter amount using the keypad (cents-based: "150" = $1.50)
2. Tap "Charge" to initiate payment
3. Customer taps NFC device to send payment
4. Real-time monitoring confirms transaction
5. "Approved" message with block explorer link

### **Transaction History**
1. Tap the 📜 history button on the keypad
2. View all transactions or scan a wallet for specific history
3. Tap "📱 Scan Wallet for History" and have customer tap their device
4. Browse filtered transactions for that specific wallet


## 🔄 Payment Flow

1. **NFC Detection** → Customer taps device
2. **Multi-Chain Fetching** → Portfolio analysis across all 6 chains
3. **Smart Selection** → Optimal payment token based on priority system
4. **EIP-681 Generation** → Payment request with chain ID
5. **Real-Time Monitoring** → WebSocket/polling for transaction confirmation
6. **History Logging** → Transaction stored with full metadata

## 🛡️ Transaction Monitoring

- **WebSocket monitoring** for Ethereum, Base, Arbitrum, Optimism, Polygon
- **Polling-based monitoring** fallback
- **Automatic timeout** after 5 minutes
- **Block explorer integration** for transaction verification
- **Status tracking**: detected → confirmed → failed

## 🍓 Raspberry Pi Deployment

This NFC payment terminal can be deployed as a **plug-and-play kiosk** on Raspberry Pi hardware for production use.

### **Hardware Requirements**
- Raspberry Pi 4B (4GB+ RAM recommended)
- 7" Official Raspberry Pi Touchscreen 
- **NFC Reader** (multiple options supported):
  - **ACR1252U-M1 NFC Reader** (original, plug-and-play)
  - **HiLetgo PN532 NFC Module** (cost-effective alternative)
- 32GB+ MicroSD card

### **Deployment Features**
- **One-command build** creates bootable SD card image
- **Pre-configured WiFi** and API credentials
- **Automatic startup** with fullscreen kiosk mode
- **Safety validation** prevents deployment with test addresses
- **macOS and Linux** build support

### **Quick Deploy**
```bash
# Navigate to deployment scripts
cd scripts/rpi-deploy

# Configure your deployment
cp build-config.env.template build-config.env
# Edit build-config.env with your WiFi, API key, and merchant address

# Build bootable image (macOS)
./build-pi-image-osx.sh

# Flash the generated nfc-terminal-<date>.img.gz file to SD card using Raspberry Pi Imager and boot!
```

## 🔧 NFC Reader Support

This terminal supports multiple NFC reader types:

### **ACR1252U-M1 (Original)**
- Plug-and-play USB connection
- No additional setup required
- Higher cost (~$50-80)

### **PN532 Module (Cost-Effective Alternative)**
- Significantly cheaper (~$10-15)
- Requires basic wiring setup
- Supports UART and I2C connections
- **📋 [PN532 Setup Guide](PN532-SETUP.md)**

### **Configuration**
Set your NFC reader type in `.env`:
```env
# For PN532 module
NFC_READER_TYPE=PN532
PN532_SERIAL_PORT=/dev/ttyUSB0

# For ACR1252U (default)
NFC_READER_TYPE=ACR1252U
```

📖 **[Complete Deployment Guide](README-DEPLOYMENT.md)**