import dotenv from 'dotenv';
dotenv.config();

export const AID = 'F046524545504159'; // F0 + FREEPAY in HEX format

// NFC Reader Configuration
export type NFCReaderType = 'ACR1252U' | 'PN532';

export const NFC_READER_TYPE: NFCReaderType = (process.env.NFC_READER_TYPE as NFCReaderType) || 'ACR1252U';

// PN532 Configuration (only used if NFC_READER_TYPE is 'PN532')
export const PN532_SERIAL_PORT = process.env.PN532_SERIAL_PORT || '/dev/ttyUSB0';
export const PN532_BAUD_RATE = parseInt(process.env.PN532_BAUD_RATE || '115200');
export const PN532_CONNECTION_TYPE = process.env.PN532_CONNECTION_TYPE || 'UART'; // UART or I2C

// I2C Configuration (only used if PN532_CONNECTION_TYPE is 'I2C')
export const PN532_I2C_BUS = parseInt(process.env.PN532_I2C_BUS || '1'); // I2C bus number (usually 1 on Raspberry Pi)
export const PN532_I2C_ADDRESS = parseInt(process.env.PN532_I2C_ADDRESS || '0x24', 16); // PN532 I2C address (0x24 is default)

// Validate required environment variables
if (!process.env.MERCHANT_ADDRESS) {
  throw new Error('MERCHANT_ADDRESS environment variable is required. Please set it in your .env file.');
}

if (!process.env.ALCHEMY_API_KEY) {
  throw new Error('ALCHEMY_API_KEY environment variable is required. Please set it in your .env file.');
}

if (!process.env.LAYERSWAP_API_KEY) {
  throw new Error('LAYERSWAP_API_KEY environment variable is required. Please set it in your .env file.');
}

// Recipient address for payments - loaded from environment variable
export const MERCHANT_ADDRESS = process.env.MERCHANT_ADDRESS;

// Processing configuration
export const COOLDOWN_DURATION = 30000; // 30 seconds cooldown after processing
// export const TARGET_USD = 10; // $10 target payment - This will now be dynamic

// API configuration
export const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY;
export const LAYERSWAP_API_KEY = process.env.LAYERSWAP_API_KEY;

// Parse merchant chains from environment variable
// If not set, merchant accepts all chains
export const MERCHANT_CHAINS = process.env.MERCHANT_CHAINS
  ? process.env.MERCHANT_CHAINS
      .split(',')
      .map(chain => chain.trim().toLowerCase())
  : null; // null means accept all chains

// Multi-chain Alchemy configuration
export interface ChainConfig {
  id: number;
  name: string;
  displayName: string;
  alchemyNetwork: string;
  alchemyUrl: string;
  nativeToken: {
    symbol: string;
    name: string;
    decimals: number;
  };
  coingeckoId: string;
}

export const SUPPORTED_CHAINS: ChainConfig[] = [
  {
    id: 1,
    name: 'ethereum',
    displayName: 'Ethereum',
    alchemyNetwork: 'eth-mainnet',
    alchemyUrl: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    nativeToken: {
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18
    },
    coingeckoId: 'ethereum'
  },
  {
    id: 8453,
    name: 'base',
    displayName: 'Base',
    alchemyNetwork: 'base-mainnet',
    alchemyUrl: `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    nativeToken: {
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18
    },
    coingeckoId: 'ethereum'
  },
  {
    id: 42161,
    name: 'arbitrum',
    displayName: 'Arbitrum One',
    alchemyNetwork: 'arb-mainnet',
    alchemyUrl: `https://arb-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    nativeToken: {
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18
    },
    coingeckoId: 'ethereum'
  },
  {
    id: 10,
    name: 'optimism',
    displayName: 'Optimism',
    alchemyNetwork: 'opt-mainnet',
    alchemyUrl: `https://opt-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    nativeToken: {
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18
    },
    coingeckoId: 'ethereum'
  },
  {
    id: 137,
    name: 'polygon',
    displayName: 'Polygon',
    alchemyNetwork: 'polygon-mainnet',
    alchemyUrl: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`,
    nativeToken: {
      symbol: 'MATIC',
      name: 'Polygon',
      decimals: 18
    },
    coingeckoId: 'matic-network'
  },
  {
    id: 393402133025423,
    name: 'starknet',
    displayName: 'Starknet',
    alchemyNetwork: 'starknet-mainnet',
    alchemyUrl: `https://starknet-mainnet.g.alchemy.com/starknet/version/rpc/v0_6/${ALCHEMY_API_KEY}`,
    nativeToken: {
      symbol: 'ETH',
      name: 'Ethereum',
      decimals: 18
    },
    coingeckoId: 'ethereum'
  }
];

// Legacy single-chain config (deprecated - use SUPPORTED_CHAINS)
export const ALCHEMY_BASE_URL = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;

// Alchemy Prices API base URL
export const ALCHEMY_PRICES_API_BASE_URL = 'https://api.g.alchemy.com/prices/v1';

export const config = {
    ALCHEMY_API_KEY: process.env.ALCHEMY_API_KEY!,
    // ... other existing config values ...
}; 