import dotenv from 'dotenv';
dotenv.config();

export const AID = 'F2222222222222'; // must match the AID in your Android app
export const GET = Buffer.from('80CA000000', 'hex'); // "GET_STRING" APDU
export const PAYMENT = Buffer.from('80CF000000', 'hex'); // "PAYMENT" APDU

// Recipient address for payments (replace with your actual receiving address)
export const RECIPIENT_ADDRESS = '0x109F7f0bFE98E4d1352916056FDcd90b9547ba00';

// Processing configuration
export const COOLDOWN_DURATION = 30000; // 30 seconds cooldown after processing
// export const TARGET_USD = 10; // $10 target payment - This will now be dynamic

// API configuration
export const ALCHEMY_API_KEY = process.env.ALCHEMY_API_KEY || 'YOUR_API_KEY';

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
  }
];

// Legacy single-chain config (deprecated - use SUPPORTED_CHAINS)
export const ALCHEMY_BASE_URL = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_API_KEY}`;

// CoinGecko API URLs
export const COINGECKO_TOKEN_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/token_price';
export const COINGECKO_ETH_PRICE_URL = 'https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd';

// Multi-chain CoinGecko platform mappings
export const COINGECKO_PLATFORMS: {[chainName: string]: string} = {
  'ethereum': 'ethereum',
  'base': 'base',
  'arbitrum': 'arbitrum-one', 
  'optimism': 'optimistic-ethereum'
};

export const config = {
    ALCHEMY_API_KEY: process.env.ALCHEMY_API_KEY || '',
    // ... other existing config values ...
}; 