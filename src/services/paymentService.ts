import { Reader } from 'nfc-pcsc';
import { PAYMENT, RECIPIENT_ADDRESS, TARGET_USD, SUPPORTED_CHAINS } from '../config/index.js';
import { TokenWithPrice } from '../types/index.js';
import { EthereumService } from './ethereumService.js';

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
  static generateEIP681Uri(amount: number, tokenAddress: string, decimals: number, chainId: number): string {
    const amountInSmallestUnits = Math.floor(amount * Math.pow(10, decimals));
    
    if (EthereumService.isEthAddress(tokenAddress)) {
      // ETH payment request with chain ID
      // Format: ethereum:<recipient>@<chainId>?value=<amount>
      return `ethereum:${RECIPIENT_ADDRESS}@${chainId}?value=${amountInSmallestUnits}`;
    } else {
      // ERC-20 token payment request with chain ID
      // Format: ethereum:<tokenAddress>@<chainId>/transfer?address=<recipient>&uint256=<amount>
      return `ethereum:${tokenAddress}@${chainId}/transfer?address=${RECIPIENT_ADDRESS}&uint256=${amountInSmallestUnits}`;
    }
  }

  /**
   * Create NDEF URI record for the EIP-681 payment request
   * This formats the URI so Android will automatically open it with wallet apps
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
  static async sendPaymentRequest(reader: Reader, amountString: string, tokenAddress: string, decimals: number = 18, chainId: number = 1): Promise<void> {
    try {
      // Convert amount to appropriate units for EIP-681
      const amount = parseFloat(amountString);
      const eip681Uri = this.generateEIP681Uri(amount, tokenAddress, decimals, chainId);
      
      const chainName = this.getChainName(chainId);
      console.log(`\n💳 Sending EIP-681 payment request for ${chainName} (Chain ID: ${chainId}):`);
      console.log(`📄 URI: ${eip681Uri}`);
      
      // Create NDEF URI record instead of raw string
      const ndefMessage = this.createNDEFUriRecord(eip681Uri);
      
      console.log(`📡 NDEF Message (${ndefMessage.length} bytes): ${ndefMessage.toString('hex')}`);
      
      // Create the complete APDU: PAYMENT command + NDEF data (no explicit length)
      const completeApdu = Buffer.concat([
        PAYMENT.slice(0, 4), // Command (80CF0000) 
        ndefMessage          // NDEF formatted payment request
      ]);
      
      console.log(`📡 Sending APDU with NDEF: ${completeApdu.toString('hex')}`);
      console.log(`📡 APDU breakdown: Command=${PAYMENT.slice(0,4).toString('hex')} Data=${ndefMessage.toString('hex')}`);
      
      // Send the complete APDU with the NDEF payment request
      // @ts-expect-error Argument of type '{}' is not assignable to parameter of type 'never'.
      const response = await reader.transmit(completeApdu, Math.max(256, ndefMessage.length + 10), {});
      const sw = response.readUInt16BE(response.length - 2);
      
      if (sw === 0x9000) {
        console.log(`✅ NDEF payment request sent successfully for ${chainName}!`);
        console.log('📱 Wallet app should now open with transaction details...');
        const phoneResponse = response.slice(0, -2).toString();
        if (phoneResponse) {
          console.log(`📱 Phone response: ${phoneResponse}`);
        }
      } else {
        console.log(`❌ Payment request failed with status: ${sw.toString(16)}`);
      }
    } catch (error) {
      console.error('Error sending payment request:', error);
    }
  }

  /**
   * Calculate payment options and send payment request
   */
  static async calculateAndSendPayment(tokensWithPrices: TokenWithPrice[], reader: Reader): Promise<void> {
    // Filter tokens that have sufficient balance for TARGET_USD payment
    const viableTokens = tokensWithPrices.filter(token => 
      token.priceUSD > 0 && token.valueUSD >= TARGET_USD
    );

    if (viableTokens.length === 0) {
      console.log(`\n❌ No tokens found with sufficient balance for $${TARGET_USD} payment`);
      return;
    }

    console.log(`\n💰 PAYMENT OPTIONS ($${TARGET_USD}):`);
    
    // Group by chain for better display
    const tokensByChain = viableTokens.reduce((acc, token) => {
      if (!acc[token.chainDisplayName]) {
        acc[token.chainDisplayName] = [];
      }
      acc[token.chainDisplayName].push(token);
      return acc;
    }, {} as {[chainName: string]: TokenWithPrice[]});

    let optionIndex = 1;
    Object.entries(tokensByChain).forEach(([chainName, tokens]) => {
      console.log(`\n⛓️  ${chainName}:`);
      tokens.forEach(token => {
        const requiredAmount = TARGET_USD / token.priceUSD;
        console.log(`  ${optionIndex}. ${requiredAmount.toFixed(6)} ${token.symbol}`);
        optionIndex++;
      });
    });

    // Smart payment selection: prefer stablecoins, then native tokens, then others
    const selectedToken = this.selectBestPaymentToken(viableTokens);
    const requiredAmount = TARGET_USD / selectedToken.priceUSD;
    
    console.log(`\n🎯 Selected: ${requiredAmount.toFixed(6)} ${selectedToken.symbol} (${selectedToken.chainDisplayName})`);
    
    // Send payment request with proper decimals and chain ID using NDEF formatting
    await this.sendPaymentRequest(reader, requiredAmount.toFixed(6), selectedToken.address, selectedToken.decimals, selectedToken.chainId);
  }

  /**
   * Smart token selection for payments
   */
  private static selectBestPaymentToken(viableTokens: TokenWithPrice[]): TokenWithPrice {
    // Priority order:
    // 1. Stablecoins (USDC, USDT, DAI, etc.)
    // 2. Native tokens (ETH)
    // 3. Major tokens (WETH, WBTC, etc.)
    // 4. Others by value descending

    const stablecoins = viableTokens.filter(token => 
      /^(USDC|USDT|DAI|BUSD|FRAX|LUSD)$/i.test(token.symbol)
    );

    const nativeTokens = viableTokens.filter(token => 
      token.isNativeToken
    );

    const majorTokens = viableTokens.filter(token => 
      /^(WETH|WBTC|UNI|LINK|AAVE|CRV|COMP)$/i.test(token.symbol) && !token.isNativeToken
    );

    const otherTokens = viableTokens.filter(token => 
      !stablecoins.includes(token) && 
      !nativeTokens.includes(token) && 
      !majorTokens.includes(token)
    );

    // Sort each category by value (highest first)
    const sortByValue = (a: TokenWithPrice, b: TokenWithPrice) => b.valueUSD - a.valueUSD;
    
    stablecoins.sort(sortByValue);
    nativeTokens.sort(sortByValue);
    majorTokens.sort(sortByValue);
    otherTokens.sort(sortByValue);

    // Return the best option available
    if (stablecoins.length > 0) {
      console.log(`💡 Preferred stablecoin payment: ${stablecoins[0].symbol}`);
      return stablecoins[0];
    }
    
    if (nativeTokens.length > 0) {
      console.log(`💡 Preferred native token payment: ${nativeTokens[0].symbol}`);
      return nativeTokens[0];
    }
    
    if (majorTokens.length > 0) {
      console.log(`💡 Preferred major token payment: ${majorTokens[0].symbol}`);
      return majorTokens[0];
    }
    
    console.log(`💡 Using best available token: ${otherTokens[0].symbol}`);
    return otherTokens[0];
  }
} 