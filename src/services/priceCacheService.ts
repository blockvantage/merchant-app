import { Alchemy } from 'alchemy-sdk';
import { ALCHEMY_API_KEY } from '../config/index.js';

/**
 * Service for caching ETH price and refreshing it periodically using Alchemy SDK
 */
export class PriceCacheService {
  private static cachedEthPrice: number = 0;
  private static lastFetchTime: number = 0;
  private static refreshInterval: NodeJS.Timeout | null = null;
  private static readonly REFRESH_INTERVAL_MS = 60000; // 1 minute
  private static alchemy = new Alchemy({ apiKey: ALCHEMY_API_KEY });

  /**
   * Initialize the price cache service
   */
  static async initialize(): Promise<void> {
    console.log('💰 DEBUG: Initializing price cache service...');
    console.log(`🔍 DEBUG: API Key configured:`, ALCHEMY_API_KEY ? `Yes (${ALCHEMY_API_KEY.substring(0, 8)}...)` : 'No');
    console.log(`🔍 DEBUG: Refresh interval: ${this.REFRESH_INTERVAL_MS}ms`);
    
    // Fetch initial ETH price
    await this.fetchAndCacheEthPrice();
    
    // Set up periodic refresh
    this.startPeriodicRefresh();
    
    console.log('✅ DEBUG: Price cache service initialized');
  }

  /**
   * Start periodic price refresh
   */
  private static startPeriodicRefresh(): void {
    console.log(`🔍 DEBUG: Setting up periodic price refresh...`);
    
    if (this.refreshInterval) {
      console.log(`🔍 DEBUG: Clearing existing refresh interval`);
      clearInterval(this.refreshInterval);
    }
    
    this.refreshInterval = setInterval(async () => {
      console.log(`⏰ DEBUG: Periodic ETH price refresh triggered`);
      await this.fetchAndCacheEthPrice();
    }, this.REFRESH_INTERVAL_MS);
    
    console.log(`✅ DEBUG: Periodic refresh scheduled every ${this.REFRESH_INTERVAL_MS / 1000} seconds`);
  }

  /**
   * Get cached ETH price
   */
  static getCachedEthPrice(): number {
    console.log(`🔍 DEBUG: getCachedEthPrice called - returning: $${this.cachedEthPrice}`);
    console.log(`🔍 DEBUG: Last fetch time: ${new Date(this.lastFetchTime).toISOString()}`);
    const ageMs = Date.now() - this.lastFetchTime;
    console.log(`🔍 DEBUG: Cache age: ${ageMs}ms (${(ageMs / 1000).toFixed(1)}s)`);
    return this.cachedEthPrice;
  }

  /**
   * Fetch ETH price and update cache
   */
  private static async fetchAndCacheEthPrice(): Promise<void> {
    try {
      console.log(`📡 DEBUG: Starting ETH price fetch for cache...`);
      console.log(`🔍 DEBUG: API Key configured:`, ALCHEMY_API_KEY ? `Yes (${ALCHEMY_API_KEY.substring(0, 8)}...)` : 'No');
      
      const priceData = await this.alchemy.prices.getTokenPriceBySymbol(['ETH']);
      
      console.log(`📦 DEBUG: Raw ETH price cache response:`, JSON.stringify(priceData, null, 2));
      
      if (!priceData) {
        console.error('❌ DEBUG: No priceData received from Alchemy SDK for cache');
        return;
      }
      
      if (!priceData.data) {
        console.error('❌ DEBUG: No data field in ETH cache priceData:', priceData);
        return;
      }
      
      if (priceData.data.length === 0) {
        console.error('❌ DEBUG: Empty data array in ETH cache priceData');
        return;
      }
      
      console.log(`🔍 DEBUG: Processing ${priceData.data.length} ETH cache responses...`);
      
      const ethData = priceData.data.find((d: any) => d.symbol === 'ETH');
      if (!ethData) {
        console.error('❌ DEBUG: No ETH symbol found in cache response. Available symbols:', priceData.data.map((d: any) => d.symbol));
        return;
      }
      
      console.log(`🔍 DEBUG: ETH cache data:`, JSON.stringify(ethData, null, 2));
      
      if (ethData.error) {
        console.error('❌ DEBUG: ETH cache data has error:', ethData.error);
        return;
      }
      
      if (!ethData.prices) {
        console.error('❌ DEBUG: ETH cache data has no prices field:', ethData);
        return;
      }
      
      if (ethData.prices.length === 0) {
        console.error('❌ DEBUG: ETH cache data has empty prices array');
        return;
      }
      
      console.log(`🔍 DEBUG: ETH cache prices available (${ethData.prices.length}):`, ethData.prices);
      
             const usdPrice = ethData.prices.find((p: any) => p.currency === 'usd');
       if (!usdPrice) {
         console.error('❌ DEBUG: No USD price found in ETH cache data. Available currencies:', ethData.prices.map((p: any) => p.currency));
         return;
       }
      
      console.log(`🔍 DEBUG: USD price object:`, usdPrice);
      
      if (!usdPrice.value) {
        console.error('❌ DEBUG: USD price has no value in cache data:', usdPrice);
        return;
      }
      
      const ethPrice = parseFloat(usdPrice.value);
      if (isNaN(ethPrice)) {
        console.error(`❌ DEBUG: Cannot parse ETH cache price value '${usdPrice.value}'`);
        return;
      }
      
      console.log(`🔍 DEBUG: Parsed ETH price: $${ethPrice}`);
      
      if (ethPrice > 0) {
        const oldPrice = this.cachedEthPrice;
        const oldTime = this.lastFetchTime;
        
        this.cachedEthPrice = ethPrice;
        this.lastFetchTime = Date.now();
        
        const timestamp = new Date().toLocaleTimeString();
        console.log(`📈 ETH Price Updated: $${ethPrice.toFixed(2)} (${timestamp})`);
        console.log(`🔍 DEBUG: Price change: $${oldPrice.toFixed(2)} -> $${ethPrice.toFixed(2)} (${ethPrice > oldPrice ? '+' : ''}${(ethPrice - oldPrice).toFixed(2)})`);
        console.log(`🔍 DEBUG: Time since last update: ${oldTime ? ((Date.now() - oldTime) / 1000).toFixed(1) : 'N/A'}s`);
      } else {
        console.error('❌ DEBUG: Invalid ETH price received from Alchemy SDK (price <= 0):', ethPrice);
      }
    } catch (error) {
      console.error('❌ DEBUG: Exception in fetchAndCacheEthPrice:', error);
      if (error instanceof Error) {
        console.error(`❌ DEBUG: Error message:`, error.message);
        console.error(`❌ DEBUG: Error stack:`, error.stack);
      }
    }
  }

  /**
   * Get last fetch time
   */
  static getLastFetchTime(): number {
    console.log(`🔍 DEBUG: getLastFetchTime called - returning: ${this.lastFetchTime} (${new Date(this.lastFetchTime).toISOString()})`);
    return this.lastFetchTime;
  }

  /**
   * Clean up resources
   */
  static cleanup(): void {
    console.log(`🔍 DEBUG: Cleaning up price cache service...`);
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
      console.log(`✅ DEBUG: Refresh interval cleared`);
    } else {
      console.log(`🔍 DEBUG: No refresh interval to clear`);
    }
  }

  /**
   * Stop periodic refresh (for cleanup)
   */
  static stop(): void {
    console.log(`🛑 DEBUG: Stopping price cache service...`);
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
      console.log('🛑 Price cache service stopped');
    } else {
      console.log('🔍 DEBUG: Price cache service was not running');
    }
  }

  /**
   * Force refresh ETH price
   */
  static async forceRefresh(): Promise<void> {
    console.log('🔄 DEBUG: Force refreshing ETH price...');
    await this.fetchAndCacheEthPrice();
    console.log('✅ DEBUG: Force refresh completed');
  }

  /**
   * Get cache status
   */
  static getCacheStatus(): {price: number, lastFetch: Date, isStale: boolean} {
    const now = Date.now();
    const ageMs = now - this.lastFetchTime;
    const isStale = ageMs > (this.REFRESH_INTERVAL_MS * 2); // Consider stale if > 2 minutes old
    
    const status = {
      price: this.cachedEthPrice,
      lastFetch: new Date(this.lastFetchTime),
      isStale
    };
    
    console.log(`🔍 DEBUG: Cache status:`, {
      price: `$${status.price.toFixed(2)}`,
      lastFetch: status.lastFetch.toISOString(),
      ageMs: ageMs,
      ageSec: (ageMs / 1000).toFixed(1),
      isStale: status.isStale,
      staleThreshold: `${(this.REFRESH_INTERVAL_MS * 2) / 1000}s`
    });
    
    return status;
  }
}