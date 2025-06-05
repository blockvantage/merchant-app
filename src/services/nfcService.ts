import { NFC, Reader } from 'nfc-pcsc';
import { AID, GET } from '../config/index.js';
import { CardData } from '../types/index.js';
import { EthereumService } from './ethereumService.js';
import { AddressProcessor } from './addressProcessor.js';
import { AlchemyService } from './alchemyService.js';
import { PaymentService } from './paymentService.js';
import { broadcast } from '../server.js'; // Import broadcast function

/**
 * Service for handling NFC reader operations
 */
export class NFCService {
  private nfc: NFC;
  private isListening: boolean = false;
  private paymentArmed: boolean = false;
  private currentPaymentAmount: number | null = null;
  private activeReader: Reader | null = null;
  private cardHandlerPromise: { resolve: (value: { success: boolean; message: string; errorType?: string }) => void; reject: (reason?: any) => void; } | null = null;
  private connectedReaders: Set<string> = new Set();

  constructor() {
    this.nfc = new NFC();
    this.connectedReaders = new Set();
    this.currentPaymentAmount = null;
    this.paymentArmed = false;

    // Add error handler for NFC instance
    (this.nfc as any).on('error', (error: Error) => {
      if (error.message.includes('Cannot process ISO 14443-4 tag')) {
        console.log('💳 Payment card detected - ignoring');
        broadcast({ type: 'nfc_status', message: 'Payment card detected - not supported' });
        return;
      }
      console.error('❌ NFC error:', error);
    });
  }

  /**
   * Start listening for NFC reader events.
   */
  startListening(): void {
    console.log('🟢 NFCService: Starting to listen for readers...');
    
    try {
      // Check for any readers that were already connected
      this.checkForExistingReaders();
      
      // Listen for new readers being connected
      this.nfc.on('reader', (reader: Reader) => {
        try {
          this.handleNewReader(reader);
        } catch (error) {
          console.error('❌ Error handling new reader:', error);
        }
      });

      console.log('📡 NFC Service is now listening for readers.');
    } catch (error) {
      console.error('❌ Error starting NFC service:', error);
      // Don't throw, just log the error
    }
  }

  /**
   * Check for readers that are already connected
   */
  private checkForExistingReaders(): void {
    try {
      // Get list of existing readers - handle case where readers might not be available
      const readers = Array.isArray((this.nfc as any).readers) ? (this.nfc as any).readers : [];
      console.log(`🔍 Checking for existing readers... Found ${readers.length} reader(s)`);
      
      for (const reader of readers) {
        if (!this.connectedReaders.has(reader.name)) {
          console.log(`📱 Found existing reader: ${reader.name}`);
          this.handleNewReader(reader);
        }
      }
    } catch (error) {
      console.log('ℹ️ No existing readers found or error checking:', error);
    }
  }

  /**
   * Stop listening for NFC reader events and clean up.
   */
  stopListening(): void {
    if (!this.isListening) return;
    console.log('🔴 NFCService: Stopping listeners...');
    this.nfc.removeAllListeners('reader');
    if (this.activeReader) {
      this.activeReader.close();
      this.activeReader.removeAllListeners();
      this.activeReader = null;
    }
    this.connectedReaders.clear();
    this.isListening = false;
    this.paymentArmed = false;
    this.currentPaymentAmount = null;
  }

  /**
   * Arm the NFC service for a single payment tap with a specific amount.
   * @param amount The amount to charge in USD.
   * @returns A promise that resolves with the payment result.
   */
  armForPaymentAndAwaitTap(amount: number): Promise<{ success: boolean; message: string; errorType?: string }> {
    return new Promise((resolve, reject) => {
      if (!this.isListening) {
        console.error('NFCService is not listening. Cannot arm for payment.');
        broadcast({ type: 'status', message: 'NFC reader not active.', isError: true });
        return reject({ success: false, message: 'NFC reader not active', errorType: 'NFC_NOT_LISTENING' });
      }
      if (this.paymentArmed) {
        console.warn('NFCService is already armed for a payment.');
        broadcast({ type: 'status', message: 'Payment already in progress.', isError: true });
        return reject({ success: false, message: 'Payment already in progress', errorType: 'ALREADY_ARMED' });
      }

      console.log(`💰 NFCService: Armed for payment of $${amount.toFixed(2)}. Waiting for tap...`);
      this.currentPaymentAmount = amount;
      this.paymentArmed = true;
      this.cardHandlerPromise = { resolve, reject };
      broadcast({ type: 'status', message: `Tap phone now for $${amount.toFixed(2)}` });

      // No need to set up reader.on('card') here again if it's done in handleNewReader globally
      // and handleCard checks paymentArmed state.
    });
  }

  private handleNewReader(reader: Reader): void {
    // Check if we've already handled this reader
    if (this.connectedReaders.has(reader.name)) {
      console.log(`🔄 Reader ${reader.name} already connected, skipping...`);
      return;
    }

    console.log('💳 NFC Reader Detected:', reader.name);
    broadcast({ type: 'nfc_status', message: `Reader connected: ${reader.name}`});

    // Add to connected readers set
    this.connectedReaders.add(reader.name);

    if (this.activeReader && this.activeReader !== reader) {
        this.activeReader.close();
        this.activeReader.removeAllListeners();
    }
    this.activeReader = reader;

    // Override internal error handler to prevent crashes
    (reader as any).on('error', (error: Error) => {
      if (error.message.includes('Cannot process ISO 14443-4 tag')) {
        console.log('💳 Payment card detected - ignoring');
        broadcast({ type: 'nfc_status', message: 'Payment card detected - not supported' });
        return;
      }
      console.error('❌ Reader error:', error);
    });

    // Handle card presence
    (reader as any).on('card', async (card: any) => {
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
        await this.handleCardProcessing(card);
      } catch (error) {
        console.error('❌ Error processing card:', error);
        broadcast({ type: 'nfc_error', message: 'Error processing card' });
      }
    });

    // Handle card removal
    (reader as any).on('card.off', (card: any) => {
      console.log('💨 Card Removed');
      broadcast({ type: 'nfc_status', message: 'Card removed' });
    });

    (reader as any).on('end', () => {
      console.log('🔌 Reader disconnected:', reader.name);
      this.connectedReaders.delete(reader.name);
      broadcast({ type: 'nfc_status', message: `Reader disconnected: ${reader.name}` });
    });
  }

  private async handleCardProcessing(card: any): Promise<void> {
    if (!this.cardHandlerPromise) return; // Should not happen if paymentArmed is true

    const { resolve, reject } = this.cardHandlerPromise;

    try {
      // @ts-expect-error Argument of type '{}' is not assignable to parameter of type 'never'.
      const resp = await this.activeReader!.transmit(GET, 256, {});
      const sw = resp.readUInt16BE(resp.length - 2);
      
      if (sw !== 0x9000) {
        throw new Error(`Phone communication error (GET_STRING): Status ${sw.toString(16)}`);
      }

      const phoneResponse = resp.slice(0, -2).toString();
      console.log('🗣️ Phone says:', phoneResponse);
      broadcast({ type: 'status', message: `Received address: ${phoneResponse.substring(0,10)}...` });
      
      if (EthereumService.isEthereumAddress(phoneResponse)) {
        const ethAddress = EthereumService.normalizeEthereumAddress(phoneResponse);
        
        if (!AddressProcessor.canProcessAddress(ethAddress)) {
            resolve({ success: false, message: 'Address in cooldown or already processing.', errorType: 'ADDRESS_COOLDOWN' });
            this.resetPaymentState();
            return;
        }
        AddressProcessor.startProcessing(ethAddress);

        try {
          const portfolio = await AlchemyService.fetchMultiChainBalances(ethAddress);
          await PaymentService.calculateAndSendPayment(portfolio.allTokens, this.activeReader!, this.currentPaymentAmount!); // Pass the dynamic amount
          // The result of calculateAndSendPayment itself (if it returned a status) could be used here
          // For now, assuming success if it doesn't throw.
          resolve({ success: true, message: `Payment request for $${this.currentPaymentAmount!.toFixed(2)} sent to ${ethAddress}` });
        } catch (balanceError: any) {
          console.error('💥 Error processing address balances/payment:', balanceError);
          broadcast({ type: 'status', message: `Error: ${balanceError.message}`, isError: true });
          resolve({ success: false, message: `Error during payment processing: ${balanceError.message}`, errorType: 'PROCESSING_ERROR' });
        } finally {
          AddressProcessor.finishProcessing(ethAddress);
        }
      } else {
        console.log('Response is not an Ethereum address');
        broadcast({ type: 'status', message: 'Invalid address from phone.', isError: true });
        resolve({ success: false, message: 'Invalid address received from phone', errorType: 'INVALID_ADDRESS' });
      }
    } catch (e: any) {
      console.error('💥 NFC Card Processing Error:', e);
      const errorType = e.message?.includes('transmit') || e.message?.includes('Status') ? 'PHONE_MOVED_TOO_QUICKLY' : 'NFC_CARD_ERROR';
      broadcast({ type: 'status', message: `NFC Error: ${e.message}`, isError: true });
      resolve({ success: false, message: `NFC card error: ${e.message}`, errorType });
    } finally {
      // reader.close(); // Let server.ts manage reader lifecycle or keep it open for next potential tap if error was retryable
      // For single tap operation, ensure we disarm.
      this.resetPaymentState();
    }
  }

  private resetPaymentState(): void {
    this.paymentArmed = false;
    this.currentPaymentAmount = null;
    this.cardHandlerPromise = null;
    console.log('🏁 NFCService: Payment state reset. Ready for new amount.');
    broadcast({ type: 'status', message: 'Ready for new amount.'}); // Update UI
  }
} 