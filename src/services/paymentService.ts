import { Reader } from 'nfc-pcsc';
import { PAYMENT, RECIPIENT_ADDRESS, TARGET_USD } from '../config/index.js';
import { TokenWithPrice } from '../types/index.js';
import { EthereumService } from './ethereumService.js';

/**
 * Service for handling payment requests and EIP-681 URI generation
 */
export class PaymentService {
  /**
   * Generate EIP-681 format URI for payment request
   */
  static generateEIP681Uri(amount: number, tokenAddress: string, decimals: number): string {
    const amountInSmallestUnits = Math.floor(amount * Math.pow(10, decimals));
    
    if (EthereumService.isEthAddress(tokenAddress)) {
      // ETH payment request
      return `ethereum:${RECIPIENT_ADDRESS}?value=${amountInSmallestUnits}`;
    } else {
      // ERC-20 token payment request
      return `ethereum:${tokenAddress}/transfer?address=${RECIPIENT_ADDRESS}&uint256=${amountInSmallestUnits}`;
    }
  }

  /**
   * Send payment request via NFC
   */
  static async sendPaymentRequest(reader: Reader, amountString: string, tokenAddress: string, decimals: number = 18): Promise<void> {
    try {
      // Convert amount to appropriate units for EIP-681
      const amount = parseFloat(amountString);
      const eip681Uri = this.generateEIP681Uri(amount, tokenAddress, decimals);
      
      console.log(`\n💳 Sending EIP-681 payment request: ${eip681Uri}`);
      
      // Convert the EIP-681 URI to buffer
      const requestBuffer = Buffer.from(eip681Uri, 'utf8');
      
      // Create the complete APDU: PAYMENT command + data
      const completeApdu = Buffer.concat([
        PAYMENT, // Command (80CF0000)
        requestBuffer // The actual payment request data
      ]);
      
      console.log(`📡 Sending APDU: ${completeApdu}`);
      
      // Send the complete APDU with the payment request data
      // @ts-expect-error Argument of type '{}' is not assignable to parameter of type 'never'.
      const response = await reader.transmit(completeApdu, Math.max(256, requestBuffer.length + 10), {});
      const sw = response.readUInt16BE(response.length - 2);
      
      if (sw === 0x9000) {
        console.log('✅ Payment request sent successfully!');
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
    
    viableTokens.forEach((token, index) => {
      const requiredAmount = TARGET_USD / token.priceUSD;
      console.log(`${index + 1}. ${requiredAmount.toFixed(6)} ${token.symbol} (${token.name})`);
    });

    // For demo, automatically select the first viable token
    // In a real app, you might want user selection or some logic to pick the best option
    const selectedToken = viableTokens[0];
    const requiredAmount = TARGET_USD / selectedToken.priceUSD;
    
    console.log(`\n🎯 Selected: ${requiredAmount.toFixed(6)} ${selectedToken.symbol}`);
    
    // Send payment request with proper decimals
    await this.sendPaymentRequest(reader, requiredAmount.toFixed(6), selectedToken.address, selectedToken.decimals);
  }
} 