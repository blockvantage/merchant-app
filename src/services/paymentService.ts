import { Reader } from 'nfc-pcsc';
import { PN532 } from 'pn532';
import * as ndef from 'ndef';
import { MERCHANT_ADDRESS, SUPPORTED_CHAINS } from '../config/index.js';
import { TokenWithPrice } from '../types/index.js';
import { EthereumService } from './ethereumService.js';
import { BridgeManager } from './bridgeManager.js';

// Export the payment result type for use in other modules
export interface PaymentResult {
  selectedToken: TokenWithPrice;
  requiredAmount: bigint;
  chainId: number;
  chainName: string;
  isLayerswap?: boolean;
  layerswapDepositAddress?: string;
  layerswapSwapId?: string;
}

/**
 * Service for handling payment requests and EIP-681 URI generation
 */
export class PaymentService {
  /**
   * Get chain name from chain ID for logging
   */
  private static getChainName(chainId: number): string {
    const chain = SUPPORTED_CHAINS.find(c => c.id === chainId);
    return chain ? chain.displayName : `Chain ${chainId}`;
  }

  /**
   * Generate EIP-681 format URI for payment request with chain ID support
   */
  static generateEIP681Uri(amount: bigint, tokenAddress: string, chainId: number): string {
    const amountString = amount.toString();
    
    if (EthereumService.isEthAddress(tokenAddress)) {
      // ETH payment request with chain ID
      // Format: ethereum:<recipient>@<chainId>?value=<amount>
      return `ethereum:${MERCHANT_ADDRESS}@${chainId}?value=${amountString}`;
    } else {
      // ERC-20 token payment request with chain ID
      // Format: ethereum:<recipient>@<chainId>/transfer?address=<tokenContract>&uint256=<amount>
      return `ethereum:${tokenAddress}@${chainId}/transfer?address=${MERCHANT_ADDRESS}&uint256=${amountString}`;
    }
  }


  /**
   * Create NDEF URI record for any URI
   * This formats the URI so Android will automatically open it with appropriate apps
   */
  static createNDEFUriRecord(uri: string): Buffer {
    // NDEF URI Record structure:
    // - Record Header: TNF (3 bits) + flags (5 bits)
    // - Type Length: 1 byte
    // - Payload Length: 1-4 bytes  
    // - Type: "U" for URI
    // - Payload: URI abbreviation code + URI

    const uriBytes = Buffer.from(uri, 'utf8');
    
    // URI abbreviation codes - 0x00 means no abbreviation (full URI)
    const uriAbbreviation = 0x00;
    
    // NDEF Record Header
    // TNF = 001 (Well Known), MB=1 (Message Begin), ME=1 (Message End), SR=1 (Short Record)
    const recordHeader = 0xD1; // 11010001 binary
    
    // Type Length (always 1 for URI records)
    const typeLength = 0x01;
    
    // Payload Length (URI abbreviation byte + URI bytes)
    const payloadLength = uriBytes.length + 1;
    
    // Type field ("U" for URI)
    const recordType = Buffer.from('U', 'ascii');
    
    // Create the complete NDEF message
    const ndefMessage = Buffer.concat([
      Buffer.from([recordHeader]),           // Record header
      Buffer.from([typeLength]),             // Type length  
      Buffer.from([payloadLength]),          // Payload length
      recordType,                            // Type ("U")
      Buffer.from([uriAbbreviation]),        // URI abbreviation code
      uriBytes                               // The actual URI
    ]);

    return ndefMessage;
  }

  /**
   * Send payment request via NFC using NDEF formatting
   * This will make Android automatically open the URI with wallet apps
   */
  static async sendPaymentRequest(reader: Reader, amount: bigint, tokenAddress: string, decimals: number, chainId: number): Promise<void> {
    try {
      const eip681Uri = this.generateEIP681Uri(amount, tokenAddress, chainId);
      
      const chainName = this.getChainName(chainId);
      console.log(`\n💳 Sending EIP-681 payment request for ${chainName} (Chain ID: ${chainId}):`);
      console.log(`📄 URI: ${eip681Uri}`);
      
      // Create NDEF URI record
      const ndefMessage = this.createNDEFUriRecord(eip681Uri);
      
      console.log(`📡 NDEF Message (${ndefMessage.length} bytes): ${ndefMessage.toString('hex')}`);
      
      // Send the NDEF formatted URI
      // @ts-expect-error Argument of type '{}' is not assignable to parameter of type 'never'.
      const response = await reader.transmit(ndefMessage, 256, {});
      
      if (response && response.length > 0) {
        console.log(`✅ NDEF payment request sent successfully for ${chainName}!`);
        console.log('📱 Wallet app should now open with transaction details...');
        const phoneResponse = response.toString();
        if (phoneResponse) {
          console.log(`📱 Phone response: ${phoneResponse}`);
        }
      } else {
        console.log(`❌ No response received from device`);
      }
    } catch (error: any) {
      console.error('Error sending payment request:', error);
      
      // Check for specific NFC transmission errors that indicate phone moved too quickly
      if (error.code === 'failure' && 
          (error.message?.includes('An error occurred while transmitting') ||
           error.message?.includes('TransmitError') ||
           error.previous?.message?.includes('SCardTransmit error') ||
           error.previous?.message?.includes('Transaction failed'))) {
        console.log('📱💨 Phone moved too quickly during payment request transmission');
        throw new Error('PHONE_MOVED_TOO_QUICKLY');
      }
      
      // Re-throw other errors as-is
      throw error;
    }
  }

  /**
   * Send payment request via PN532 using NDEF formatting
   */
  static async sendPaymentRequestPN532(pn532: PN532, amount: bigint, tokenAddress: string, decimals: number, chainId: number): Promise<void> {
    try {
      const eip681Uri = this.generateEIP681Uri(amount, tokenAddress, chainId);
      
      const chainName = this.getChainName(chainId);
      console.log(`\n💳 Sending EIP-681 payment request for ${chainName} (Chain ID: ${chainId}):`);
      console.log(`📄 URI: ${eip681Uri}`);
      
      // Create NDEF message with URI record
      const uriRecord = ndef.uriRecord(eip681Uri);
      const ndefMessage = ndef.encodeMessage([uriRecord]);
      
      console.log(`📡 NDEF Message (${ndefMessage.length} bytes)`);
      
      // Write NDEF message to tag
      await pn532.writeNdefData(ndefMessage);
      
      console.log(`✅ NDEF payment request sent successfully for ${chainName}!`);
      console.log('📱 Wallet app should now open with transaction details...');
      
    } catch (error: any) {
      console.error('Error sending PN532 payment request:', error);
      
      // Check for specific PN532 errors that indicate phone moved too quickly
      if (error.message?.includes('timeout') || 
          error.message?.includes('Timeout') ||
          error.message?.includes('No response')) {
        console.log('📱💨 Phone moved too quickly during payment request transmission');
        throw new Error('PHONE_MOVED_TOO_QUICKLY');
      }
      
      // Re-throw other errors as-is
      throw error;
    }
  }

  /**
   * Calculate payment options and send payment request (PN532 version)
   */
  static async calculateAndSendPaymentPN532(tokensWithPrices: TokenWithPrice[], pn532: PN532, targetUSD: number): Promise<PaymentResult> {
    const startTime = Date.now();
    console.log(`⏱️ [PROFILE] Starting calculateAndSendPaymentPN532 for $${targetUSD} with ${tokensWithPrices.length} tokens`);
    
    // Filter tokens that have sufficient balance for targetUSD payment
    const viableTokens = tokensWithPrices.filter(token => 
      token.priceUSD > 0 && token.valueUSD >= targetUSD
    );

    if (viableTokens.length === 0) {
      console.log(`\n❌ No tokens found with sufficient balance for $${targetUSD} payment`);
      throw new Error(`Customer doesn't have enough funds`);
    }

    console.log(`\n💰 PAYMENT OPTIONS ($${targetUSD}):`);
    console.log(`🎯 Priority Order: L2 Stablecoin > L2 Other > L2 ETH > L1 Stablecoin > L1 Other > L1 ETH\n`);
    
    // Smart payment selection: prefer L2 stablecoins, then follow priority order
    const selectedToken = this.selectBestPaymentToken(viableTokens);
    const selectionTime = Date.now() - startTime;
    console.log(`⏱️ [PROFILE] Token selection and analysis completed in ${selectionTime}ms`);
    
    // Calculate exact amount in smallest units using BigInt arithmetic
    const targetUSDCents = Math.round(targetUSD * 1e8); // Convert to 8 decimal precision
    const priceUSDCents = Math.round(selectedToken.priceUSD * 1e8);
    const requiredAmount = (BigInt(targetUSDCents) * BigInt(10 ** selectedToken.decimals)) / BigInt(priceUSDCents);
    
    // Convert to display format
    const displayAmount = Number(requiredAmount) / Math.pow(10, selectedToken.decimals);
    
    console.log(`\n🎯 SELECTED PAYMENT:`);
    console.log(`💰 Merchant amount: $${targetUSD.toFixed(2)} USD`);
    console.log(`💳 Token: ${selectedToken.symbol}`);
    console.log(`🔢 Token amount: ${displayAmount} ${selectedToken.symbol}`);
    console.log(`📊 Exact amount: ${requiredAmount.toString()} smallest units`);
    console.log(`⛓️  Chain: ${selectedToken.chainDisplayName} (Chain ID: ${selectedToken.chainId})`);
    console.log(`💵 Price: $${selectedToken.priceUSD.toFixed(4)} per ${selectedToken.symbol}`);
    
    // Check if merchant supports this chain
    const isMerchantChain = BridgeManager.isMerchantSupportedChain(selectedToken.chainId);
    
    if (!isMerchantChain) {
      console.log(`\n🔄 Chain ${selectedToken.chainDisplayName} not supported by merchant, checking bridge routes...`);
      
      // Find a bridge route
      const routeResult = await BridgeManager.findBestRoute(selectedToken.chainId, selectedToken.symbol);
      
      if (!routeResult) {
        throw new Error(`Payment not possible: ${selectedToken.symbol} on ${selectedToken.chainDisplayName} cannot be routed to merchant chains`);
      }
      
      console.log(`✅ Found route via ${routeResult.provider.name} to ${routeResult.route.destinationNetwork}`);
      
      // Create the bridge swap
      const swapResult = await BridgeManager.createSwap(routeResult.provider, routeResult.route, displayAmount);
      
      if (!swapResult) {
        throw new Error(`Failed to create cross-chain payment route via ${routeResult.provider.name}`);
      }
      
      console.log(`\n💱 CROSS-CHAIN PAYMENT via ${swapResult.bridgeName}:`);
      console.log(`🔄 Swap ID: ${swapResult.swapId}`);
      console.log(`📍 Send ${displayAmount} ${selectedToken.symbol} to: ${swapResult.depositAddress}`);
      console.log(`🎯 Merchant will receive on: ${routeResult.route.destinationNetwork}`);
      
      // For bridge payments, we send to the bridge deposit address
      const swapAmount = BigInt(Math.round(swapResult.depositAmount * Math.pow(10, selectedToken.decimals)));
      
      // Create custom EIP-681 URI for bridge payment
      let paymentUri: string;
      if (EthereumService.isEthAddress(selectedToken.address)) {
        // ETH payment
        paymentUri = `ethereum:${swapResult.depositAddress}@${selectedToken.chainId}?value=${swapAmount.toString()}`;
      } else {
        // ERC-20 token payment
        paymentUri = `ethereum:${selectedToken.address}@${selectedToken.chainId}/transfer?address=${swapResult.depositAddress}&uint256=${swapAmount.toString()}`;
      }
      
      console.log(`\n💳 Sending ${swapResult.bridgeName} payment request:`);
      console.log(`📄 URI: ${paymentUri}`);
      
      const nfcTransmissionStart = Date.now();
      
      // Create NDEF message with URI record for PN532
      const uriRecord = ndef.uriRecord(paymentUri);
      const ndefMessage = ndef.encodeMessage([uriRecord]);
      await pn532.writeNdefData(ndefMessage);
      
      const nfcTransmissionTime = Date.now() - nfcTransmissionStart;
      
      console.log(`⏱️ [PROFILE] PN532 payment request transmission completed in ${nfcTransmissionTime}ms`);
      console.log(`✅ ${swapResult.bridgeName} payment request sent`);
      console.log(`📱 Customer will pay to ${swapResult.bridgeName}, merchant receives on ${routeResult.route.destinationNetwork}`);
      
      const totalTime = Date.now() - startTime;
      console.log(`⏱️ [PROFILE] calculateAndSendPaymentPN532 (with bridge) completed in ${totalTime}ms`);
      
      // Return information needed for monitoring bridge payment
      return {
        selectedToken,
        requiredAmount: swapAmount,
        chainId: selectedToken.chainId,
        chainName: selectedToken.chainDisplayName,
        isLayerswap: swapResult.bridgeName === 'Layerswap', // For backward compatibility
        layerswapDepositAddress: swapResult.depositAddress,
        layerswapSwapId: swapResult.swapId
      };
    }
    
    // Normal payment flow (merchant supports the chain)
    console.log(`🔍 Payment will be monitored on: ${selectedToken.chainDisplayName}`);
    
    // Send payment request using the exact amount
    const nfcTransmissionStart = Date.now();
    await this.sendPaymentRequestPN532(pn532, requiredAmount, selectedToken.address, selectedToken.decimals, selectedToken.chainId);
    const nfcTransmissionTime = Date.now() - nfcTransmissionStart;
    console.log(`⏱️ [PROFILE] PN532 payment request transmission completed in ${nfcTransmissionTime}ms`);
    
    console.log(`✅ Payment request sent for exactly ${requiredAmount.toString()} smallest units`);
    console.log(`📱 Customer will be asked to pay ${displayAmount} ${selectedToken.symbol}`);
    
    const totalTime = Date.now() - startTime;
    console.log(`⏱️ [PROFILE] calculateAndSendPaymentPN532 completed in ${totalTime}ms`);
    
    // Return information needed for monitoring
    return {
      selectedToken,
      requiredAmount, // BigInt amount in smallest units
      chainId: selectedToken.chainId,
      chainName: selectedToken.chainDisplayName
    };
  }

  /**
   * Calculate payment options and send payment request
   */
  static async calculateAndSendPayment(tokensWithPrices: TokenWithPrice[], reader: Reader, targetUSD: number): Promise<PaymentResult> {
    const startTime = Date.now();
    console.log(`⏱️ [PROFILE] Starting calculateAndSendPayment for $${targetUSD} with ${tokensWithPrices.length} tokens`);
    
    // Filter tokens that have sufficient balance for targetUSD payment
    const viableTokens = tokensWithPrices.filter(token => 
      token.priceUSD > 0 && token.valueUSD >= targetUSD
    );

    if (viableTokens.length === 0) {
      console.log(`\n❌ No tokens found with sufficient balance for $${targetUSD} payment`);
      throw new Error(`Customer doesn't have enough funds`);
    }

    console.log(`\n💰 PAYMENT OPTIONS ($${targetUSD}):`);
    console.log(`🎯 Priority Order: L2 Stablecoin > L2 Other > L2 ETH > L1 Stablecoin > L1 Other > L1 ETH\n`);
    
    // Group by priority categories for better display
    const L1_CHAINS = [1]; // Ethereum mainnet
    const L2_CHAINS = [8453, 42161, 10, 137, 393402133025423]; // Base, Arbitrum, Optimism, Polygon, Starknet
    
    const isStablecoin = (token: TokenWithPrice): boolean => {
      return /^(USDC|USDT|DAI|BUSD|FRAX|LUSD|USDCE|USDC\.E|USDT\.E|DAI\.E)$/i.test(token.symbol);
    };
    
    const categorizeForDisplay = (tokens: TokenWithPrice[]) => {
      const categories = {
        'L2 Stablecoins (Priority 1)': [] as TokenWithPrice[],
        'L2 Other Tokens (Priority 2)': [] as TokenWithPrice[],
        'L2 ETH/Native (Priority 3)': [] as TokenWithPrice[],
        'L1 Stablecoins (Priority 4)': [] as TokenWithPrice[],
        'L1 Other Tokens (Priority 5)': [] as TokenWithPrice[],
        'L1 ETH (Priority 6)': [] as TokenWithPrice[]
      };
      
      tokens.forEach(token => {
        const isL2 = L2_CHAINS.includes(token.chainId);
        
        if (isL2) {
          if (isStablecoin(token)) {
            categories['L2 Stablecoins (Priority 1)'].push(token);
          } else if (token.isNativeToken) {
            categories['L2 ETH/Native (Priority 3)'].push(token);
          } else {
            categories['L2 Other Tokens (Priority 2)'].push(token);
          }
        } else {
          if (isStablecoin(token)) {
            categories['L1 Stablecoins (Priority 4)'].push(token);
          } else if (token.isNativeToken) {
            categories['L1 ETH (Priority 6)'].push(token);
          } else {
            categories['L1 Other Tokens (Priority 5)'].push(token);
          }
        }
      });
      
      return categories;
    };

    const tokensByPriority = categorizeForDisplay(viableTokens);
    
    let optionIndex = 1;
    Object.entries(tokensByPriority).forEach(([categoryName, tokens]) => {
      if (tokens.length > 0) {
        console.log(`\n🏆 ${categoryName}:`);
        tokens.forEach(token => {
          const requiredAmountFloat = targetUSD / token.priceUSD;
          console.log(`  ${optionIndex}. ${requiredAmountFloat.toFixed(6)} ${token.symbol} (${token.chainDisplayName})`);
          optionIndex++;
        });
      }
    });

    // Smart payment selection: prefer L2 stablecoins, then follow priority order
    const selectedToken = this.selectBestPaymentToken(viableTokens);
    const selectionTime = Date.now() - startTime;
    console.log(`⏱️ [PROFILE] Token selection and analysis completed in ${selectionTime}ms`);
    
    // Calculate exact amount in smallest units using BigInt arithmetic
    const targetUSDCents = Math.round(targetUSD * 1e8); // Convert to 8 decimal precision
    const priceUSDCents = Math.round(selectedToken.priceUSD * 1e8);
    const requiredAmount = (BigInt(targetUSDCents) * BigInt(10 ** selectedToken.decimals)) / BigInt(priceUSDCents);
    
    // Convert to display format
    const displayAmount = Number(requiredAmount) / Math.pow(10, selectedToken.decimals);
    
    console.log(`\n🎯 SELECTED PAYMENT:`);
    console.log(`💰 Merchant amount: $${targetUSD.toFixed(2)} USD`);
    console.log(`💳 Token: ${selectedToken.symbol}`);
    console.log(`🔢 Token amount: ${displayAmount} ${selectedToken.symbol}`);
    console.log(`📊 Exact amount: ${requiredAmount.toString()} smallest units`);
    console.log(`⛓️  Chain: ${selectedToken.chainDisplayName} (Chain ID: ${selectedToken.chainId})`);
    console.log(`💵 Price: $${selectedToken.priceUSD.toFixed(4)} per ${selectedToken.symbol}`);
    
    // Check if merchant supports this chain
    const isMerchantChain = BridgeManager.isMerchantSupportedChain(selectedToken.chainId);
    
    if (!isMerchantChain) {
      console.log(`\n🔄 Chain ${selectedToken.chainDisplayName} not supported by merchant, checking bridge routes...`);
      
      // Find a bridge route
      const routeResult = await BridgeManager.findBestRoute(selectedToken.chainId, selectedToken.symbol);
      
      if (!routeResult) {
        throw new Error(`Payment not possible: ${selectedToken.symbol} on ${selectedToken.chainDisplayName} cannot be routed to merchant chains`);
      }
      
      console.log(`✅ Found route via ${routeResult.provider.name} to ${routeResult.route.destinationNetwork}`);
      
      // Create the bridge swap
      const swapResult = await BridgeManager.createSwap(routeResult.provider, routeResult.route, displayAmount);
      
      if (!swapResult) {
        throw new Error(`Failed to create cross-chain payment route via ${routeResult.provider.name}`);
      }
      
      console.log(`\n💱 CROSS-CHAIN PAYMENT via ${swapResult.bridgeName}:`);
      console.log(`🔄 Swap ID: ${swapResult.swapId}`);
      console.log(`📍 Send ${displayAmount} ${selectedToken.symbol} to: ${swapResult.depositAddress}`);
      console.log(`🎯 Merchant will receive on: ${routeResult.route.destinationNetwork}`);
      
      // For bridge payments, we send to the bridge deposit address
      const swapAmount = BigInt(Math.round(swapResult.depositAmount * Math.pow(10, selectedToken.decimals)));
      
      // Create custom EIP-681 URI for bridge payment
      let paymentUri: string;
      if (EthereumService.isEthAddress(selectedToken.address)) {
        // ETH payment
        paymentUri = `ethereum:${swapResult.depositAddress}@${selectedToken.chainId}?value=${swapAmount.toString()}`;
      } else {
        // ERC-20 token payment
        paymentUri = `ethereum:${selectedToken.address}@${selectedToken.chainId}/transfer?address=${swapResult.depositAddress}&uint256=${swapAmount.toString()}`;
      }
      
      console.log(`\n💳 Sending ${swapResult.bridgeName} payment request:`);
      console.log(`📄 URI: ${paymentUri}`);
      
      const nfcTransmissionStart = Date.now();
      const ndefMessage = this.createNDEFUriRecord(paymentUri);
      // @ts-expect-error Argument of type '{}' is not assignable to parameter of type 'never'.
      await reader.transmit(ndefMessage, 256, {});
      const nfcTransmissionTime = Date.now() - nfcTransmissionStart;
      
      console.log(`⏱️ [PROFILE] NFC payment request transmission completed in ${nfcTransmissionTime}ms`);
      console.log(`✅ ${swapResult.bridgeName} payment request sent`);
      console.log(`📱 Customer will pay to ${swapResult.bridgeName}, merchant receives on ${routeResult.route.destinationNetwork}`);
      
      const totalTime = Date.now() - startTime;
      console.log(`⏱️ [PROFILE] calculateAndSendPayment (with bridge) completed in ${totalTime}ms`);
      
      // Return information needed for monitoring bridge payment
      return {
        selectedToken,
        requiredAmount: swapAmount,
        chainId: selectedToken.chainId,
        chainName: selectedToken.chainDisplayName,
        isLayerswap: swapResult.bridgeName === 'Layerswap', // For backward compatibility
        layerswapDepositAddress: swapResult.depositAddress,
        layerswapSwapId: swapResult.swapId
      };
    }
    
    // Normal payment flow (merchant supports the chain)
    console.log(`🔍 Payment will be monitored on: ${selectedToken.chainDisplayName}`);
    
    // Send payment request using the exact amount
    const nfcTransmissionStart = Date.now();
    await this.sendPaymentRequest(reader, requiredAmount, selectedToken.address, selectedToken.decimals, selectedToken.chainId);
    const nfcTransmissionTime = Date.now() - nfcTransmissionStart;
    console.log(`⏱️ [PROFILE] NFC payment request transmission completed in ${nfcTransmissionTime}ms`);
    
    console.log(`✅ Payment request sent for exactly ${requiredAmount.toString()} smallest units`);
    console.log(`📱 Customer will be asked to pay ${displayAmount} ${selectedToken.symbol}`);
    
    const totalTime = Date.now() - startTime;
    console.log(`⏱️ [PROFILE] calculateAndSendPayment completed in ${totalTime}ms`);
    
    // Return information needed for monitoring
    return {
      selectedToken,
      requiredAmount, // BigInt amount in smallest units
      chainId: selectedToken.chainId,
      chainName: selectedToken.chainDisplayName
    };
  }

  /**
   * Smart token selection for payments with L2-first priority
   * Priority order: L2 Stablecoin > L2 Other > L2 ETH > L1 Stablecoin > L1 Other > L1 ETH
   */
  private static selectBestPaymentToken(viableTokens: TokenWithPrice[]): TokenWithPrice {
    // Define L1 and L2 chains
    const L1_CHAINS = [1]; // Ethereum mainnet
    const L2_CHAINS = [8453, 42161, 10, 137, 393402133025423]; // Base, Arbitrum, Optimism, Polygon, Starknet
    
    // Helper function to check if token is a stablecoin
    const isStablecoin = (token: TokenWithPrice): boolean => {
      return /^(USDC|USDT|DAI|BUSD|FRAX|LUSD|USDCE|USDC\.E|USDT\.E|DAI\.E)$/i.test(token.symbol);
    };
    
    // Helper function to check if token is ETH (native token)
    const isETH = (token: TokenWithPrice): boolean => {
      return token.isNativeToken && token.symbol === 'ETH';
    };
    
    // Helper function to check if token is MATIC (Polygon native)
    const isMATIC = (token: TokenWithPrice): boolean => {
      return token.isNativeToken && token.symbol === 'MATIC';
    };
    
    // Helper function to check if token is "other" (not stablecoin, not native)
    const isOther = (token: TokenWithPrice): boolean => {
      return !isStablecoin(token) && !token.isNativeToken;
    };
    
    // Categorize tokens by chain type and token type
    const categorizeTokens = (tokens: TokenWithPrice[]) => {
      const categories = {
        l2Stablecoins: [] as TokenWithPrice[],
        l2Other: [] as TokenWithPrice[],
        l2ETH: [] as TokenWithPrice[],
        l2Native: [] as TokenWithPrice[], // For MATIC on Polygon
        l1Stablecoins: [] as TokenWithPrice[],
        l1Other: [] as TokenWithPrice[],
        l1ETH: [] as TokenWithPrice[]
      };
      
      tokens.forEach(token => {
        const isL2 = L2_CHAINS.includes(token.chainId);
        
        if (isL2) {
          if (isStablecoin(token)) {
            categories.l2Stablecoins.push(token);
          } else if (isETH(token)) {
            categories.l2ETH.push(token);
          } else if (isMATIC(token)) {
            categories.l2Native.push(token);
          } else if (isOther(token)) {
            categories.l2Other.push(token);
          }
        } else {
          // L1 tokens
          if (isStablecoin(token)) {
            categories.l1Stablecoins.push(token);
          } else if (isETH(token)) {
            categories.l1ETH.push(token);
          } else if (isOther(token)) {
            categories.l1Other.push(token);
          }
        }
      });
      
      return categories;
    };
    
    const categories = categorizeTokens(viableTokens);
    
    // Display selection summary
    console.log(`\n🧮 TOKEN SELECTION ANALYSIS:`);
    console.log(`   L2 Stablecoins: ${categories.l2Stablecoins.length} tokens`);
    console.log(`   L2 Other Tokens: ${categories.l2Other.length} tokens`);
    console.log(`   L2 ETH/Native: ${categories.l2ETH.length + categories.l2Native.length} tokens`);
    console.log(`   L1 Stablecoins: ${categories.l1Stablecoins.length} tokens`);
    console.log(`   L1 Other Tokens: ${categories.l1Other.length} tokens`);
    console.log(`   L1 ETH: ${categories.l1ETH.length} tokens`);
    
    // Sort each category by value (highest first) for best selection within each priority level
    const sortByValue = (a: TokenWithPrice, b: TokenWithPrice) => b.valueUSD - a.valueUSD;
    
    Object.values(categories).forEach(category => {
      category.sort(sortByValue);
    });
    
    // Priority selection logic
    if (categories.l2Stablecoins.length > 0) {
      const selected = categories.l2Stablecoins[0];
      console.log(`💡 Preferred payment: L2 Stablecoin - ${selected.symbol} on ${selected.chainDisplayName}`);
      return selected;
    }
    
    if (categories.l2Other.length > 0) {
      const selected = categories.l2Other[0];
      console.log(`💡 Preferred payment: L2 Other Token - ${selected.symbol} on ${selected.chainDisplayName}`);
      return selected;
    }
    
    if (categories.l2ETH.length > 0) {
      const selected = categories.l2ETH[0];
      console.log(`💡 Preferred payment: L2 ETH - ${selected.symbol} on ${selected.chainDisplayName}`);
      return selected;
    }
    
    if (categories.l2Native.length > 0) {
      const selected = categories.l2Native[0];
      console.log(`💡 Preferred payment: L2 Native Token - ${selected.symbol} on ${selected.chainDisplayName}`);
      return selected;
    }
    
    if (categories.l1Stablecoins.length > 0) {
      const selected = categories.l1Stablecoins[0];
      console.log(`💡 Preferred payment: L1 Stablecoin - ${selected.symbol} on ${selected.chainDisplayName}`);
      return selected;
    }
    
    if (categories.l1Other.length > 0) {
      const selected = categories.l1Other[0];
      console.log(`💡 Preferred payment: L1 Other Token - ${selected.symbol} on ${selected.chainDisplayName}`);
      return selected;
    }
    
    if (categories.l1ETH.length > 0) {
      const selected = categories.l1ETH[0];
      console.log(`💡 Preferred payment: L1 ETH - ${selected.symbol} on ${selected.chainDisplayName}`);
      return selected;
    }
    
    // Fallback (should not happen if viableTokens is not empty)
    console.log(`💡 Fallback: Using first available token - ${viableTokens[0].symbol}`);
    return viableTokens[0];
  }
} 