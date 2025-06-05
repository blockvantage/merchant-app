import { COINGECKO_TOKEN_PRICE_URL, COINGECKO_ETH_PRICE_URL } from '../config/index.js';

/**
 * Service for fetching token prices from CoinGecko
 */
export class PriceService {
  /**
   * Get token prices from CoinGecko
   */
  static async getTokenPrices(tokenAddresses: string[]): Promise<{[address: string]: number}> {
    try {
      if (tokenAddresses.length === 0) return {};
      
      // CoinGecko API for token prices
      const addressList = tokenAddresses.join(',');
      const url = `${COINGECKO_TOKEN_PRICE_URL}?contract_addresses=${addressList}&vs_currencies=usd`;
      
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
      console.log('Could not fetch token prices from CoinGecko');
      return {};
    }
  }

  /**
   * Get ETH price from CoinGecko
   */
  static async getEthPrice(): Promise<number> {
    try {
      const response = await fetch(COINGECKO_ETH_PRICE_URL);
      if (!response.ok) return 0;
      
      const data = await response.json() as any;
      return data.ethereum?.usd || 0;
    } catch (error) {
      console.log('Could not fetch ETH price');
      return 0;
    }
  }
} 