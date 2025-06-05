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

/**
 * Service for interacting with Alchemy API to fetch wallet balances across multiple chains
 */
export class AlchemyService {
  private static alchemy: Alchemy;
  private static isInitialized = false;

  static initialize() {
    if (this.isInitialized) return;

    if (!config.ALCHEMY_API_KEY) {
      throw new Error('ALCHEMY_API_KEY is not set in environment variables');
    }

    try {
      this.alchemy = new Alchemy({
        apiKey: config.ALCHEMY_API_KEY,
        network: Network.ETH_MAINNET,
      });

      this.isInitialized = true;
      console.log('✅ AlchemyService initialized successfully');
    } catch (error) {
      console.error('❌ Failed to initialize AlchemyService:', error);
      throw error;
    }
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

  static async monitorTransactions(
    address: string,
    callback: (tx: Transaction) => void
  ): Promise<() => void> {
    if (!this.isInitialized) this.initialize();

    if (!this.isEthereumAddress(address)) {
      throw new Error(`Invalid Ethereum address: ${address}`);
    }

    try {
      console.log(`🔍 Starting transaction monitoring for address: ${address}`);
      
      // Subscribe to new pending transactions
      const subscription = await this.alchemy.ws.on(
        {
          method: AlchemySubscription.MINED_TRANSACTIONS,
          addresses: [{ to: address } as AlchemyMinedTransactionsAddress],
        },
        async (tx: TransactionResponse) => {
          try {
            if (!tx.hash || !tx.from || !tx.to) {
              console.error('Invalid transaction data:', tx);
              return;
            }

            // Get transaction receipt to confirm it's mined
            const receipt = await this.alchemy.core.getTransactionReceipt(tx.hash);
            if (receipt && receipt.status === 1) {
              console.log(`✅ Transaction confirmed: ${tx.hash}`);
              callback({
                hash: tx.hash,
                value: parseInt(tx.value.toString(), 16),
                from: tx.from,
                to: tx.to,
              });
            }
          } catch (error) {
            console.error('Error processing transaction:', error);
          }
        }
      );

      console.log('✅ Transaction monitoring subscription established');
      
      // Return unsubscribe function
      return () => {
        console.log('🔌 Unsubscribing from transaction monitoring');
        subscription.removeAllListeners();
      };
    } catch (error) {
      console.error('Error setting up transaction monitoring:', error);
      throw error;
    }
  }
} 