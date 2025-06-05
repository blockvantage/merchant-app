# NFC Wallet Reader

A modular NFC wallet reader that detects Ethereum addresses, fetches balances across multiple chains, and sends EIP-681 payment requests.

## 🌐 Multi-Chain Support

**Supported Networks:**
- 🔵 **Ethereum Mainnet**
- 🔵 **Base** 
- 🔴 **Arbitrum One**
- 🔴 **Optimism**

All networks are fetched **in parallel** for maximum speed!

## 🏗️ Architecture

The application has been refactored into a clean modular architecture:

```
src/
├── app.ts                      # Main application entry point
├── types/
│   └── index.ts               # TypeScript interfaces and types
├── config/
│   └── index.ts               # Multi-chain configuration and endpoints
└── services/
    ├── nfcService.ts          # NFC reader setup and card handling
    ├── ethereumService.ts     # Ethereum address validation and utilities
    ├── addressProcessor.ts    # Address processing state management
    ├── priceService.ts        # Multi-chain token price fetching (CoinGecko API)
    ├── alchemyService.ts      # Multi-chain wallet balance fetching (Alchemy API)
    └── paymentService.ts      # EIP-681 payment generation and transmission
```

## 📦 Services Overview

### 🔧 **NFCService**
- Main NFC reader management
- Card detection and event handling
- Orchestrates the entire multi-chain flow

### 🏦 **EthereumService**
- Address validation and normalization
- Ethereum utility functions
- Address format checking

### ⏳ **AddressProcessor**
- Prevents duplicate processing
- Manages 30-second cooldowns
- Processing state tracking

### 💰 **PriceService**
- **Multi-chain** CoinGecko API integration
- ETH and token price fetching across all networks
- Real-time USD value calculation
- **Parallel price fetching** for performance

### 🔗 **AlchemyService**
- **Multi-chain** Alchemy API integration
- ETH and ERC-20 balance fetching across 4 networks
- Token metadata retrieval
- **Parallel chain fetching** for maximum speed
- Portfolio aggregation and display

### 💳 **PaymentService**
- EIP-681 URI generation with **NDEF formatting** and **chain ID support**
- Smart payment token selection (prefers stablecoins)
- Multi-chain payment request calculation
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
- **SUPPORTED_CHAINS**: Add/remove blockchain networks

## 🔄 Multi-Chain Flow

1. **NFC Detection** → Card tapped on reader
2. **Address Validation** → Check if response is Ethereum address
3. **Cooldown Check** → Prevent duplicate processing
4. **🌐 Multi-Chain Balance Fetching** → Get ETH + token balances via Alchemy **in parallel** across:
   - Ethereum Mainnet
   - Base 
   - Arbitrum One
   - Optimism
5. **Price Calculation** → Fetch USD prices via CoinGecko for all chains
6. **Smart Payment Selection** → Choose best token (stablecoins preferred)
7. **NDEF Payment Generation** → Create EIP-681 URI with proper NDEF formatting
8. **NFC Transmission** → Send payment request back to phone

## 🛡️ Features

### **Multi-Chain**
- **4 Networks**: Ethereum, Base, Arbitrum, Optimism
- **Parallel Fetching**: All chains fetched simultaneously
- **Aggregated Portfolio**: Combined view across all networks
- **Smart Token Selection**: Intelligent payment preference system

### **Performance**
- **Parallel API Calls**: Maximum speed with concurrent requests
- **Efficient Caching**: Cooldown system prevents duplicate work
- **Optimized Display**: Clean chain-grouped portfolio view

### **User Experience** 
- **NDEF Formatting**: Payment requests open wallet apps automatically
- **Smart Selection**: Prefers stablecoins → native tokens → major tokens
- **Rich Display**: Portfolio breakdown by chain with USD values
- **Top Holdings**: Shows most valuable assets across all chains

### **Architecture**
- **Modular Design**: Clean separation of concerns
- **Type Safety**: Full TypeScript implementation
- **Error Handling**: Graceful failure recovery
- **Extensible**: Easy to add new chains

## 📱 Example Output

```
🔄 Fetching balances for 0x123... across 4 chains...
⛓️  Fetching Ethereum balances...
⛓️  Fetching Base balances...
⛓️  Fetching Arbitrum One balances...
⛓️  Fetching Optimism balances...
✅ Ethereum: 5 tokens, $1,250.32
✅ Base: 2 tokens, $450.67
✅ Arbitrum One: 3 tokens, $780.45
✅ Optimism: 1 tokens, $120.00

=== 🌐 MULTI-CHAIN PORTFOLIO ===
💼 Total Value: $2,601.44

⛓️  Ethereum ($1,250.32):
  ETH: 0.5234 ($1,200.45)
  USDC: 49.8700 ($49.87)

⛓️  Base ($450.67):
  ETH: 0.1967 ($450.67)

🏆 Top Holdings:
  1. ETH (Ethereum): $1,200.45
  2. ETH (Base): $450.67
  3. USDC (Ethereum): $49.87

💰 PAYMENT OPTIONS ($10):

⛓️  Ethereum:
  1. 10.000000 USDC

💡 Preferred stablecoin payment: USDC
🎯 Selected: 10.000000 USDC (Ethereum)

💳 Sending EIP-681 payment request for Ethereum (Chain ID: 1):
📄 URI: ethereum:0xA0b86a33E6441c6e6e1B8e6e5c1b6e@1/transfer?address=0x109F7f0bFE98E4d1352916056FDcd90b9547ba00&uint256=10000000
📡 NDEF Message (87 bytes): d1015755...
✅ NDEF payment request sent successfully for Ethereum!
📱 Wallet app should now open with transaction details...
```

## 🔗 **EIP-681 Chain ID Format**

The payment URIs now include chain IDs according to the EIP-681 standard:

**Native Token (ETH) Payments:**
```
ethereum:<recipient>@<chainId>?value=<amount>
```

**ERC-20 Token Payments:**
```
ethereum:<tokenAddress>@<chainId>/transfer?address=<recipient>&uint256=<amount>
```

**Supported Chain IDs:**
- **Ethereum**: `@1`
- **Base**: `@8453` 
- **Arbitrum One**: `@42161`
- **Optimism**: `@10`

This ensures wallet apps know exactly which network to use for the transaction.

## 📝 API Keys Required

- **Alchemy**: Free at [dashboard.alchemy.com](https://dashboard.alchemy.com) 
  - ✨ **Single API key works for all 4 chains**
- **CoinGecko**: Free, no API key required