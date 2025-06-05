import { NFCService } from './services/nfcService.js';
import { PriceCacheService } from './services/priceCacheService.js';

/**
 * Main application entry point
 */
class App {
  private nfcService: NFCService;

  constructor() {
    this.nfcService = new NFCService();
  }

  /**
   * Start the application
   */
  async start(): Promise<void> {
    console.log('🚀 Starting NFC Wallet Reader...');
    
    // Initialize price cache service first
    await PriceCacheService.initialize();
    
    // Start NFC service
    this.nfcService.start();
  }

  /**
   * Stop the application gracefully
   */
  stop(): void {
    console.log('🛑 Stopping NFC Wallet Reader...');
    PriceCacheService.stop();
  }
}

// Create and start the application
const app = new App();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\n👋 Received SIGINT, shutting down gracefully...');
  app.stop();
  process.exit(0);
});

process.on('SIGTERM', () => {
  console.log('\n👋 Received SIGTERM, shutting down gracefully...');
  app.stop();
  process.exit(0);
});

// Start the app
app.start().catch(error => {
  console.error('❌ Failed to start application:', error);
  process.exit(1);
}); 