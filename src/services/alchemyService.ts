import { SUPPORTED_CHAINS, ChainConfig } from '../config/index.js';
import { TokenWithPrice, AlchemyTokenBalance, AlchemyTokenMetadata, MultiChainPortfolio, ChainBalances } from '../types/index.js';
import { PriceService } from './priceService.js';
import { Alchemy, Network, TransactionReceipt, TransactionResponse, AlchemySubscription, AlchemyMinedTransactionsAddress } from 'alchemy-sdk';
import { config } from '../config/index.js';

interface Transaction {
    hash: string;
    value: number;
    from: string;
    to: string;
}

interface MonitoringSubscription {
  alchemy: Alchemy;
  subscription: any;
  chainConfig: ChainConfig;
}

/**
 * Service for interacting with Alchemy API to fetch wallet balances across multiple chains
 * and monitor transactions in real-time using WebSocket subscriptions
 */
export class AlchemyService {
  private static alchemyInstances: Map<number, Alchemy> = new Map();
  private static isInitialized = false;
  private static activeSubscriptions: Map<string, MonitoringSubscription> = new Map();

  /**
   * Initialize Alchemy instances for all supported chains
   */
  static initialize() {
    if (this.isInitialized) return;

    if (!config.ALCHEMY_API_KEY) {
      throw new Error('ALCHEMY_API_KEY is not set in environment variables');
    }

    try {
      // Initialize Alchemy instances for all supported chains
      SUPPORTED_CHAINS.forEach(chain => {
        const networkMapping = this.getAlchemyNetwork(chain.id);
        if (networkMapping) {
          const alchemy = new Alchemy({
            apiKey: config.ALCHEMY_API_KEY,
            network: networkMapping,
          });
          this.alchemyInstances.set(chain.id, alchemy);
          console.log(`✅ Alchemy instance initialized for ${chain.displayName}`);
        } else {
          console.warn(`⚠️ No Alchemy network mapping found for ${chain.displayName} (Chain ID: ${chain.id})`);
        }
      });

      this.isInitialized = true;
      console.log(`✅ AlchemyService initialized with ${this.alchemyInstances.size} chains`);
    } catch (error) {
      console.error('❌ Failed to initialize AlchemyService:', error);
      throw error;
    }
  }

  /**
   * Map chain IDs to Alchemy Network enums
   */
  private static getAlchemyNetwork(chainId: number): Network | null {
    const networkMap: {[key: number]: Network} = {
      1: Network.ETH_MAINNET,        // Ethereum
      8453: Network.BASE_MAINNET,    // Base
      42161: Network.ARB_MAINNET,    // Arbitrum
      10: Network.OPT_MAINNET,       // Optimism
      137: Network.MATIC_MAINNET     // Polygon
      // Note: Starknet (393402133025423) uses different API patterns and doesn't support WebSocket subscriptions
    };
    
    return networkMap[chainId] || null;
  }

  /**
   * Get chain configuration by chain ID
   */
  private static getChainConfig(chainId: number): ChainConfig | null {
    return SUPPORTED_CHAINS.find(chain => chain.id === chainId) || null;
  }

  static isEthereumAddress(address: string): boolean {
    return /^0x[a-fA-F0-9]{40}$/.test(address);
  }

  /**
   * Fetch all balances across all supported chains in parallel
   */
  static async fetchMultiChainBalances(address: string): Promise<MultiChainPortfolio> {
    if (!this.isInitialized) this.initialize();

    try {
      console.log(`\n🔄 Fetching balances for ${address} across ${SUPPORTED_CHAINS.length} chains...`);

      // Fetch balances for all chains in parallel
      const chainBalancePromises = SUPPORTED_CHAINS.map(chain => 
        this.fetchChainBalances(address, chain)
      );

      const chainBalances = await Promise.all(chainBalancePromises);

      // Aggregate results
      const portfolio: MultiChainPortfolio = {
        address,
        chains: chainBalances,
        totalValueUSD: chainBalances.reduce((sum, chain) => sum + chain.totalValueUSD, 0),
        allTokens: chainBalances.flatMap(chain => chain.tokens)
      };

      // Display summary
      this.displayPortfolioSummary(portfolio);

      return portfolio;

    } catch (error) {
      console.error('Error fetching multi-chain balances:', error);
      return {
        address,
        chains: [],
        totalValueUSD: 0,
        allTokens: []
      };
    }
  }

  /**
   * Fetch balances for a single chain
   */
  private static async fetchChainBalances(address: string, chain: ChainConfig): Promise<ChainBalances> {
    try {
      console.log(`⛓️  Fetching ${chain.displayName} balances...`);

      // Fetch native token and ERC-20 token balances in parallel
      const [nativeBalance, tokenBalances] = await Promise.all([
        this.fetchNativeBalance(address, chain),
        this.fetchTokenBalances(address, chain)
      ]);

      const tokens: TokenWithPrice[] = [];

      // Add native token if has balance
      if (nativeBalance && nativeBalance.balance > 0) {
        tokens.push(nativeBalance);
      }

      // Add ERC-20 tokens
      tokens.push(...tokenBalances);

      const totalValueUSD = tokens.reduce((sum, token) => sum + token.valueUSD, 0);

      console.log(`✅ ${chain.displayName}: ${tokens.length} tokens, $${totalValueUSD.toFixed(2)}`);

      return {
        chainId: chain.id,
        chainName: chain.name,
        chainDisplayName: chain.displayName,
        tokens,
        totalValueUSD
      };

    } catch (error) {
      console.error(`Error fetching ${chain.displayName} balances:`, error);
      return {
        chainId: chain.id,
        chainName: chain.name,
        chainDisplayName: chain.displayName,
        tokens: [],
        totalValueUSD: 0
      };
    }
  }

  /**
   * Fetch native token balance for a chain
   */
  private static async fetchNativeBalance(address: string, chain: ChainConfig): Promise<TokenWithPrice | null> {
    try {
      const response = await fetch(chain.alchemyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'eth_getBalance',
          params: [address, 'latest']
        })
      });

      if (!response.ok) return null;

      const data = await response.json() as any;
      if (!data.result) return null;

      const balance = parseInt(data.result, 16) / Math.pow(10, chain.nativeToken.decimals);
      if (balance <= 0) return null;

      // Get native token price
      const ethPrice = await PriceService.getEthPrice();
      const valueUSD = balance * ethPrice;

      return {
        address: '0x0000000000000000000000000000000000000000',
        symbol: chain.nativeToken.symbol,
        name: `${chain.nativeToken.name} (${chain.displayName})`,
        balance,
        decimals: chain.nativeToken.decimals,
        priceUSD: ethPrice,
        valueUSD,
        chainId: chain.id,
        chainName: chain.name,
        chainDisplayName: chain.displayName,
        isNativeToken: true
      };

    } catch (error) {
      console.error(`Error fetching ${chain.displayName} native balance:`, error);
      return null;
    }
  }

  /**
   * Fetch ERC-20 token balances for a chain
   */
  private static async fetchTokenBalances(address: string, chain: ChainConfig): Promise<TokenWithPrice[]> {
    try {
      const response = await fetch(chain.alchemyUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 2,
          method: 'alchemy_getTokenBalances',
          params: [address]
        })
      });

      if (!response.ok) return [];

      const data = await response.json() as any;
      if (!data.result?.tokenBalances) return [];

      const nonZeroBalances = data.result.tokenBalances.filter((token: AlchemyTokenBalance) => 
        token.tokenBalance && token.tokenBalance !== '0x0'
      );

      if (nonZeroBalances.length === 0) return [];

      return await this.processTokenBalances(nonZeroBalances, chain);

    } catch (error) {
      console.error(`Error fetching ${chain.displayName} token balances:`, error);
      return [];
    }
  }

  /**
   * Process token balances with metadata and prices
   */
  private static async processTokenBalances(nonZeroBalances: AlchemyTokenBalance[], chain: ChainConfig): Promise<TokenWithPrice[]> {
    try {
      const tokenAddresses = nonZeroBalances.map((token) => token.contractAddress);
      
      // Fetch metadata and prices in parallel
      const [metadataResponse, tokenPrices] = await Promise.all([
        fetch(chain.alchemyUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            jsonrpc: '2.0',
            id: 3,
            method: 'alchemy_getTokenMetadata',
            params: tokenAddresses
          })
        }),
        PriceService.getTokenPricesForChain(tokenAddresses, chain.name)
      ]);

      if (!metadataResponse.ok) return [];

      const metadataData = await metadataResponse.json() as any;
      const tokensWithPrices: TokenWithPrice[] = [];
      
      nonZeroBalances.forEach((token, index) => {
        try {
          const balance = parseInt(token.tokenBalance, 16);
          const metadata: AlchemyTokenMetadata = metadataData.result?.[index];
          const decimals = metadata?.decimals || 18;
          const symbol = metadata?.symbol || 'UNKNOWN';
          const name = metadata?.name || 'Unknown Token';
          const contractAddress = token.contractAddress.toLowerCase();
          
          const formattedBalance = balance / Math.pow(10, decimals);
          const priceUSD = tokenPrices[contractAddress] || 0;
          const valueUSD = formattedBalance * priceUSD;
          
          if (formattedBalance > 0) {
            tokensWithPrices.push({
              address: token.contractAddress,
              symbol,
              name: `${name} (${chain.displayName})`,
              balance: formattedBalance,
              decimals,
              priceUSD,
              valueUSD,
              chainId: chain.id,
              chainName: chain.name,
              chainDisplayName: chain.displayName,
              isNativeToken: false
            });
          }
        } catch (e) {
          console.log(`Error processing token ${token.contractAddress} on ${chain.displayName}`);
        }
      });

      return tokensWithPrices;

    } catch (error) {
      console.error(`Error processing ${chain.displayName} token balances:`, error);
      return [];
    }
  }

  /**
   * Display portfolio summary
   */
  private static displayPortfolioSummary(portfolio: MultiChainPortfolio): void {
    console.log('\n=== 🌐 MULTI-CHAIN PORTFOLIO ===');
    console.log(`💼 Total Value: $${portfolio.totalValueUSD.toFixed(2)}\n`);

    portfolio.chains.forEach(chain => {
      if (chain.tokens.length > 0) {
        console.log(`⛓️  ${chain.chainDisplayName} ($${chain.totalValueUSD.toFixed(2)}):`);
        
        chain.tokens.forEach(token => {
          if (token.priceUSD > 0) {
            console.log(`  ${token.symbol}: ${token.balance.toFixed(4)} ($${token.valueUSD.toFixed(2)})`);
          } else {
            console.log(`  ${token.symbol}: ${token.balance.toFixed(4)} (Price unknown)`);
          }
        });
        console.log('');
      }
    });

    // Show tokens sorted by value
    const topTokens = portfolio.allTokens
      .filter(token => token.priceUSD > 0)
      .sort((a, b) => b.valueUSD - a.valueUSD)
      .slice(0, 10);

    if (topTokens.length > 0) {
      console.log('🏆 Top Holdings:');
      topTokens.forEach((token, index) => {
        console.log(`  ${index + 1}. ${token.symbol} (${token.chainDisplayName}): $${token.valueUSD.toFixed(2)}`);
      });
      console.log('');
    }
  }

  /**
   * Legacy single-chain method for backward compatibility
   */
  static async fetchBalances(address: string): Promise<TokenWithPrice[]> {
    const portfolio = await this.fetchMultiChainBalances(address);
    return portfolio.allTokens;
  }

  /**
   * Monitor transactions on a specific chain using WebSocket subscriptions
   * Now supports multiple chains including Base, Ethereum, Arbitrum, and Optimism
   */
  static async monitorTransactions(
    address: string,
    callback: (tx: Transaction) => void,
    chainId: number = 1,
    minimumValueWei: number = 0
  ): Promise<() => void> {
    if (!this.isInitialized) this.initialize();

    if (!this.isEthereumAddress(address)) {
      throw new Error(`Invalid Ethereum address: ${address}`);
    }

    const chainConfig = this.getChainConfig(chainId);
    if (!chainConfig) {
      throw new Error(`Unsupported chain ID: ${chainId}. Supported chains: ${SUPPORTED_CHAINS.map(c => `${c.displayName} (${c.id})`).join(', ')}`);
    }

    const alchemy = this.alchemyInstances.get(chainId);
    if (!alchemy) {
      throw new Error(`No Alchemy instance found for chain ID: ${chainId} (${chainConfig.displayName})`);
    }

    const subscriptionKey = `${address}-${chainId}`;

    try {
      console.log(`🔍 Starting transaction monitoring for address: ${address}`);
      console.log(`⛓️ Monitoring ${chainConfig.displayName} (Chain ID: ${chainId}) for incoming transactions`);
      console.log(`📡 Listening for mined transactions to address: ${address}`);
      if (minimumValueWei > 0) {
        console.log(`💰 Minimum transaction value: ${minimumValueWei / 1e18} ETH (${minimumValueWei} wei)`);
      }
      
      // Subscribe to mined transactions for this specific chain
      const subscription = await alchemy.ws.on(
        {
          method: AlchemySubscription.MINED_TRANSACTIONS,
          addresses: [{ to: address } as AlchemyMinedTransactionsAddress],
          includeRemoved: false,
          hashesOnly: false
        },
        async (tx: any) => {
          try {
            // Handle different response formats from Alchemy
            const transaction = tx.transaction || tx;
            
            if (!transaction.hash || !transaction.from || !transaction.to) {
              console.error('Invalid transaction data:', transaction);
              return;
            }

            const valueInWei = parseInt(transaction.value?.toString() || '0', 16);
            const valueInEth = valueInWei / 1e18;
            
            console.log(`🔔 Transaction detected on ${chainConfig.displayName}:`, {
              hash: transaction.hash,
              from: transaction.from,
              to: transaction.to,
              value: `${valueInEth} ETH (${valueInWei} wei)`,
              blockNumber: transaction.blockNumber
            });

            // Check minimum value requirement
            if (minimumValueWei > 0 && valueInWei < minimumValueWei) {
              console.log(`⚠️ Transaction below minimum value: ${valueInEth} ETH < ${minimumValueWei / 1e18} ETH`);
              return;
            }

            // Get transaction receipt to verify it's successfully mined
            const receipt = await alchemy.core.getTransactionReceipt(transaction.hash);
            if (receipt && receipt.status === 1) {
              console.log(`✅ Transaction confirmed on ${chainConfig.displayName}: ${transaction.hash}`);
              console.log(`💎 Payment details: ${valueInEth} ETH from ${transaction.from} to ${transaction.to}`);
              
              callback({
                hash: transaction.hash,
                value: valueInWei,
                from: transaction.from,
                to: transaction.to,
              });
            } else {
              console.log(`⚠️ Transaction failed or still pending: ${transaction.hash}, status: ${receipt?.status}`);
            }
          } catch (error) {
            console.error(`Error processing transaction on ${chainConfig.displayName}:`, error);
          }
        }
      );

      // Store the subscription for cleanup
      this.activeSubscriptions.set(subscriptionKey, {
        alchemy,
        subscription,
        chainConfig
      });

      console.log(`✅ Transaction monitoring subscription established for ${chainConfig.displayName}`);
      console.log('🎯 Ready to detect payments...');
      
      // Return unsubscribe function
      return () => {
        console.log(`🔌 Unsubscribing from transaction monitoring on ${chainConfig.displayName}`);
        const storedSubscription = this.activeSubscriptions.get(subscriptionKey);
        if (storedSubscription) {
          storedSubscription.subscription.removeAllListeners();
          this.activeSubscriptions.delete(subscriptionKey);
        }
      };
    } catch (error) {
      console.error(`Error setting up transaction monitoring on ${chainConfig.displayName}:`, error);
      throw error;
    }
  }

  /**
   * Monitor transactions across multiple chains simultaneously
   */
  static async monitorMultiChainTransactions(
    address: string,
    callback: (tx: Transaction & { chainId: number, chainName: string }) => void,
    chainIds: number[] = SUPPORTED_CHAINS.map(c => c.id),
    minimumValueWei: number = 0
  ): Promise<() => void> {
    console.log(`🌐 Starting multi-chain monitoring for address: ${address}`);
    console.log(`⛓️ Monitoring chains: ${chainIds.map(id => {
      const chain = this.getChainConfig(id);
      return chain ? `${chain.displayName} (${id})` : `Unknown (${id})`;
    }).join(', ')}`);

    const unsubscribeFunctions: (() => void)[] = [];

    // Set up monitoring for each chain
    for (const chainId of chainIds) {
      try {
        const chainConfig = this.getChainConfig(chainId);
        if (!chainConfig) {
          console.warn(`⚠️ Skipping unsupported chain ID: ${chainId}`);
          continue;
        }

        const unsubscribe = await this.monitorTransactions(
          address,
          (tx) => {
            // Enhanced callback with chain information
            callback({
              ...tx,
              chainId,
              chainName: chainConfig.displayName
            });
          },
          chainId,
          minimumValueWei
        );

        unsubscribeFunctions.push(unsubscribe);
      } catch (error) {
        console.error(`Failed to set up monitoring for chain ${chainId}:`, error);
      }
    }

    console.log(`✅ Multi-chain monitoring active on ${unsubscribeFunctions.length} chains`);

    // Return function to unsubscribe from all chains
    return () => {
      console.log('🔌 Unsubscribing from all multi-chain monitoring');
      unsubscribeFunctions.forEach(unsubscribe => unsubscribe());
    };
  }

  /**
   * Get all active subscriptions
   */
  static getActiveSubscriptions(): string[] {
    return Array.from(this.activeSubscriptions.keys());
  }

  /**
   * Cleanup all active subscriptions
   */
  static cleanup(): void {
    console.log(`🧹 Cleaning up ${this.activeSubscriptions.size} active subscriptions`);
    this.activeSubscriptions.forEach((subscription, key) => {
      subscription.subscription.removeAllListeners();
    });
    this.activeSubscriptions.clear();
  }

  /**
   * Special polling-based monitoring for Starknet since WebSockets aren't supported
   */
  private static async startStarknetPolling(
    merchantAddress: string,
    minimumValue: number,
    chainConfig: ChainConfig,
    onTransaction?: (transaction: Transaction) => void
  ): Promise<Transaction> {
    return new Promise<Transaction>((resolve, reject) => {
      console.log(`🔄 Starting Starknet polling for address: ${merchantAddress}`);
      
      const pollingInterval = setInterval(async () => {
        try {
          // Use direct HTTP API call to Starknet
          const response = await fetch(chainConfig.alchemyUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              jsonrpc: '2.0',
              id: 1,
              method: 'starknet_getBlockWithTxs',
              params: ['latest']
            })
          });

          const data = await response.json();
          
          if (data.result && data.result.transactions) {
            // Check transactions for payments to our address
            for (const tx of data.result.transactions) {
              if (tx.to === merchantAddress && tx.value) {
                const valueInWei = parseInt(tx.value, 16);
                
                if (valueInWei >= minimumValue) {
                  console.log(`✅ Starknet payment found! Value: ${valueInWei} wei`);
                  
                  const transaction: Transaction = {
                    hash: tx.transaction_hash || tx.hash,
                    value: valueInWei,
                    from: tx.from || tx.sender_address,
                    to: tx.to || tx.contract_address
                  };

                  clearInterval(pollingInterval);
                  if (onTransaction) {
                    onTransaction(transaction);
                  }
                  resolve(transaction);
                  return;
                }
              }
            }
          }
        } catch (error) {
          console.error('Error polling Starknet:', error);
        }
      }, 5000); // Poll every 5 seconds

      // Timeout after 5 minutes
      setTimeout(() => {
        clearInterval(pollingInterval);
        reject(new Error('Starknet polling timeout'));
      }, 300000);
    });
  }

  /**
   * Start monitoring transactions to a specific address on the given chain
   * Returns a promise that resolves when a matching transaction is found
   */
  static async startMonitoring(
    merchantAddress: string,
    minimumValue: number,
    chainId: number,
    chainName: string,
    onTransaction?: (transaction: Transaction) => void
  ): Promise<Transaction> {
    try {
      // Find the chain config
      const chainConfig = SUPPORTED_CHAINS.find(chain => chain.id === chainId);
      if (!chainConfig) {
        throw new Error(`Chain ${chainName} (ID: ${chainId}) is not supported`);
      }

      // Special handling for Starknet which doesn't support WebSocket subscriptions
      if (chainId === 393402133025423) { // Starknet chain ID
        console.log(`⚠️  Starknet monitoring will use polling instead of WebSockets (WebSocket subscriptions not available for Starknet)`);
        return AlchemyService.startStarknetPolling(merchantAddress, minimumValue, chainConfig, onTransaction);
      }

      const network = AlchemyService.getAlchemyNetwork(chainId);
      if (!network) {
        throw new Error(`Network mapping not found for chain ${chainName} (ID: ${chainId})`);
      }

      console.log(`🔗 Starting WebSocket monitoring on ${chainName} (Chain ID: ${chainId})`);
      console.log(`📡 Monitoring address: ${merchantAddress}`);
      console.log(`💰 Minimum value: ${minimumValue} wei`);

      // Create Alchemy instance for this chain
      const settings = {
        apiKey: config.ALCHEMY_API_KEY,
        network: network,
      };
      const alchemy = new Alchemy(settings);

      return new Promise<Transaction>((resolve, reject) => {
        try {
          // Subscribe to mined transactions for the specific address
          const subscription = alchemy.ws.on({
            method: AlchemySubscription.MINED_TRANSACTIONS,
            addresses: [{ to: merchantAddress }]
          }, (tx: any) => {
            try {
              console.log(`🔍 Transaction detected on ${chainName}:`, {
                hash: tx.hash,
                from: tx.from,
                to: tx.to,
                value: tx.value,
                valueInWei: typeof tx.value === 'string' ? parseInt(tx.value, 16) : tx.value,
                minimumRequired: minimumValue
              });

              const valueInWei = typeof tx.value === 'string' ? parseInt(tx.value, 16) : Number(tx.value);
              
              if (valueInWei >= minimumValue) {
                console.log(`✅ Payment received on ${chainName}! Value: ${valueInWei} wei (${valueInWei / 1e18} ${chainConfig.nativeToken.symbol})`);
                
                const transaction: Transaction = {
                  hash: tx.hash,
                  value: valueInWei,
                  from: tx.from,
                  to: tx.to
                };

                // Store the subscription for cleanup
                const monitoringSubscription: MonitoringSubscription = {
                  alchemy,
                  subscription,
                  chainConfig
                };
                AlchemyService.activeSubscriptions.set(chainId.toString(), monitoringSubscription);

                if (onTransaction) {
                  onTransaction(transaction);
                }
                resolve(transaction);
              } else {
                console.log(`❌ Transaction value too small on ${chainName}: ${valueInWei} wei < ${minimumValue} wei required`);
              }
            } catch (error) {
              console.error(`Error processing transaction on ${chainName}:`, error);
              reject(error);
            }
          });

          // Store the subscription for cleanup
          const monitoringSubscription: MonitoringSubscription = {
            alchemy,
            subscription,
            chainConfig
          };
          AlchemyService.activeSubscriptions.set(chainId.toString(), monitoringSubscription);

          console.log(`🚀 WebSocket subscription active for ${chainName} monitoring`);

        } catch (error) {
          console.error(`Failed to set up WebSocket subscription for ${chainName}:`, error);
          reject(error);
        }
      });

    } catch (error) {
      console.error(`Error starting monitoring on ${chainName}:`, error);
      throw error;
    }
  }
} 