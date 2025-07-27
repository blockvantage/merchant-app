import { BridgeProvider, BridgeRoute, BridgeSwapResult } from '../types/bridge.js';
import { LayerswapBridgeProvider } from './bridges/layerswapBridgeProvider.js';

/**
 * Manages multiple bridge providers for cross-chain payments
 */
export class BridgeManager {
  private static providers: BridgeProvider[] = [];
  private static initialized = false;

  /**
   * Initialize all bridge providers
   */
  static async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    console.log('🌉 Initializing bridge providers...');

    // Add Layerswap as the first provider
    const layerswap = new LayerswapBridgeProvider();
    
    try {
      await layerswap.initialize();
      this.providers.push(layerswap);
      console.log(`✅ Initialized ${layerswap.name} bridge provider`);
    } catch (error) {
      console.error(`⚠️ Failed to initialize ${layerswap.name}:`, error);
    }

    // Future bridge providers can be added here
    // Example:
    // const acrossBridge = new AcrossBridgeProvider();
    // try {
    //   await acrossBridge.initialize();
    //   this.providers.push(acrossBridge);
    // } catch (error) {
    //   console.error(`Failed to initialize ${acrossBridge.name}:`, error);
    // }

    this.initialized = true;
    console.log(`🌉 Bridge manager initialized with ${this.providers.length} provider(s)`);
  }

  /**
   * Check if a chain is supported by the merchant (across all providers)
   */
  static isMerchantSupportedChain(chainId: number): boolean {
    // If any provider says the chain is supported, it's supported
    return this.providers.some(provider => provider.isMerchantSupportedChain(chainId));
  }

  /**
   * Find the best route across all bridge providers
   */
  static async findBestRoute(sourceChainId: number, tokenSymbol: string): Promise<{
    provider: BridgeProvider;
    route: BridgeRoute;
  } | null> {
    console.log(`🔍 Searching for bridge routes from chain ${sourceChainId} for ${tokenSymbol}...`);

    // Check all providers in parallel
    const routePromises = this.providers.map(async (provider) => {
      try {
        const route = await provider.checkRoute(sourceChainId, tokenSymbol);
        return { provider, route };
      } catch (error) {
        console.error(`Error checking route with ${provider.name}:`, error);
        return { provider, route: null };
      }
    });

    const results = await Promise.all(routePromises);

    // Filter out null routes and find the best one
    const validRoutes = results.filter(result => result.route && result.route.hasRoute);

    if (validRoutes.length === 0) {
      console.log('❌ No bridge routes found');
      return null;
    }

    // For now, just return the first valid route
    // In the future, we could compare fees, speed, etc.
    const bestRoute = validRoutes[0];
    console.log(`✅ Found route via ${bestRoute.provider.name} to ${bestRoute.route!.destinationNetwork}`);
    
    return {
      provider: bestRoute.provider,
      route: bestRoute.route!
    };
  }

  /**
   * Create a swap using the specified provider
   */
  static async createSwap(
    provider: BridgeProvider,
    route: BridgeRoute,
    amount: number
  ): Promise<BridgeSwapResult | null> {
    try {
      console.log(`💱 Creating swap via ${provider.name}...`);
      const result = await provider.createSwap(route, amount);
      
      if (result) {
        console.log(`✅ Swap created successfully via ${provider.name}`);
        console.log(`🔄 Swap ID: ${result.swapId}`);
      }
      
      return result;
    } catch (error) {
      console.error(`❌ Failed to create swap with ${provider.name}:`, error);
      return null;
    }
  }

  /**
   * Get all available providers
   */
  static getProviders(): BridgeProvider[] {
    return [...this.providers];
  }

  /**
   * Check if any providers are available
   */
  static hasProviders(): boolean {
    return this.providers.length > 0;
  }
}