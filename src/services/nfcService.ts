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
  private walletScanArmed: boolean = false;
  private currentPaymentAmount: number | null = null;
  private cardHandlerPromise: Promise<{ success: boolean; message: string; errorType?: string; paymentInfo?: any }> | null = null;
  private cardHandlerResolve: ((result: { success: boolean; message: string; errorType?: string; paymentInfo?: any }) => void) | null = null;
  private walletScanPromise: Promise<{ success: boolean; message: string; address?: string; errorType?: string }> | null = null;
  private walletScanResolve: ((result: { success: boolean; message: string; address?: string; errorType?: string }) => void) | null = null;

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
        console.log('💳 Payment card detected - ignoring tap');
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

    if (!this.paymentArmed && !this.walletScanArmed) {
      console.log('💤 Reader not armed for payment or wallet scan, ignoring tap');
      broadcast({ type: 'nfc_status', message: 'Reader not armed' });
      return;
    }

    let processedAddress: string | null = null;

    try {
      // @ts-expect-error Argument of type '{}' is not assignable to parameter of type 'never'.
      const resp = await reader.transmit(GET, 256, {});
      const sw = resp.readUInt16BE(resp.length - 2);
      
      if (sw !== 0x9000) {
        throw new Error('Bad status ' + sw.toString(16));
      }

      const phoneResponse = resp.slice(0, -2).toString();
      console.log('📱 Phone says →', phoneResponse);
      
      // Check if this is an Ethereum address so we can track it for cleanup
      if (EthereumService.isEthereumAddress(phoneResponse)) {
        processedAddress = EthereumService.normalizeEthereumAddress(phoneResponse);
      }
      
      if (this.walletScanArmed) {
        await this.processWalletScan(phoneResponse, reader);
      } else if (this.paymentArmed && this.currentPaymentAmount !== null) {
        await this.processPhoneResponse(phoneResponse, reader, this.currentPaymentAmount);
      }
      
    } catch (e) {
      console.error('❌ Error processing card:', e);
      
      // Clean up any address that might be stuck in processing state
      if (processedAddress) {
        AddressProcessor.finishProcessing(processedAddress);
      }
      
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
        const blockReason = AddressProcessor.getProcessingBlockReason(ethAddress);
        console.log(`🚫 Address ${ethAddress} cannot be processed: ${blockReason}`);
        if (this.cardHandlerResolve) {
          this.cardHandlerResolve({ success: false, message: blockReason || 'Address cannot be processed', errorType: 'DUPLICATE_ADDRESS' });
          this.cardHandlerResolve = null;
        }
        return;
      }
      
      // Mark the address as being processed
      console.log(`🔄 Starting to process address: ${ethAddress}`);
      AddressProcessor.startProcessing(ethAddress);
      
      let paymentSuccessful = false;
      
      try {
        // Fetch balances from Alchemy API across all supported chains
        const portfolio = await AlchemyService.fetchMultiChainBalances(ethAddress);
        
        // Calculate and send payment request using all tokens across all chains
        const paymentInfo = await PaymentService.calculateAndSendPayment(portfolio.allTokens, reader, amount);
        
        // Update UI to show waiting for payment
        broadcast({ type: 'status', message: 'Waiting for payment...' });
        
        paymentSuccessful = true; // Payment request was sent successfully
        
        if (this.cardHandlerResolve) {
          this.cardHandlerResolve({ 
            success: true, 
            message: `Payment request for $${amount.toFixed(2)} sent to ${ethAddress}`,
            paymentInfo
          });
          this.cardHandlerResolve = null;
        }
        
      } catch (balanceError: any) {
        console.error('💥 Error processing address balances/payment:', balanceError);
        console.log(`🧹 Cleaning up address ${ethAddress} due to error: ${balanceError.message}`);
        
        if (balanceError.message === 'PHONE_MOVED_TOO_QUICKLY') {
          // For phone moved too quickly, just broadcast the error but keep waiting for another tap
          console.log('📱💨 Phone moved too quickly - broadcasting error but staying armed for retry');
          broadcast({ 
            type: 'payment_failure', 
            message: 'Phone moved too quickly', 
            errorType: 'PHONE_MOVED_TOO_QUICKLY' 
          });
          
          // Don't resolve the promise - keep waiting for another tap
          // Just clean up the current address processing
          AddressProcessor.finishProcessingWithoutCooldown(ethAddress);
          return; // Exit without resolving the promise
        }
        
        paymentSuccessful = false;
        
        if (this.cardHandlerResolve) {
          // Check for specific error types and handle them appropriately
          let errorMessage: string;
          let errorType: string;
          
          if (balanceError.message === "Customer doesn't have enough funds") {
            errorMessage = balanceError.message;
            errorType = 'PAYMENT_ERROR';
          } else {
            errorMessage = 'Error processing payment';
            errorType = 'PAYMENT_ERROR';
          }
          
          this.cardHandlerResolve({ success: false, message: errorMessage, errorType: errorType });
          this.cardHandlerResolve = null;
        }
      } finally {
        // Mark the address processing as complete
        console.log(`🏁 Finishing processing for address: ${ethAddress} (successful: ${paymentSuccessful})`);
        
        if (paymentSuccessful) {
          // Successful payment - apply cooldown to prevent spam
          AddressProcessor.finishProcessing(ethAddress);
        } else {
          // Failed payment - no cooldown, allow immediate retry
          AddressProcessor.finishProcessingWithoutCooldown(ethAddress);
        }
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
  public async armForPaymentAndAwaitTap(amount: number): Promise<{ success: boolean; message: string; errorType?: string; paymentInfo?: any }> {
    this.paymentArmed = true;
    this.currentPaymentAmount = amount;
    console.log(`💰 NFCService: Armed for payment of $${amount.toFixed(2)}. Waiting for tap...`);
    
    // Debug: Show current address processing state
    AddressProcessor.debugState();
    
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
    
    // Clean up any stuck address processing states when disarming
    // This is a safety measure to ensure addresses don't stay locked
    console.log('🧹 Cleaning up any stuck address processing states...');
    AddressProcessor.clearAllProcessing();
  }

  /**
   * Process wallet address scan response
   */
  private async processWalletScan(phoneResponse: string, reader: Reader): Promise<void> {
    // Check if the response is an Ethereum address
    if (EthereumService.isEthereumAddress(phoneResponse)) {
      const ethAddress = EthereumService.normalizeEthereumAddress(phoneResponse);
      console.log(`✓ Wallet address scanned: ${ethAddress}`);
      
      if (this.walletScanResolve) {
        this.walletScanResolve({ 
          success: true, 
          message: `Wallet scanned successfully`,
          address: ethAddress
        });
        this.walletScanResolve = null;
      }
    } else {
      console.log('📱 Response is not an Ethereum address');
      if (this.walletScanResolve) {
        this.walletScanResolve({ 
          success: false, 
          message: 'Invalid Ethereum address', 
          errorType: 'INVALID_ADDRESS' 
        });
        this.walletScanResolve = null;
      }
    }
  }

  /**
   * Scan for wallet address (for transaction history filtering)
   */
  public async scanForWalletAddress(): Promise<{ success: boolean; message: string; address?: string; errorType?: string }> {
    this.walletScanArmed = true;
    console.log('🔍 NFCService: Armed for wallet address scan. Waiting for tap...');
    
    // Create a promise that will be resolved when a wallet is scanned
    this.walletScanPromise = new Promise((resolve) => {
      this.walletScanResolve = resolve;
    });

    // Set a timeout for the scan (30 seconds)
    const timeoutId = setTimeout(() => {
      if (this.walletScanResolve) {
        this.walletScanResolve({ success: false, message: 'Wallet scan timeout', errorType: 'TIMEOUT' });
        this.walletScanResolve = null;
      }
      this.disarmWalletScan();
    }, 30000);

    try {
      const result = await this.walletScanPromise;
      clearTimeout(timeoutId);
      this.disarmWalletScan();
      return result;
    } catch (error) {
      clearTimeout(timeoutId);
      this.disarmWalletScan();
      return { success: false, message: 'Wallet scan processing error', errorType: 'PROCESSING_ERROR' };
    }
  }

  /**
   * Disarm the wallet scan service
   */
  private disarmWalletScan(): void {
    this.walletScanArmed = false;
    this.walletScanPromise = null;
    this.walletScanResolve = null;
  }

  /**
   * Cancel any ongoing operations (payment or wallet scan)
   */
  public cancelCurrentOperation(): void {
    console.log('🚫 Cancelling current NFC operation...');
    
    // Cancel payment operation if active
    if (this.paymentArmed && this.cardHandlerResolve) {
      console.log('🚫 Cancelling ongoing payment operation');
      this.cardHandlerResolve({ 
        success: false, 
        message: 'Payment cancelled by user', 
        errorType: 'USER_CANCELLED' 
      });
      this.cardHandlerResolve = null;
      this.disarmPayment();
    }
    
    // Cancel wallet scan operation if active
    if (this.walletScanArmed && this.walletScanResolve) {
      console.log('🚫 Cancelling ongoing wallet scan operation');
      this.walletScanResolve({ 
        success: false, 
        message: 'Wallet scan cancelled by user', 
        errorType: 'USER_CANCELLED' 
      });
      this.walletScanResolve = null;
      this.disarmWalletScan();
    }
    
    // Clean up any stuck address processing states
    AddressProcessor.clearAllProcessing();
    
    console.log('✅ NFC operation cancelled successfully');
  }

  /**
   * Stop the NFC service
   */
  public stopListening(): void {
    console.log('🔴 NFCService: Stopping listeners...');
    // Add any cleanup logic here if needed
  }
}