import { NFC, Reader } from 'nfc-pcsc';
import { AID, GET } from '../config/index.js';
import { CardData } from '../types/index.js';
import { EthereumService } from './ethereumService.js';
import { AddressProcessor } from './addressProcessor.js';
import { AlchemyService } from './alchemyService.js';
import { PaymentService } from './paymentService.js';

/**
 * Service for handling NFC reader operations
 */
export class NFCService {
  private nfc: NFC;

  constructor() {
    this.nfc = new NFC();
    this.setupNFC();
  }

  /**
   * Setup NFC readers and event handlers
   */
  private setupNFC(): void {
    this.nfc.on('reader', (reader: Reader) => {
      console.log('Reader →', reader.name);
      reader.aid = AID; // ★ IMPORTANT ★
      this.setupReaderEvents(reader);
    });
  }

  /**
   * Setup event handlers for a specific reader
   */
  private setupReaderEvents(reader: Reader): void {
    // @ts-ignore TS7006: Parameter 'card' implicitly has an 'any' type
    reader.on('card', async (card: CardData) => {
      await this.handleCard(reader, card);
    });

    reader.on('error', err => console.error('reader err', err));
  }

  /**
   * Handle card detection and processing
   */
  private async handleCard(reader: Reader, card: CardData): Promise<void> {
    try {
      // @ts-expect-error Argument of type '{}' is not assignable to parameter of type 'never'.
      const resp = await reader.transmit(GET, 256, {});
      const sw = resp.readUInt16BE(resp.length - 2);
      
      if (sw !== 0x9000) {
        throw new Error('Bad status ' + sw.toString(16));
      }

      const phoneResponse = resp.slice(0, -2).toString();
      console.log('Phone says →', phoneResponse);
      
      await this.processPhoneResponse(phoneResponse, reader);
      
    } catch (e) {
      console.error('reader err', e);
    } finally {
      reader.close(); // free the reader for the next tap
    }
  }

  /**
   * Process the response from the phone
   */
  private async processPhoneResponse(phoneResponse: string, reader: Reader): Promise<void> {
    // Check if the response is an Ethereum address
    if (EthereumService.isEthereumAddress(phoneResponse)) {
      const ethAddress = EthereumService.normalizeEthereumAddress(phoneResponse);
      console.log(`✓ Detected Ethereum address: ${ethAddress}`);
      
      // Check if the address can be processed
      if (!AddressProcessor.canProcessAddress(ethAddress)) {
        return;
      }
      
      // Mark the address as being processed
      AddressProcessor.startProcessing(ethAddress);
      
      try {
        // Fetch balances from Alchemy API across all supported chains
        const portfolio = await AlchemyService.fetchMultiChainBalances(ethAddress);
        
        // Calculate and send payment request using all tokens across all chains
        await PaymentService.calculateAndSendPayment(portfolio.allTokens, reader);
        
      } catch (balanceError) {
        console.error('Error processing address:', balanceError);
      } finally {
        // Mark the address processing as complete (even if there was an error)
        AddressProcessor.finishProcessing(ethAddress);
      }
    } else {
      console.log('Response is not an Ethereum address');
    }
  }

  /**
   * Start the NFC service
   */
  start(): void {
    console.log('📱 Waiting for NFC card tap...\n');
  }
} 