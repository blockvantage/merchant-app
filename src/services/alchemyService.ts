import { ALCHEMY_BASE_URL } from '../config/index.js';
import { TokenWithPrice, AlchemyTokenBalance, AlchemyTokenMetadata } from '../types/index.js';
import { PriceService } from './priceService.js';

/**
 * Service for interacting with Alchemy API to fetch wallet balances
 */
export class AlchemyService {
  /**
   * Fetch all balances (ETH + tokens) for an address
   */
  static async fetchBalances(address: string): Promise<TokenWithPrice[]> {
    try {
      console.log(`Fetching balances for Ethereum address: ${address}`);

      // Get ETH balance
      const ethBalanceResponse = await fetch(ALCHEMY_BASE_URL, {
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

      // Get all token balances
      const tokenBalancesResponse = await fetch(ALCHEMY_BASE_URL, {
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

      if (!ethBalanceResponse.ok || !tokenBalancesResponse.ok) {
        throw new Error(`HTTP error! ETH: ${ethBalanceResponse.status}, Tokens: ${tokenBalancesResponse.status}`);
      }

      const ethData = await ethBalanceResponse.json() as any;
      const tokenData = await tokenBalancesResponse.json() as any;

      console.log('\n=== WALLET BALANCES ===');

      const tokensWithPrices: TokenWithPrice[] = [];

      // Process ETH balance
      if (ethData.result) {
        const ethBalance = parseInt(ethData.result, 16) / Math.pow(10, 18);
        if (ethBalance > 0) {
          const ethPrice = await PriceService.getEthPrice();
          const ethValueUSD = ethBalance * ethPrice;
          console.log(`ETH: ${ethBalance.toFixed(4)} ($${ethValueUSD.toFixed(2)})`);
          
          // Add ETH as a "token" option for payment
          if (ethBalance > 0 && ethPrice > 0) {
            tokensWithPrices.push({
              address: '0x0000000000000000000000000000000000000000', // ETH address
              symbol: 'ETH',
              name: 'Ethereum',
              balance: ethBalance,
              decimals: 18,
              priceUSD: ethPrice,
              valueUSD: ethValueUSD
            });
          }
        }
      }

      // Process token balances
      if (tokenData.result && tokenData.result.tokenBalances) {
        console.log('\n=== TOKEN BALANCES ===');
        
        const nonZeroBalances = tokenData.result.tokenBalances.filter((token: AlchemyTokenBalance) => 
          token.tokenBalance && token.tokenBalance !== '0x0'
        );

        if (nonZeroBalances.length > 0) {
          const tokenBalances = await this.processTokenBalances(nonZeroBalances);
          tokensWithPrices.push(...tokenBalances);
        } else {
          console.log('No token balances found');
        }
      }

      return tokensWithPrices;

    } catch (error) {
      console.error('Error fetching Alchemy data:', error);
      console.log('\n📝 To use this feature:');
      console.log('1. Get a free API key at: https://dashboard.alchemy.com/');
      console.log('2. Set environment variable: export ALCHEMY_API_KEY=your_key_here');
      console.log('3. Or replace YOUR_API_KEY in the code with your actual key');
      return [];
    }
  }

  /**
   * Process token balances with metadata and prices
   */
  private static async processTokenBalances(nonZeroBalances: AlchemyTokenBalance[]): Promise<TokenWithPrice[]> {
    const tokensWithPrices: TokenWithPrice[] = [];
    
    // Get token metadata for the tokens with balances
    const tokenAddresses = nonZeroBalances.map((token) => token.contractAddress);
    
    const metadataResponse = await fetch(ALCHEMY_BASE_URL, {
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
    });

    // Get token prices from CoinGecko
    const tokenPrices = await PriceService.getTokenPrices(tokenAddresses);

    if (metadataResponse.ok) {
      const metadataData = await metadataResponse.json() as any;
      
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
            if (priceUSD > 0) {
              console.log(`${symbol}: ${formattedBalance.toFixed(4)} ($${valueUSD.toFixed(2)}) - ${name}`);
              
              // Add to tokens with prices for payment calculation
              tokensWithPrices.push({
                address: token.contractAddress,
                symbol,
                name,
                balance: formattedBalance,
                decimals,
                priceUSD,
                valueUSD
              });
            } else {
              console.log(`${symbol}: ${formattedBalance.toFixed(4)} (Price unknown) - ${name}`);
            }
          }
        } catch (e) {
          console.log(`Token ${token.contractAddress}: Raw balance ${token.tokenBalance}`);
        }
      });
    }

    return tokensWithPrices;
  }
} 