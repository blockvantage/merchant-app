# NFC Payment Terminal

A multi-chain NFC payment terminal that processes cryptocurrency payments across 6 blockchain networks with real-time transaction monitoring and comprehensive history tracking.

## 🌐 Supported Networks

- **Ethereum** (ETH)
- **Base** (ETH) 
- **Arbitrum** (ETH)
- **Optimism** (ETH)
- **Polygon** (MATIC)
- **Starknet** (ETH)

## ✨ Key Features

### 💳 **Multi-Chain Payments**
- Smart payment selection with L2 stablecoin priority
- EIP-681 payment URIs with chain ID support
- Real-time transaction monitoring via Alchemy WebSockets
- Automatic payment confirmation with block explorer links

### 📊 **Transaction History**
- Comprehensive transaction logging with status tracking
- NFC wallet scanning for personalized transaction history
- Filter transactions by wallet address or view all transactions
- Clickable block explorer links for transaction verification

### 🎯 **Smart Payment Priority**
```
L2 Stablecoin > L2 Other > L2 ETH > L1 Stablecoin > L1 Other > L1 ETH
```

### 🖥️ **Web Interface**
- Touch-friendly payment input (cents-based for precision)
- Real-time payment status updates via WebSocket
- Transaction history browser with wallet filtering
- Clean, mobile-optimized UI

## 🚀 Quick Start

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Environment setup:**
   ```bash
   echo "ALCHEMY_API_KEY=your_alchemy_api_key_here" > .env
   ```

3. **Run the terminal:**
   ```bash
   npm run dev
   ```

4. **Open the interface:**
   Navigate to `http://localhost:3000`

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

### **Staff Support Features**
- Transaction history helps resolve customer payment issues
- Block explorer links provide transaction proof
- Wallet-specific filtering shows customer's payment history
- Real-time status updates for payment troubleshooting

## ⚙️ Configuration

Update `src/config/index.ts` to customize:
- **SUPPORTED_CHAINS**: Blockchain networks
- **TARGET_USD**: Default payment amounts
- **Chain configurations**: RPC URLs, block explorers, token mappings

## 🔄 Payment Flow

1. **NFC Detection** → Customer taps device
2. **Multi-Chain Fetching** → Portfolio analysis across all 6 chains
3. **Smart Selection** → Optimal payment token based on priority system
4. **EIP-681 Generation** → Payment request with chain ID
5. **Real-Time Monitoring** → WebSocket/polling for transaction confirmation
6. **History Logging** → Transaction stored with full metadata

## 🛡️ Transaction Monitoring

- **WebSocket monitoring** for Ethereum, Base, Arbitrum, Optimism, Polygon
- **Polling-based monitoring** for Starknet (5-second intervals)
- **Automatic timeout** after 5 minutes
- **Block explorer integration** for transaction verification
- **Status tracking**: detected → confirmed → failed

## 📱 Example Terminal Output

```
💸 Payment initiated for $15.50 from Web UI
✅ Payment request sent successfully on Base (Chain ID: 8453)
🔍 Monitoring started for Base payment of $15.50
📝 Transaction detected: 0xabc123... (0.0045 ETH ≥ $15.50 required)
✅ Payment confirmed! View: https://basescan.org/tx/0xabc123...
```

## 🔍 Debug Endpoints

- **GET** `/debug/chains` - View supported chains and active subscriptions
- **GET** `/transaction-history` - Retrieve all transaction history
- **POST** `/scan-wallet` - Initiate wallet scanning for history filtering

## 🍓 Raspberry Pi Deployment

This NFC payment terminal can be deployed as a **plug-and-play kiosk** on Raspberry Pi hardware for production use.

### **Hardware Requirements**
- Raspberry Pi 4B (4GB+ RAM recommended)
- 7" Official Raspberry Pi Touchscreen 
- **ACR1252U-M1 NFC Reader** (specifically supported)
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
./build-pi-image-docker.sh

# Flash the generated .img.gz file to SD card and boot!
```

📖 **[Complete Deployment Guide](README-DEPLOYMENT.md)**

## 🎯 Business Benefits

- **Reduced Support Calls**: Staff can instantly view customer transaction history
- **Payment Verification**: Block explorer links provide transaction proof  
- **Customer Experience**: Fast L2 payments with immediate confirmation
- **Multi-Chain Flexibility**: Accepts payments on 6 different blockchain networks
- **Audit Trail**: Comprehensive transaction logging for accounting
- **Production Ready**: Deploy as dedicated payment kiosk with Raspberry Pi