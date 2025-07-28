/**
 * Generic interface for cross-chain bridge providers
 */
export interface BridgeProvider {
  /**
   * Name of the bridge provider (e.g., "Layerswap", "Across", etc.)
   */
  name: string;

  /**
   * Initialize the bridge provider
   */
  initialize(): Promise<void>;

  /**
   * Check if a chain is supported by the merchant
   */
  isMerchantSupportedChain(chainId: number): boolean;

  /**
   * Check if there's a route from source chain to any merchant chain for a token
   */
  checkRoute(sourceChainId: number, tokenSymbol: string): Promise<BridgeRoute | null>;

  /**
   * Create a cross-chain swap
   */
  createSwap(route: BridgeRoute, amount: number): Promise<BridgeSwapResult | null>;
}

/**
 * Result of checking for a bridge route
 */
export interface BridgeRoute {
  hasRoute: boolean;
  bridgeName: string;
  sourceChainId: number;
  destinationChainId: number;
  destinationNetwork: string;
  tokenSymbol: string;
}

/**
 * Result of creating a bridge swap
 */
export interface BridgeSwapResult {
  swapId: string;
  depositAddress: string;
  depositAmount: number;
  callData?: string;
  tokenContract?: string;
  bridgeName: string;
}

/**
 * Payment routing result
 */
export interface PaymentRoute {
  type: 'direct' | 'bridge';
  bridge?: {
    name: string;
    route: BridgeRoute;
    swapResult: BridgeSwapResult;
  };
}