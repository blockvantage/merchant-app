import https from 'https';
import { LAYERSWAP_API_KEY, MERCHANT_ADDRESS, MERCHANT_CHAINS, SUPPORTED_CHAINS } from '../config/index.js';

interface LayerswapNetwork {
  name: string;
  display_name: string;
  chain_id: string;
  tokens: LayerswapToken[];
}

interface LayerswapToken {
  symbol: string;
  contract: string | null;
  decimals: number;
}

interface LayerswapQuote {
  source_network: string;
  destination_network: string;
  source_token: string;
  destination_token: string;
  receive_amount: number;
  total_fee_in_usd: number;
}

interface LayerswapSwap {
  id: string;
  destination_address: string;
  status: string;
  requested_amount: number;
}

interface LayerswapDepositAction {
  to_address: string;
  amount: number;
  call_data: string;
  token: LayerswapToken;
  network: LayerswapNetwork;
}

export class LayerswapService {
  private static supportedNetworks: LayerswapNetwork[] | null = null;
  private static merchantNetworkNames: string[] = [];
  
  /**
   * Initialize the service by fetching supported networks and validating merchant chains
   */
  static async initialize(): Promise<void> {
    console.log('🔄 Initializing Layerswap service...');
    
    try {
      // Fetch supported networks from Layerswap
      await this.fetchSupportedNetworks();
      
      // Map merchant chain names to Layerswap network names
      this.merchantNetworkNames = await this.mapMerchantChainsToLayerswap();
      
      console.log('✅ Layerswap service initialized');
      console.log(`📍 Merchant accepts payments on: ${this.merchantNetworkNames.join(', ')}`);
    } catch (error) {
      console.error('❌ Failed to initialize Layerswap service:', error);
      throw error;
    }
  }
  
  /**
   * Fetch supported networks from Layerswap V2 API
   */
  private static async fetchSupportedNetworks(): Promise<void> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.layerswap.io',
        port: 443,
        path: '/api/v2/networks',
        method: 'GET',
        headers: {
          'X-LS-APIKEY': LAYERSWAP_API_KEY,
          'Content-Type': 'application/json'
        }
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200) {
            try {
              const response = JSON.parse(data);
              this.supportedNetworks = response.data || response;
              console.log(`✅ Fetched ${this.supportedNetworks!.length} networks from Layerswap`);
              resolve();
            } catch (e) {
              reject(new Error('Failed to parse Layerswap networks response'));
            }
          } else {
            reject(new Error(`Failed to fetch networks: ${res.statusCode}`));
          }
        });
      });
      
      req.on('error', reject);
      req.end();
    });
  }
  
  /**
   * Map merchant chain names to Layerswap network names
   */
  private static async mapMerchantChainsToLayerswap(): Promise<string[]> {
    if (!this.supportedNetworks) {
      throw new Error('Networks not loaded');
    }
    
    // If MERCHANT_CHAINS is null, merchant accepts all chains
    if (!MERCHANT_CHAINS) {
      // Return all networks that we support in our app
      const allNetworks = this.supportedNetworks
        .filter(network => {
          // Only include networks that are in our SUPPORTED_CHAINS
          const chainId = parseInt(network.chain_id);
          return SUPPORTED_CHAINS.some(chain => chain.id === chainId);
        })
        .map(network => network.name);
      
      console.log(`✅ Merchant accepts all chains. Available networks: ${allNetworks.join(', ')}`);
      return allNetworks;
    }
    
    const mappedNetworks: string[] = [];
    const unmappedChains: string[] = [];
    
    for (const merchantChain of MERCHANT_CHAINS) {
      // Find matching network in Layerswap
      const layerswapNetwork = this.supportedNetworks.find(network => {
        const networkNameLower = network.name.toLowerCase();
        const displayNameLower = network.display_name.toLowerCase();
        
        // Check if merchant chain matches network name or display name
        return networkNameLower.includes(merchantChain) || 
               displayNameLower === merchantChain ||
               (merchantChain === 'arbitrum' && networkNameLower === 'arbitrum_mainnet') ||
               (merchantChain === 'optimism' && networkNameLower === 'optimism_mainnet') ||
               (merchantChain === 'base' && networkNameLower === 'base_mainnet') ||
               (merchantChain === 'polygon' && networkNameLower === 'polygon_mainnet');
      });
      
      if (layerswapNetwork) {
        mappedNetworks.push(layerswapNetwork.name);
        console.log(`✅ Mapped merchant chain '${merchantChain}' to Layerswap network '${layerswapNetwork.name}'`);
      } else {
        unmappedChains.push(merchantChain);
      }
    }
    
    if (unmappedChains.length > 0) {
      throw new Error(`The following merchant chains are not supported by Layerswap: ${unmappedChains.join(', ')}`);
    }
    
    return mappedNetworks;
  }
  
  /**
   * Check if a chain is supported by the merchant
   */
  static isMerchantSupportedChain(chainId: number): boolean {
    // If MERCHANT_CHAINS is null, merchant accepts all chains
    if (!MERCHANT_CHAINS) return true;
    
    const chain = SUPPORTED_CHAINS.find(c => c.id === chainId);
    if (!chain) return false;
    
    // Check if this chain name is in merchant chains
    return MERCHANT_CHAINS.includes(chain.name.toLowerCase());
  }
  
  /**
   * Get Layerswap network name for a chain ID
   */
  static getLayerswapNetworkName(chainId: number): string | null {
    if (!this.supportedNetworks) return null;
    
    const chain = SUPPORTED_CHAINS.find(c => c.id === chainId);
    if (!chain) return null;
    
    const network = this.supportedNetworks.find(n => 
      n.chain_id === chainId.toString()
    );
    
    return network?.name || null;
  }
  
  /**
   * Check if there's a route from source chain to any merchant chain for a token
   */
  static async checkRoute(sourceChainId: number, tokenSymbol: string): Promise<{
    hasRoute: boolean;
    destinationNetwork?: string;
    destinationChainId?: number;
  }> {
    const sourceNetwork = this.getLayerswapNetworkName(sourceChainId);
    if (!sourceNetwork) {
      return { hasRoute: false };
    }
    
    // Check routes to each merchant network
    for (const merchantNetwork of this.merchantNetworkNames) {
      try {
        const quote = await this.getQuote(
          sourceNetwork,
          merchantNetwork,
          tokenSymbol,
          tokenSymbol,
          1 // Test with 1 unit
        );
        
        if (quote) {
          // Find the chain ID for this merchant network
          const network = this.supportedNetworks?.find(n => n.name === merchantNetwork);
          const chainId = network ? parseInt(network.chain_id) : undefined;
          
          return { 
            hasRoute: true, 
            destinationNetwork: merchantNetwork,
            destinationChainId: chainId
          };
        }
      } catch (e) {
        // Continue checking other merchant networks
        continue;
      }
    }
    
    return { hasRoute: false };
  }
  
  /**
   * Get a quote from Layerswap
   */
  private static async getQuote(
    sourceNetwork: string,
    destinationNetwork: string,
    sourceToken: string,
    destinationToken: string,
    amount: number
  ): Promise<LayerswapQuote | null> {
    return new Promise((resolve) => {
      const queryParams = new URLSearchParams({
        source_network: sourceNetwork,
        destination_network: destinationNetwork,
        source_token: sourceToken,
        destination_token: destinationToken,
        amount: amount.toString(),
        refuel: 'false',
        use_deposit_address: 'true'
      });
      
      const options = {
        hostname: 'api.layerswap.io',
        port: 443,
        path: `/api/v2/quote?${queryParams}`,
        method: 'GET',
        headers: {
          'X-LS-APIKEY': LAYERSWAP_API_KEY,
          'Content-Type': 'application/json'
        }
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200 && data) {
            try {
              const quote = JSON.parse(data);
              resolve(quote);
            } catch (e) {
              resolve(null);
            }
          } else {
            resolve(null);
          }
        });
      });
      
      req.on('error', () => resolve(null));
      req.end();
    });
  }
  
  /**
   * Create a swap on Layerswap
   */
  static async createSwap(
    sourceChainId: number,
    destinationChainId: number,
    tokenSymbol: string,
    amount: number
  ): Promise<{
    swapId: string;
    depositAddress: string;
    depositAmount: number;
    callData: string;
    tokenContract: string;
  } | null> {
    const sourceNetwork = this.getLayerswapNetworkName(sourceChainId);
    const destinationNetwork = this.getLayerswapNetworkName(destinationChainId);
    
    if (!sourceNetwork || !destinationNetwork) {
      console.error('Failed to map chain IDs to Layerswap networks');
      return null;
    }
    
    return new Promise((resolve) => {
      const swapData = {
        source_network: sourceNetwork,
        destination_network: destinationNetwork,
        source_token: tokenSymbol,
        destination_token: tokenSymbol,
        destination_address: MERCHANT_ADDRESS,
        amount: amount,
        refuel: false,
        use_deposit_address: true,
        reference_id: Date.now().toString()
      };
      
      const options = {
        hostname: 'api.layerswap.io',
        port: 443,
        path: '/api/v2/swaps',
        method: 'POST',
        headers: {
          'X-LS-APIKEY': LAYERSWAP_API_KEY,
          'Content-Type': 'application/json'
        }
      };
      
      const req = https.request(options, (res) => {
        let data = '';
        res.on('data', (chunk) => data += chunk);
        res.on('end', () => {
          if (res.statusCode === 200 || res.statusCode === 201) {
            try {
              const response = JSON.parse(data);
              const swap = response.data.swap;
              const depositAction = response.data.deposit_actions[0];
              
              if (depositAction && depositAction.call_data) {
                // Decode the calldata to get the deposit address
                const toAddress = '0x' + depositAction.call_data.slice(34, 74);
                
                resolve({
                  swapId: swap.id,
                  depositAddress: toAddress,
                  depositAmount: swap.requested_amount,
                  callData: depositAction.call_data,
                  tokenContract: depositAction.token.contract || ''
                });
              } else {
                console.error('No deposit action in swap response');
                resolve(null);
              }
            } catch (e) {
              console.error('Failed to parse swap response:', e);
              resolve(null);
            }
          } else {
            console.error(`Swap creation failed: ${res.statusCode} - ${data}`);
            resolve(null);
          }
        });
      });
      
      req.on('error', (error) => {
        console.error('Request error:', error);
        resolve(null);
      });
      
      req.write(JSON.stringify(swapData));
      req.end();
    });
  }
}