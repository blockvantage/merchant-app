import { BridgeProvider, BridgeRoute, BridgeSwapResult } from '../../types/bridge.js';
import { LayerswapService } from '../layerswapService.js';

/**
 * Layerswap implementation of the BridgeProvider interface
 */
export class LayerswapBridgeProvider implements BridgeProvider {
  name = 'Layerswap';

  async initialize(): Promise<void> {
    await LayerswapService.initialize();
  }

  isMerchantSupportedChain(chainId: number): boolean {
    return LayerswapService.isMerchantSupportedChain(chainId);
  }

  async checkRoute(sourceChainId: number, tokenSymbol: string): Promise<BridgeRoute | null> {
    const result = await LayerswapService.checkRoute(sourceChainId, tokenSymbol);
    
    if (!result.hasRoute || !result.destinationChainId || !result.destinationNetwork) {
      return null;
    }

    return {
      hasRoute: true,
      bridgeName: this.name,
      sourceChainId,
      destinationChainId: result.destinationChainId,
      destinationNetwork: result.destinationNetwork,
      tokenSymbol
    };
  }

  async createSwap(route: BridgeRoute, amount: number): Promise<BridgeSwapResult | null> {
    const result = await LayerswapService.createSwap(
      route.sourceChainId,
      route.destinationChainId,
      route.tokenSymbol,
      amount
    );

    if (!result) {
      return null;
    }

    return {
      ...result,
      bridgeName: this.name
    };
  }
}