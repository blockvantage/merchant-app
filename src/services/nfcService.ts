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

  constructor() {
    this.nfc = new NFC();
  }

  /**
   * Start listening for NFC reader events.
   */
  startListening(): void {
    if (this.isListening) {
      console.log('NFCService is already listening.');
      return;
    }
    console.log('🟢 NFCService: Starting to listen for readers...');
    this.nfc.on('reader', this.handleNewReader.bind(this));
    this.isListening = true;
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
    console.log('💳 NFC Reader Detected:', reader.name);
    broadcast({ type: 'nfc_status', message: `Reader connected: ${reader.name}`});

    if (this.activeReader && this.activeReader !== reader) {
        this.activeReader.close();
        this.activeReader.removeAllListeners();
    }
    this.activeReader = reader;

    reader.aid = AID; // ★ IMPORTANT ★ SELECT App ID

    reader.on('card', async (card: CardData) => {
      if (!this.paymentArmed || this.currentPaymentAmount === null) {
        console.log('NFC Card detected, but payment not armed. Ignoring.');
        // Optionally, provide feedback to UI that tap was ignored
        // broadcast({ type: 'status', message: 'Tap ignored. Payment not active.', isError: true });
        return;
      }
      console.log('📱 Card Detected! Processing payment...');
      broadcast({ type: 'status', message: 'Card detected! Processing...' });
      await this.handleCardProcessing(reader, card, this.currentPaymentAmount);
    });

    reader.on('error', err => {
      console.error('💥 NFC Reader Error:', err);
      broadcast({ type: 'nfc_status', message: `Reader error: ${err.message}`, isError: true });
      if (this.paymentArmed && this.cardHandlerPromise) {
        this.cardHandlerPromise.reject({ success: false, message: `Reader error: ${err.message}`, errorType: 'NFC_READER_ERROR' });
        this.resetPaymentState();
      }
    });

    reader.on('end', () => {
      console.log('🔌 NFC Reader Disconnected:', reader.name);
      broadcast({ type: 'nfc_status', message: `Reader disconnected: ${reader.name}`});
      if (this.activeReader === reader) {
          this.activeReader = null;
      }
      // If a payment was armed and the reader disconnects before tap, we might want to reset or notify.
      // This logic can be complex depending on desired UX.
    });
  }

  private async handleCardProcessing(reader: Reader, card: CardData, amount: number): Promise<void> {
    if (!this.cardHandlerPromise) return; // Should not happen if paymentArmed is true

    const { resolve, reject } = this.cardHandlerPromise;

    try {
      // @ts-expect-error Argument of type '{}' is not assignable to parameter of type 'never'.
      const resp = await reader.transmit(GET, 256, {});
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
          await PaymentService.calculateAndSendPayment(portfolio.allTokens, reader, amount); // Pass the dynamic amount
          // The result of calculateAndSendPayment itself (if it returned a status) could be used here
          // For now, assuming success if it doesn't throw.
          resolve({ success: true, message: `Payment request for $${amount.toFixed(2)} sent to ${ethAddress}` });
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