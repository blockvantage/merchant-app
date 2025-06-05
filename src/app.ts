import { NFCService } from './services/nfcService.js';

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
  start(): void {
    this.nfcService.start();
  }
}

// Create and start the application
const app = new App();
app.start(); 