import { NFCService } from './services/nfcService.js';
import { PriceCacheService } from './services/priceCacheService.js';

/**
 * Main application orchestrator
 */
export class App {
  private nfcService: NFCService;

  constructor() {
    // Initialize services that don't depend on dynamic data from server
    this.nfcService = new NFCService(); 
}

  /**
   * Initialize core services like price caching and start NFC listeners.
   */
  async initializeServices(): Promise<void> {
    console.log('🚀 Initializing App Services...');
    await PriceCacheService.initialize();
    this.nfcService.startListening(); // Renamed from start() for clarity
  }

  /**
   * Process a payment request for a given amount.
   * This will arm the NFC service to expect a tap.
   * @param amount The amount to charge in USD.
   * @returns Promise resolving with payment result.
   */
  async processPayment(amount: number): Promise<{ success: boolean; message: string; errorType?: string; paymentInfo?: any }> {
    if (!this.nfcService) {
        console.error('NFC Service not initialized in App!');
        return { success: false, message: 'NFC Service not ready', errorType: 'NFC_SERVICE_ERROR' };
        }
    console.log(`App: Processing payment for $${amount}`);
    return this.nfcService.armForPaymentAndAwaitTap(amount);
  }

  /**
   * Scan an NFC device to get wallet address for transaction history filtering.
   * @returns Promise resolving with scan result containing wallet address.
   */
  async scanWalletAddress(): Promise<{ success: boolean; message: string; address?: string; errorType?: string }> {
    if (!this.nfcService) {
        console.error('NFC Service not initialized in App!');
        return { success: false, message: 'NFC Service not ready', errorType: 'NFC_SERVICE_ERROR' };
    }
    console.log('App: Starting wallet address scan');
    return this.nfcService.scanForWalletAddress();
  }

  /**
   * Cancel any ongoing NFC operations (payment or wallet scan).
   */
  cancelCurrentOperation(): void {
    if (!this.nfcService) {
        console.error('NFC Service not initialized in App!');
        return;
    }
    console.log('App: Cancelling current NFC operation');
    this.nfcService.cancelCurrentOperation();
  }

  /**
   * Stop core services gracefully.
   */
  stopServices(): void {
    console.log('🛑 Stopping App Services...');
    PriceCacheService.stop();
    if (this.nfcService) {
        this.nfcService.stopListening(); // NFCService would need this method
    }
  }
} 