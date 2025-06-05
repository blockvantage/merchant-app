import { COINGECKO_TOKEN_PRICE_URL, COINGECKO_ETH_PRICE_URL, COINGECKO_PLATFORMS } from '../config/index.js';
import { PriceCacheService } from './priceCacheService.js';

/**
 * Service for fetching token prices from CoinGecko across multiple chains
 */
export class PriceService {
  /**
   * Get token prices from CoinGecko for a specific chain
   */
  static async getTokenPricesForChain(tokenAddresses: string[], chainName: string): Promise<{[address: string]: number}> {
    try {
      if (tokenAddresses.length === 0) return {};
      
      const platform = COINGECKO_PLATFORMS[chainName];
      if (!platform) {
        console.log(`No CoinGecko platform mapping for chain: ${chainName}`);
        return {};
      }
      
      // CoinGecko API for token prices on specific platform
      const addressList = tokenAddresses.join(',');
      const url = `${COINGECKO_TOKEN_PRICE_URL}/${platform}?contract_addresses=${addressList}&vs_currencies=usd`;
      
      const response = await fetch(url);
      if (!response.ok) return {};
      
      const priceData = await response.json() as any;
      
      const prices: {[address: string]: number} = {};
      for (const [address, data] of Object.entries(priceData)) {
        if (data && typeof data === 'object' && 'usd' in data) {
          prices[address.toLowerCase()] = (data as any).usd;
        }
      }
      
      return prices;
    } catch (error) {
      console.log(`Could not fetch token prices for ${chainName} from CoinGecko:`, error);
      return {};
    }
  }

  /**
   * Get token prices for multiple chains in parallel
   */
  static async getMultiChainTokenPrices(chainTokens: {[chainName: string]: string[]}): Promise<{[chainName: string]: {[address: string]: number}}> {
    const pricePromises = Object.entries(chainTokens).map(async ([chainName, addresses]) => {
      const prices = await this.getTokenPricesForChain(addresses, chainName);
      return [chainName, prices] as [string, {[address: string]: number}];
    });

    const results = await Promise.all(pricePromises);
    
    const chainPrices: {[chainName: string]: {[address: string]: number}} = {};
    for (const [chainName, prices] of results) {
      chainPrices[chainName] = prices;
    }
    
    return chainPrices;
  }

  /**
   * Get token prices from CoinGecko (legacy single-chain method)
   */
  static async getTokenPrices(tokenAddresses: string[]): Promise<{[address: string]: number}> {
    return this.getTokenPricesForChain(tokenAddresses, 'ethereum');
  }

  /**
   * Get cached ETH price (no longer fetches in real time)
   */
  static async getEthPrice(): Promise<number> {
    const cachedPrice = PriceCacheService.getCachedEthPrice();
    
    if (cachedPrice > 0) {
      return cachedPrice;
    }
    
    // If cache is empty, log warning and return 0
    console.log('⚠️  ETH price cache is empty or not yet initialized');
    return 0;
  }

  /**
   * Get native token prices for multiple chains in parallel
   */
  static async getNativeTokenPrices(chainIds: string[]): Promise<{[chainId: string]: number}> {
    try {
      // All supported chains use ETH as native token, so we use cached ETH price
      const ethPrice = await this.getEthPrice();
      
      const prices: {[chainId: string]: number} = {};
      for (const chainId of chainIds) {
        prices[chainId] = ethPrice;
      }
      
      return prices;
    } catch (error) {
      console.log('Could not get native token prices');
      return {};
    }
  }
} 