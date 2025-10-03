/**
 * Interface for NFC service implementations
 */
export interface INFCService {
  /**
   * Start listening for NFC readers
   */
  startListening(): void;

  /**
   * Arm the service for payment and wait for a card tap
   */
  armForPaymentAndAwaitTap(amount: number): Promise<{
    success: boolean;
    message: string;
    errorType?: string;
    paymentInfo?: any;
  }>;

  /**
   * Scan for wallet address (for transaction history filtering)
   */
  scanForWalletAddress(): Promise<{
    success: boolean;
    message: string;
    address?: string;
    errorType?: string;
  }>;

  /**
   * Cancel any ongoing operations (payment or wallet scan)
   */
  cancelCurrentOperation(): void;

  /**
   * Stop the NFC service
   */
  stopListening(): void;
}
