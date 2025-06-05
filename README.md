# NFC Wallet Reader

A modular NFC wallet reader that detects Ethereum addresses, fetches balances, and sends EIP-681 payment requests.

## 🏗️ Architecture

The application has been refactored into a clean modular architecture:

```
src/
├── app.ts                      # Main application entry point
├── types/
│   └── index.ts               # TypeScript interfaces and types
├── config/
│   └── index.ts               # Configuration constants and environment
└── services/
    ├── nfcService.ts          # NFC reader setup and card handling
    ├── ethereumService.ts     # Ethereum address validation and utilities
    ├── addressProcessor.ts    # Address processing state management
    ├── priceService.ts        # Token price fetching (CoinGecko API)
    ├── alchemyService.ts      # Wallet balance fetching (Alchemy API)
    └── paymentService.ts      # EIP-681 payment generation and transmission
```

## 📦 Services Overview

### 🔧 **NFCService**
- Main NFC reader management
- Card detection and event handling
- Orchestrates the entire flow

### 🏦 **EthereumService**
- Address validation and normalization
- Ethereum utility functions
- Address format checking

### ⏳ **AddressProcessor**
- Prevents duplicate processing
- Manages 30-second cooldowns
- Processing state tracking

### 💰 **PriceService**
- CoinGecko API integration
- ETH and token price fetching
- Real-time USD value calculation

### 🔗 **AlchemyService**
- Alchemy API integration
- ETH and ERC-20 balance fetching
- Token metadata retrieval

### 💳 **PaymentService**
- EIP-681 URI generation
- Payment request calculation
- NFC transmission handling

## 🚀 Getting Started

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Set up environment:**
   ```bash
   echo "ALCHEMY_API_KEY=your_alchemy_api_key_here" > .env
   ```

3. **Run the application:**
   ```bash
   node --loader ts-node/esm src/app.ts
   ```

## ⚙️ Configuration

Update `src/config/index.ts` to customize:
- **RECIPIENT_ADDRESS**: Your wallet address for receiving payments
- **TARGET_USD**: Payment amount (default: $10)
- **COOLDOWN_DURATION**: Time between processing same address (default: 30s)

## 🔄 Flow

1. **NFC Detection** → Card tapped on reader
2. **Address Validation** → Check if response is Ethereum address
3. **Cooldown Check** → Prevent duplicate processing
4. **Balance Fetching** → Get ETH + token balances via Alchemy
5. **Price Calculation** → Fetch USD prices via CoinGecko
6. **Payment Generation** → Create EIP-681 URI for $10 payment
7. **NFC Transmission** → Send payment request back to phone

## 🛡️ Features

- **Modular Architecture**: Clean separation of concerns
- **Address Validation**: Robust Ethereum address checking
- **Duplicate Prevention**: Smart cooldown system
- **Real-time Pricing**: Live USD values for all assets
- **EIP-681 Standard**: Industry-standard payment URIs
- **Error Handling**: Graceful failure recovery
- **TypeScript**: Full type safety

## 📝 API Keys Required

- **Alchemy**: Free at [dashboard.alchemy.com](https://dashboard.alchemy.com)
- **CoinGecko**: Free, no API key required 