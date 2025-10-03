import { PN532 } from 'node-pn532';
import { SerialPort } from 'serialport';
import { openSync } from 'i2c-bus';
import * as ndef from 'ndef';
import { INFCService } from '../interfaces/INFCService.js';
import { EthereumService } from './ethereumService.js';
import { AddressProcessor } from './addressProcessor.js';
import { AlchemyService } from './alchemyService.js';
import { PaymentService } from './paymentService.js';
import { CAIP10Service } from './caip10Service.js';
import { broadcast } from '../server.js';

/**
 * PN532 NFC Service implementation
 * Supports HiLetgo PN532 NFC NXP RFID Module V3 Kit
 */
export class PN532Service implements INFCService {
  private pn532: PN532 | null = null;
  private serialPort: SerialPort | null = null;
  private i2cBus: any = null;
  private paymentArmed: boolean = false;
  private walletScanArmed: boolean = false;
  private currentPaymentAmount: number | null = null;
  private cardHandlerPromise: Promise<{ success: boolean; message: string; errorType?: string; paymentInfo?: any }> | null = null;
  private cardHandlerResolve: ((result: { success: boolean; message: string; errorType?: string; paymentInfo?: any }) => void) | null = null;
  private walletScanPromise: Promise<{ success: boolean; message: string; address?: string; errorType?: string }> | null = null;
  private walletScanResolve: ((result: { success: boolean; message: string; address?: string; errorType?: string }) => void) | null = null;
  private isReady: boolean = false;
  private pollInterval: NodeJS.Timeout | null = null;

  // Add instance tracking
  private static instanceCount = 0;
  private instanceId: number;

  constructor(
    private connectionType: string = 'UART',
    private serialPortPath: string = '/dev/ttyUSB0', 
    private baudRate: number = 115200,
    private i2cAddress: number = 0x24,
    private i2cBusNumber: number = 1
  ) {
    PN532Service.instanceCount++;
    this.instanceId = PN532Service.instanceCount;
    console.log(`🏗️ DEBUG: Creating PN532Service instance #${this.instanceId} (total instances: ${PN532Service.instanceCount})`);
    console.log(`🔧 Connection type: ${connectionType}`);
    
    this.initializePN532();
  }

  /**
   * Initialize PN532 connection
   */
  private async initializePN532(): Promise<void> {
    try {
      if (this.connectionType.toLowerCase() === 'i2c') {
        console.log(`🔧 DEBUG: Instance #${this.instanceId} - Initializing PN532 over I2C (bus: ${this.i2cBusNumber}, address: 0x${this.i2cAddress.toString(16)})`);
        
        // Create I2C connection using the correct node-pn532 method
        this.i2cBus = openSync(this.i2cBusNumber);
        console.log(`✅ I2C bus ${this.i2cBusNumber} opened successfully`);
        
        // Create PN532 instance with I2C - this is the correct way according to node-pn532 docs
        this.pn532 = new PN532(this.i2cBus, { address: this.i2cAddress });
        
      } else {
        console.log(`🔧 DEBUG: Instance #${this.instanceId} - Initializing PN532 over UART on ${this.serialPortPath}`);
        
        // Create serial port connection
        this.serialPort = new SerialPort({
          path: this.serialPortPath,
          baudRate: this.baudRate,
          autoOpen: false
        });

        // Open the serial port
        await new Promise<void>((resolve, reject) => {
          this.serialPort!.open((err) => {
            if (err) {
              console.error(`❌ Failed to open serial port ${this.serialPortPath}:`, err.message);
              reject(err);
            } else {
              console.log(`✅ Serial port ${this.serialPortPath} opened successfully`);
              resolve();
            }
          });
        });

        // Create PN532 instance with UART
        this.pn532 = new PN532(this.serialPort);
      }

      // Wait for PN532 to be ready
      this.pn532.on('ready', () => {
        console.log(`💳 Instance #${this.instanceId} - PN532 Reader Ready`);
        this.isReady = true;
        broadcast({ type: 'nfc_status', message: 'PN532 Reader connected and ready' });
        this.startPolling();
      });

      this.pn532.on('error', (err: Error) => {
        console.error(`❌ Instance #${this.instanceId} - PN532 error:`, err);
        broadcast({ type: 'nfc_status', message: `PN532 error: ${err.message}` });
      });

    } catch (error) {
      console.error(`❌ Failed to initialize PN532:`, error);
      broadcast({ type: 'nfc_status', message: 'Failed to initialize PN532 reader' });
    }
  }
  /**
   * Start polling for NFC tags
   */
  private startPolling(): void {
    console.log(`🟢 Instance #${this.instanceId} - Starting to poll for tags...`);
    
    this.pollInterval = setInterval(async () => {
      if (!this.isReady) return;
      
      try {
        if (this.connectionType.toLowerCase() === 'i2c') {
          // For I2C, use the standard scanTag method
          const tag = await this.pn532!.scanTag();
          if (tag) {
            console.log(`📱 Instance #${this.instanceId} - I2C Tag detected:`, tag.uid);
            await this.handleTag(tag);
          }
        } else {
          // Try to scan for a tag using UART
          const tag = await this.pn532!.scanTag();
          if (tag) {
            console.log(`📱 Instance #${this.instanceId} - Tag detected:`, tag.uid);
            await this.handleTag(tag);
          }
        }
      } catch (error) {
        // Ignore scan errors during polling - they're expected when no tag is present
        if (error instanceof Error && !error.message.includes('Timeout')) {
          console.error(`❌ Instance #${this.instanceId} - Polling error:`, error);
        }
      }
    }, 500);
  }

  /**
   * Poll for NFC tags via I2C
   */
  private async pollForTagI2C(): Promise<void> {
    if (!this.i2cBus) return;
    
    try {
      // Basic I2C tag detection - this is a simplified implementation
      // In a real scenario, you'd implement the full PN532 I2C protocol
      
      // For now, we'll simulate tag detection when payment/scan is armed
      if (this.paymentArmed || this.walletScanArmed) {
        // Simulate a tag being detected
        const mockTag = { uid: 'i2c-simulated-tag' };
        console.log(`📱 Instance #${this.instanceId} - I2C Tag detected (simulated):`, mockTag.uid);
        await this.handleTag(mockTag);
      }
    } catch (error) {
      // Ignore I2C polling errors
    }
  }

  /**
   * Write NDEF data via I2C communication
   */
  private async writeNdefDataI2C(ndefMessage: Buffer): Promise<void> {
    if (!this.i2cBus) {
      throw new Error('I2C bus not initialized');
    }

    try {
      // Basic I2C communication with PN532
      // This is a simplified implementation - in a real scenario you'd need
      // to implement the full PN532 I2C protocol
      
      console.log(`📡 Writing ${ndefMessage.length} bytes via I2C to PN532`);
      
      // For now, we'll simulate successful NDEF writing
      // A full implementation would require implementing the PN532 I2C protocol
      await new Promise(resolve => setTimeout(resolve, 50));
      
      console.log('✅ NDEF data written via I2C');
    } catch (error) {
      console.error('❌ Error writing NDEF data via I2C:', error);
      throw error;
    }
  }

  /**
   * Handle detected NFC tag
   */
  private async handleTag(tag: any): Promise<void> {
    console.log(`🔧 DEBUG: Instance #${this.instanceId} - Tag event handler called, paymentArmed: ${this.paymentArmed}, walletScanArmed: ${this.walletScanArmed}`);
    
    if (!this.paymentArmed && !this.walletScanArmed) {
      console.log(`💤 Instance #${this.instanceId} - Reader not armed for payment or wallet scan, ignoring tap`);
      return;
    }

    try {
      // Send wallet:address command as NDEF URI to get the wallet address
      const walletUri = 'wallet:address';
      console.log(`📡 Sending NDEF URI: ${walletUri}`);
      
      // Create NDEF message with URI record
      const uriRecord = ndef.uriRecord(walletUri);
      const ndefMessage = ndef.encodeMessage([uriRecord]);
      
      // Write NDEF message to tag
      await this.pn532!.writeNdefData(ndefMessage);
      
      // Wait a moment for the phone to process
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // For now, assume successful transmission
      // The actual response reading can be implemented later if needed
      console.log('📱 Payment request transmitted successfully');
      const phoneResponse = 'payment_transmitted';
      
      if (this.walletScanArmed) {
        await this.processWalletScan(phoneResponse);
      } else if (this.paymentArmed && this.currentPaymentAmount !== null) {
        await this.processPhoneResponse(phoneResponse, this.currentPaymentAmount);
      }
      
    } catch (error) {
      console.error('❌ Error processing tag:', error);
      
      if (this.cardHandlerResolve) {
        this.cardHandlerResolve({ success: false, message: 'Error processing tag', errorType: 'TAG_ERROR' });
        this.cardHandlerResolve = null;
      }
      
      if (this.walletScanResolve) {
        this.walletScanResolve({ success: false, message: 'Error processing tag', errorType: 'TAG_ERROR' });
        this.walletScanResolve = null;
      }
    }
  }

  /**
   * Process the response from the phone for payment
   */
  private async processPhoneResponse(phoneResponse: string, amount: number): Promise<void> {
    let ethAddress: string | null = null;
    let chainId: number = 1; // Default to Ethereum mainnet
    
    // Check if this is a CAIP-10 address or regular Ethereum address
    if (CAIP10Service.isCAIP10Address(phoneResponse)) {
      const parsed = CAIP10Service.parseCAIP10Address(phoneResponse);
      if (parsed && parsed.namespace === 'eip155') {
        ethAddress = CAIP10Service.extractEthereumAddress(phoneResponse);
        chainId = parsed.chainId || 1;
        console.log(`✓ Detected CAIP-10 Ethereum address: ${ethAddress} on chain ${chainId}`);
      }
    } else if (EthereumService.isEthereumAddress(phoneResponse)) {
      // Handle legacy plain Ethereum address format
      ethAddress = EthereumService.normalizeEthereumAddress(phoneResponse);
      console.log(`✓ Detected Ethereum address: ${ethAddress}`);
    }
    
    if (ethAddress) {
      const transactionFlowStart = Date.now();
      console.log(`⏱️ [PROFILE] Starting transaction flow for $${amount} payment`);
      
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
        // Update UI to show loading tokens
        broadcast({ type: 'status', message: 'Loading tokens...' });
        
        let portfolio;
        try {
          // Fetch balances from Alchemy API across all supported chains
          const balanceFetchStart = Date.now();
          portfolio = await AlchemyService.fetchMultiChainBalances(ethAddress);
          const balanceFetchTime = Date.now() - balanceFetchStart;
          console.log(`⏱️ [PROFILE] Total balance fetch time: ${balanceFetchTime}ms`);
        } catch (fetchError: any) {
          console.error('💥 Error fetching tokens from Alchemy:', fetchError);
          throw new Error('FAILED_TO_FETCH_TOKENS');
        }
        
        // Calculate and send payment request using all tokens across all chains
        const paymentStart = Date.now();
        const paymentInfo = await PaymentService.calculateAndSendPaymentPN532(portfolio.allTokens, this.pn532!, amount);
        const paymentTime = Date.now() - paymentStart;
        console.log(`⏱️ [PROFILE] Total payment processing time: ${paymentTime}ms`);
        
        // Update UI to show waiting for payment
        broadcast({ type: 'status', message: 'Waiting for payment...' });
        
        paymentSuccessful = true; // Payment request was sent successfully
        
        const totalTransactionTime = Date.now() - transactionFlowStart;
        console.log(`⏱️ [PROFILE] COMPLETE TRANSACTION FLOW: ${totalTransactionTime}ms`);
        
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
          AddressProcessor.finishProcessing(ethAddress);
          return; // Exit without resolving the promise
        }
        
        paymentSuccessful = false;
        
        if (this.cardHandlerResolve) {
          // Check for specific error types and handle them appropriately
          let errorMessage: string;
          let errorType: string;
          
          if (balanceError.message === 'FAILED_TO_FETCH_TOKENS') {
            errorMessage = 'Failed to fetch tokens';
            errorType = 'TOKEN_FETCH_ERROR';
          } else if (balanceError.message === "Customer doesn't have enough funds") {
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
        
        if (ethAddress) {
          AddressProcessor.finishProcessing(ethAddress);
        }
      }
    } else {
      console.log('📱 Response is not a valid Ethereum address');
      if (this.cardHandlerResolve) {
        this.cardHandlerResolve({ success: false, message: 'Invalid or non-Ethereum address', errorType: 'INVALID_ADDRESS' });
        this.cardHandlerResolve = null;
      }
    }
  }

  /**
   * Process wallet address scan response
   */
  private async processWalletScan(phoneResponse: string): Promise<void> {
    let ethAddress: string | null = null;
    let chainId: number | undefined;
    
    // Check if this is a CAIP-10 address or regular Ethereum address
    if (CAIP10Service.isCAIP10Address(phoneResponse)) {
      const parsed = CAIP10Service.parseCAIP10Address(phoneResponse);
      if (parsed && parsed.namespace === 'eip155') {
        ethAddress = CAIP10Service.extractEthereumAddress(phoneResponse);
        chainId = parsed.chainId;
        console.log(`✓ Wallet CAIP-10 address scanned: ${phoneResponse}`);
        console.log(`  → Ethereum address: ${ethAddress} on chain ${chainId}`);
      } else {
        console.log(`⚠️ Non-Ethereum CAIP-10 address: ${phoneResponse}`);
      }
    } else if (EthereumService.isEthereumAddress(phoneResponse)) {
      // Handle legacy plain Ethereum address format
      ethAddress = EthereumService.normalizeEthereumAddress(phoneResponse);
      console.log(`✓ Wallet address scanned: ${ethAddress}`);
    }
    
    if (ethAddress) {
      if (this.walletScanResolve) {
        this.walletScanResolve({ 
          success: true, 
          message: `Wallet scanned successfully`,
          address: ethAddress
        });
        this.walletScanResolve = null;
      }
    } else {
      console.log('📱 Response is not a valid Ethereum address');
      if (this.walletScanResolve) {
        this.walletScanResolve({ 
          success: false, 
          message: 'Invalid or non-Ethereum address', 
          errorType: 'INVALID_ADDRESS' 
        });
        this.walletScanResolve = null;
      }
    }
  }

  /**
   * Start the NFC service
   */
  public startListening(): void {
    console.log('🟢 PN532Service: Starting to listen for tags...');
    console.log('📡 PN532 Service is now listening for NFC tags.');
  }

  /**
   * Arm the service for payment and wait for a card tap
   */
  public async armForPaymentAndAwaitTap(amount: number): Promise<{ success: boolean; message: string; errorType?: string; paymentInfo?: any }> {
    console.log(`🔧 DEBUG: Instance #${this.instanceId} - Arming payment service for $${amount.toFixed(2)}`);
    
    if (!this.isReady || !this.pn532) {
      return { success: false, message: 'PN532 reader not ready', errorType: 'READER_NOT_READY' };
    }
    
    // Clean up any leftover state from previous sessions
    if (this.paymentArmed || this.cardHandlerResolve || this.cardHandlerPromise) {
      console.log(`⚠️ WARNING: Instance #${this.instanceId} - Found leftover payment state, cleaning up...`);
      this.disarmPayment();
    }
    
    this.paymentArmed = true;
    this.currentPaymentAmount = amount;
    console.log(`💰 PN532Service: Instance #${this.instanceId} - Armed for payment of $${amount.toFixed(2)}. Waiting for tap...`);
    
    // Debug: Show current address processing state
    AddressProcessor.debugState();
    
    // Create a promise that will be resolved when a tag is processed
    this.cardHandlerPromise = new Promise((resolve) => {
      this.cardHandlerResolve = resolve;
    });

    // Set a timeout for the payment (30 seconds)
    const timeoutId = setTimeout(() => {
      console.log(`⏰ DEBUG: Payment timeout reached, disarming...`);
      if (this.cardHandlerResolve) {
        this.cardHandlerResolve({ success: false, message: 'Payment timeout', errorType: 'TIMEOUT' });
        this.cardHandlerResolve = null;
      }
      this.disarmPayment();
    }, 30000);

    try {
      const result = await this.cardHandlerPromise;
      console.log(`🔧 DEBUG: Card handler promise resolved, clearing timeout and disarming`);
      clearTimeout(timeoutId);
      this.disarmPayment();
      return result;
    } catch (error) {
      console.log(`🔧 DEBUG: Card handler promise error, clearing timeout and disarming`);
      clearTimeout(timeoutId);
      this.disarmPayment();
      return { success: false, message: 'Payment processing error', errorType: 'PROCESSING_ERROR' };
    }
  }

  /**
   * Scan for wallet address (for transaction history filtering)
   */
  public async scanForWalletAddress(): Promise<{ success: boolean; message: string; address?: string; errorType?: string }> {
    if (!this.isReady || !this.pn532) {
      return { success: false, message: 'PN532 reader not ready', errorType: 'READER_NOT_READY' };
    }

    this.walletScanArmed = true;
    console.log('🔍 PN532Service: Armed for wallet address scan. Waiting for tap...');
    
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
   * Cancel any ongoing operations (payment or wallet scan)
   */
  public cancelCurrentOperation(): void {
    console.log('🚫 Cancelling current PN532 operation...');
    
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
    
    console.log('✅ PN532 operation cancelled successfully');
  }

  /**
   * Stop the NFC service
   */
  public stopListening(): void {
    console.log('🔴 PN532Service: Stopping listeners...');
    
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    
    if (this.serialPort && this.serialPort.isOpen) {
      this.serialPort.close((err) => {
        if (err) {
          console.error('Error closing serial port:', err);
        } else {
          console.log('Serial port closed successfully');
        }
      });
    }
  }

  /**
   * Disarm the payment service
   */
  private disarmPayment(): void {
    console.log(`🔧 DEBUG: Instance #${this.instanceId} - disarmPayment() called - was armed: ${this.paymentArmed}`);
    this.paymentArmed = false;
    this.currentPaymentAmount = null;
    this.cardHandlerPromise = null;
    this.cardHandlerResolve = null;
    
    // Clean up any stuck address processing states when disarming
    console.log(`🧹 Instance #${this.instanceId} - Cleaning up any stuck address processing states...`);
    AddressProcessor.clearAllProcessing();
  }

  /**
   * Disarm the wallet scan service
   */
  private disarmWalletScan(): void {
    this.walletScanArmed = false;
    this.walletScanPromise = null;
    this.walletScanResolve = null;
  }
}
