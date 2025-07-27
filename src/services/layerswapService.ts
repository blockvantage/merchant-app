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
  deposit_address?: string; // Some API responses include this directly
  status: string;
  requested_amount: number;
  use_deposit_address?: boolean;
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
        quote_id: null,
        use_deposit_address: true,
        reference_id: Date.now().toString()
      };
      
      console.log('\n📤 Sending swap request to Layerswap:');
      console.log(JSON.stringify(swapData, null, 2));
      
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
          console.log(`\n📥 Layerswap API Response:`);
          console.log(`   Status: ${res.statusCode}`);
          console.log(`   Headers:`, res.headers);
          
          if (res.statusCode === 200 || res.statusCode === 201) {
            try {
              console.log(`   Raw response length: ${data.length} bytes`);
              const response = JSON.parse(data);
              
              console.log(`\n📋 Response structure:`);
              console.log(`   Has 'data' field: ${!!response.data}`);
              console.log(`   Response keys: ${Object.keys(response).join(', ')}`);
              
              if (response.data) {
                console.log(`   Data keys: ${Object.keys(response.data).join(', ')}`);
                console.log(`   Has swap: ${!!response.data.swap}`);
                console.log(`   Has deposit_actions: ${!!response.data.deposit_actions}`);
                
                if (response.data.deposit_actions) {
                  console.log(`   Deposit actions count: ${response.data.deposit_actions.length}`);
                  if (response.data.deposit_actions.length > 0) {
                    const action = response.data.deposit_actions[0];
                    console.log(`   First deposit action keys: ${Object.keys(action).join(', ')}`);
                    console.log(`   Has call_data: ${!!action.call_data}`);
                    console.log(`   Action type: ${action.type}`);
                    console.log(`   To address: ${action.to_address}`);
                    console.log(`   Amount: ${action.amount}`);
                  }
                }
                
                if (response.data.swap) {
                  console.log(`\n📄 Swap details:`);
                  console.log(`   ID: ${response.data.swap.id}`);
                  console.log(`   Status: ${response.data.swap.status}`);
                  console.log(`   Requested amount: ${response.data.swap.requested_amount}`);
                  console.log(`   Use deposit address: ${response.data.swap.use_deposit_address}`);
                }
              }
              
              // Log the full response for debugging
              console.log(`\n🔍 Full API response:`, JSON.stringify(response, null, 2));
              
              const swap = response.data?.swap;
              const depositAction = response.data?.deposit_actions?.[0];
              
              if (depositAction && depositAction.call_data) {
                // Decode the calldata to get the deposit address
                const toAddress = '0x' + depositAction.call_data.slice(34, 74);
                
                console.log(`\n✅ Successfully extracted deposit info:`);
                console.log(`   Swap ID: ${swap.id}`);
                console.log(`   Deposit address: ${toAddress}`);
                console.log(`   Amount: ${swap.requested_amount}`);
                
                resolve({
                  swapId: swap.id,
                  depositAddress: toAddress,
                  depositAmount: swap.requested_amount,
                  callData: depositAction.call_data,
                  tokenContract: depositAction.token.contract || ''
                });
              } else if (depositAction && depositAction.to_address) {
                // Sometimes the deposit address is provided directly
                console.log(`\n✅ Using direct deposit address:`);
                console.log(`   Swap ID: ${swap.id}`);
                console.log(`   Deposit address: ${depositAction.to_address}`);
                console.log(`   Amount: ${swap.requested_amount}`);
                
                resolve({
                  swapId: swap.id,
                  depositAddress: depositAction.to_address,
                  depositAmount: swap.requested_amount,
                  callData: depositAction.call_data || '',
                  tokenContract: depositAction.token?.contract || ''
                });
              } else if (swap && swap.deposit_address) {
                // Sometimes the deposit address is on the swap object itself
                console.log('\n✅ Using deposit address from swap object:');
                console.log(`   Swap ID: ${swap.id}`);
                console.log(`   Deposit address: ${swap.deposit_address}`);
                console.log(`   Amount: ${swap.requested_amount}`);
                
                resolve({
                  swapId: swap.id,
                  depositAddress: swap.deposit_address,
                  depositAmount: swap.requested_amount,
                  callData: '',
                  tokenContract: ''
                });
              } else {
                console.error('\n❌ No valid deposit action in swap response');
                console.error('Expected deposit_actions array with call_data or to_address, or swap.deposit_address');
                console.error('Available swap fields:', swap ? Object.keys(swap).join(', ') : 'No swap object');
                resolve(null);
              }
            } catch (e) {
              console.error('\n❌ Failed to parse swap response:', e);
              console.error('Raw response:', data.substring(0, 500));
              resolve(null);
            }
          } else {
            console.error(`\n❌ Swap creation failed: ${res.statusCode}`);
            console.error('Response body:', data || '(empty)');
            
            // Try to parse error details if available
            if (data) {
              try {
                const errorResponse = JSON.parse(data);
                console.error('Error details:', JSON.stringify(errorResponse, null, 2));
              } catch (e) {
                console.error('Raw error response:', data);
              }
            }
            
            // Log request details for debugging
            console.error('\n🔍 Request details that failed:');
            console.error(`   URL: https://${options.hostname}${options.path}`);
            console.error(`   Method: ${options.method}`);
            console.error(`   Headers:`, options.headers);
            
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