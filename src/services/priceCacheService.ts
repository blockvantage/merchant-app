import { COINGECKO_ETH_PRICE_URL } from '../config/index.js';

/**
 * Service for caching ETH price and refreshing it periodically
 */
export class PriceCacheService {
  private static cachedEthPrice: number = 0;
  private static lastFetchTime: number = 0;
  private static refreshInterval: NodeJS.Timeout | null = null;
  private static readonly REFRESH_INTERVAL_MS = 60000; // 1 minute

  /**
   * Initialize the price cache service
   */
  static async initialize(): Promise<void> {
    console.log('💰 Initializing price cache service...');
    
    // Fetch initial ETH price
    await this.fetchAndCacheEthPrice();
    
    // Set up periodic refresh
    this.startPeriodicRefresh();
    
    console.log('✅ Price cache service initialized');
  }

  /**
   * Get cached ETH price
   */
  static getCachedEthPrice(): number {
    return this.cachedEthPrice;
  }

  /**
   * Get last fetch time
   */
  static getLastFetchTime(): number {
    return this.lastFetchTime;
  }

  /**
   * Fetch ETH price and update cache
   */
  private static async fetchAndCacheEthPrice(): Promise<void> {
    try {
      const response = await fetch(COINGECKO_ETH_PRICE_URL);
      if (!response.ok) {
        console.error(`Failed to fetch ETH price: HTTP ${response.status}`);
        return;
      }
      
      const data = await response.json() as any;
      const ethPrice = data.ethereum?.usd || 0;
      
      if (ethPrice > 0) {
        this.cachedEthPrice = ethPrice;
        this.lastFetchTime = Date.now();
        
        const timestamp = new Date().toLocaleTimeString();
        console.log(`📈 ETH Price Updated: $${ethPrice.toFixed(2)} (${timestamp})`);
      } else {
        console.error('Invalid ETH price received from API');
      }
    } catch (error) {
      console.error('Error fetching ETH price:', error);
    }
  }

  /**
   * Start periodic price refresh
   */
  private static startPeriodicRefresh(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    
    this.refreshInterval = setInterval(async () => {
      await this.fetchAndCacheEthPrice();
    }, this.REFRESH_INTERVAL_MS);
    
    console.log(`⏰ ETH price will refresh every ${this.REFRESH_INTERVAL_MS / 1000} seconds`);
  }

  /**
   * Stop periodic refresh (for cleanup)
   */
  static stop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
      this.refreshInterval = null;
      console.log('🛑 Price cache service stopped');
    }
  }

  /**
   * Force refresh ETH price
   */
  static async forceRefresh(): Promise<void> {
    console.log('🔄 Force refreshing ETH price...');
    await this.fetchAndCacheEthPrice();
  }

  /**
   * Get cache status
   */
  static getCacheStatus(): {price: number, lastFetch: Date, isStale: boolean} {
    const now = Date.now();
    const ageMs = now - this.lastFetchTime;
    const isStale = ageMs > (this.REFRESH_INTERVAL_MS * 2); // Consider stale if > 2 minutes old
    
    return {
      price: this.cachedEthPrice,
      lastFetch: new Date(this.lastFetchTime),
      isStale
    };
  }
} 