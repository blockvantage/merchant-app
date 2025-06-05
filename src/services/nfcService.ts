import { NFC, Reader } from 'nfc-pcsc';
import { AID, GET } from '../config/index.js';
import { CardData } from '../types/index.js';
import { EthereumService } from './ethereumService.js';
import { AddressProcessor } from './addressProcessor.js';
import { AlchemyService } from './alchemyService.js';
import { PaymentService } from './paymentService.js';
import { broadcast } from '../server.js';

/**
 * Service for handling NFC reader operations
 */
export class NFCService {
  private nfc: NFC;
  private paymentArmed: boolean = false;
  private currentPaymentAmount: number | null = null;
  private cardHandlerPromise: Promise<{ success: boolean; message: string; errorType?: string }> | null = null;
  private cardHandlerResolve: ((result: { success: boolean; message: string; errorType?: string }) => void) | null = null;

  constructor() {
    this.nfc = new NFC();
    this.setupNFC();
  }

  /**
   * Setup NFC readers and event handlers
   */
  private setupNFC(): void {
    this.nfc.on('reader', (reader: Reader) => {
      console.log('💳 NFC Reader Detected:', reader.name);
      reader.aid = AID; // ★ IMPORTANT ★ Set AID immediately
      console.log('🔑 AID set for reader:', AID);
      broadcast({ type: 'nfc_status', message: `Reader connected: ${reader.name}`});
      this.setupReaderEvents(reader);
    });
  }

  /**
   * Setup event handlers for a specific reader
   */
  private setupReaderEvents(reader: Reader): void {
    (reader as any).on('card', async (card: CardData) => {
      await this.handleCard(reader, card);
    });

    (reader as any).on('error', (err: Error) => {
      if (err.message.includes('Cannot process ISO 14443-4 tag')) {
        console.log('💳 Payment card detected - ignoring');
        broadcast({ type: 'nfc_status', message: 'Payment card detected - not supported' });
        return;
      }
      console.error('❌ Reader error:', err);
    });

    (reader as any).on('end', () => {
      console.log('🔌 Reader disconnected:', reader.name);
      broadcast({ type: 'nfc_status', message: `Reader disconnected: ${reader.name}` });
    });
  }

  /**
   * Handle card detection and processing
   */
  private async handleCard(reader: Reader, card: CardData): Promise<void> {
    console.log('📱 Card Detected:', {
      type: card.type,
      standard: card.standard
    });

    if (!this.paymentArmed || this.currentPaymentAmount === null) {
      console.log('💤 Reader not armed for payment, ignoring tap');
      broadcast({ type: 'nfc_status', message: 'Reader not armed for payment' });
      return;
    }

    try {
      // @ts-expect-error Argument of type '{}' is not assignable to parameter of type 'never'.
      const resp = await reader.transmit(GET, 256, {});
      const sw = resp.readUInt16BE(resp.length - 2);
      
      if (sw !== 0x9000) {
        throw new Error('Bad status ' + sw.toString(16));
      }

      const phoneResponse = resp.slice(0, -2).toString();
      console.log('📱 Phone says →', phoneResponse);
      
      await this.processPhoneResponse(phoneResponse, reader, this.currentPaymentAmount);
      
    } catch (e) {
      console.error('❌ Error processing card:', e);
      if (this.cardHandlerResolve) {
        this.cardHandlerResolve({ success: false, message: 'Error processing card', errorType: 'CARD_ERROR' });
        this.cardHandlerResolve = null;
      }
    } finally {
      reader.close(); // free the reader for the next tap
    }
  }

  /**
   * Process the response from the phone
   */
  private async processPhoneResponse(phoneResponse: string, reader: Reader, amount: number): Promise<void> {
    // Check if the response is an Ethereum address
    if (EthereumService.isEthereumAddress(phoneResponse)) {
      const ethAddress = EthereumService.normalizeEthereumAddress(phoneResponse);
      console.log(`✓ Detected Ethereum address: ${ethAddress}`);
      
      // Check if the address can be processed
      if (!AddressProcessor.canProcessAddress(ethAddress)) {
        if (this.cardHandlerResolve) {
          this.cardHandlerResolve({ success: false, message: 'Address is already being processed', errorType: 'DUPLICATE_ADDRESS' });
          this.cardHandlerResolve = null;
        }
        return;
      }
      
      // Mark the address as being processed
      AddressProcessor.startProcessing(ethAddress);
      
      try {
        // Fetch balances from Alchemy API across all supported chains
        const portfolio = await AlchemyService.fetchMultiChainBalances(ethAddress);
        
        // Calculate and send payment request using all tokens across all chains
        await PaymentService.calculateAndSendPayment(portfolio.allTokens, reader, amount);
        
        if (this.cardHandlerResolve) {
          this.cardHandlerResolve({ success: true, message: `Payment request for $${amount.toFixed(2)} sent to ${ethAddress}` });
          this.cardHandlerResolve = null;
        }
        
      } catch (balanceError: any) {
        console.error('💥 Error processing address balances/payment:', balanceError);
        if (this.cardHandlerResolve) {
          this.cardHandlerResolve({ success: false, message: 'Error processing payment', errorType: 'PAYMENT_ERROR' });
          this.cardHandlerResolve = null;
        }
      } finally {
        // Mark the address processing as complete (even if there was an error)
        AddressProcessor.finishProcessing(ethAddress);
      }
    } else {
      console.log('📱 Response is not an Ethereum address');
      if (this.cardHandlerResolve) {
        this.cardHandlerResolve({ success: false, message: 'Invalid Ethereum address', errorType: 'INVALID_ADDRESS' });
        this.cardHandlerResolve = null;
      }
    }
  }

  /**
   * Start the NFC service
   */
  public startListening(): void {
    console.log('🟢 NFCService: Starting to listen for readers...');
    console.log('📡 NFC Service is now listening for readers.');
  }

  /**
   * Arm the service for payment and wait for a card tap
   */
  public async armForPaymentAndAwaitTap(amount: number): Promise<{ success: boolean; message: string; errorType?: string }> {
    this.paymentArmed = true;
    this.currentPaymentAmount = amount;
    console.log(`💰 NFCService: Armed for payment of $${amount.toFixed(2)}. Waiting for tap...`);
    
    // Create a promise that will be resolved when a card is processed
    this.cardHandlerPromise = new Promise((resolve) => {
      this.cardHandlerResolve = resolve;
    });

    // Set a timeout for the payment (30 seconds)
    const timeoutId = setTimeout(() => {
      if (this.cardHandlerResolve) {
        this.cardHandlerResolve({ success: false, message: 'Payment timeout', errorType: 'TIMEOUT' });
        this.cardHandlerResolve = null;
      }
      this.disarmPayment();
    }, 30000);

    try {
      const result = await this.cardHandlerPromise;
      clearTimeout(timeoutId);
      this.disarmPayment();
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      this.disarmPayment();
      return { success: false, message: 'Payment processing error', errorType: 'PROCESSING_ERROR' };
    }
  }

  /**
   * Disarm the payment service
   */
  private disarmPayment(): void {
    this.paymentArmed = false;
    this.currentPaymentAmount = null;
    this.cardHandlerPromise = null;
    this.cardHandlerResolve = null;
  }

  /**
   * Stop the NFC service
   */
  public stopListening(): void {
    console.log('🔴 NFCService: Stopping listeners...');
    // Add any cleanup logic here if needed
  }
} 