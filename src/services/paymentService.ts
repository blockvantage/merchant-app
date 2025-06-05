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
  static async sendPaymentRequest(reader: Reader, amountString: string, tokenAddress: string, decimals: number = 18): Promise<void> {
    try {
      // Convert amount to appropriate units for EIP-681
      const amount = parseFloat(amountString);
      const eip681Uri = this.generateEIP681Uri(amount, tokenAddress, decimals);
      
      console.log(`\n💳 Sending EIP-681 payment request: ${eip681Uri}`);
      
      // Create NDEF URI record instead of raw string
      const ndefMessage = this.createNDEFUriRecord(eip681Uri);
      
      console.log(`📡 NDEF Message (${ndefMessage.length} bytes): ${ndefMessage.toString('hex')}`);
      
      // Create proper APDU structure: CLA INS P1 P2 LC DATA
      // PAYMENT command (80CF0000) + length + NDEF data
      const dataLength = ndefMessage.length;
      let lengthBytes: Buffer;
      
      if (dataLength <= 255) {
        // Short form: single byte length
        lengthBytes = Buffer.from([dataLength]);
      } else {
        // Extended form: 00 + 2-byte length (big endian)
        lengthBytes = Buffer.concat([
          Buffer.from([0x00]), // Extended length indicator
          Buffer.from([(dataLength >> 8) & 0xFF, dataLength & 0xFF]) // 2-byte length
        ]);
      }
      
      const completeApdu = Buffer.concat([
        PAYMENT, // Command (80CF0000) 
        ndefMessage          // NDEF formatted payment request
      ]);
      
      console.log(`📡 Sending APDU with NDEF: ${completeApdu.toString('hex')}`);
      console.log(`📡 APDU breakdown: Command=${PAYMENT.slice(0,4).toString('hex')} Length=${lengthBytes.toString('hex')} Data=${ndefMessage.toString('hex')}`);
      
      // Send the complete APDU with the NDEF payment request
      // @ts-expect-error Argument of type '{}' is not assignable to parameter of type 'never'.
      const response = await reader.transmit(completeApdu, Math.max(256, ndefMessage.length + 10), {});
      const sw = response.readUInt16BE(response.length - 2);
      
      if (sw === 0x9000) {
        console.log('✅ NDEF payment request sent successfully!');
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
    
    viableTokens.forEach((token, index) => {
      const requiredAmount = TARGET_USD / token.priceUSD;
      console.log(`${index + 1}. ${requiredAmount.toFixed(6)} ${token.symbol} (${token.name})`);
    });

    // For demo, automatically select the first viable token
    // In a real app, you might want user selection or some logic to pick the best option
    const selectedToken = viableTokens[0];
    const requiredAmount = TARGET_USD / selectedToken.priceUSD;
    
    console.log(`\n🎯 Selected: ${requiredAmount.toFixed(6)} ${selectedToken.symbol}`);
    
    // Send payment request with proper decimals using NDEF formatting
    await this.sendPaymentRequest(reader, requiredAmount.toFixed(6), selectedToken.address, selectedToken.decimals);
  }
} 