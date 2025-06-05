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

// Create and start the application
const app = new App();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Received SIGINT, shutting down gracefully...');
  app.stopServices();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Received SIGTERM, shutting down gracefully...');
  app.stopServices();
  process.exit(0);
});
      
// Start the app
app.initializeServices().catch(error => {
  console.error('❌ Failed to start application:', error);
  process.exit(1);
}); 