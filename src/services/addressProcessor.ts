import { COOLDOWN_DURATION } from '../config/index.js';

/**
 * Service for managing address processing state and cooldowns
 */
export class AddressProcessor {
  private static processingAddresses = new Set<string>();
  private static addressCooldowns = new Map<string, number>();

  /**
   * Check if an address can be processed (not already processing and not in cooldown)
   */
  static canProcessAddress(address: string): boolean {
    const normalizedAddress = address.toLowerCase();
    
    // Check if already being processed
    if (this.processingAddresses.has(normalizedAddress)) {
      console.log(`⏳ Address ${address} is already being processed, please wait...`);
      console.log(`🔍 Currently processing addresses:`, Array.from(this.processingAddresses));
      return false;
    }
    
    // Check cooldown
    const lastProcessed = this.addressCooldowns.get(normalizedAddress);
    if (lastProcessed && Date.now() - lastProcessed < COOLDOWN_DURATION) {
      const remainingCooldown = Math.ceil((COOLDOWN_DURATION - (Date.now() - lastProcessed)) / 1000);
      console.log(`🕐 Address ${address} is in cooldown, please wait ${remainingCooldown} seconds before trying again`);
      return false;
    }
    
    return true;
  }

  /**
   * Get the specific reason why an address cannot be processed
   */
  static getProcessingBlockReason(address: string): string | null {
    const normalizedAddress = address.toLowerCase();
    
    // Check if already being processed
    if (this.processingAddresses.has(normalizedAddress)) {
      return 'Address is already being processed';
    }
    
    // Check cooldown
    const lastProcessed = this.addressCooldowns.get(normalizedAddress);
    if (lastProcessed && Date.now() - lastProcessed < COOLDOWN_DURATION) {
      const remainingCooldown = Math.ceil((COOLDOWN_DURATION - (Date.now() - lastProcessed)) / 1000);
      return `Please wait ${remainingCooldown} seconds before trying again`;
    }
    
    return null; // Can be processed
  }

  /**
   * Mark an address as being processed
   */
  static startProcessing(address: string): void {
    const normalizedAddress = address.toLowerCase();
    this.processingAddresses.add(normalizedAddress);
    console.log(`🔄 Starting to process address: ${address}`);
    console.log(`📊 Total addresses being processed: ${this.processingAddresses.size}`);
  }

  /**
   * Mark address processing as complete and set cooldown (for successful payments)
   */
  static finishProcessing(address: string): void {
    const normalizedAddress = address.toLowerCase();
    const wasProcessing = this.processingAddresses.has(normalizedAddress);
    this.processingAddresses.delete(normalizedAddress);
    this.addressCooldowns.set(normalizedAddress, Date.now());
    console.log(`✅ Finished processing address: ${address} (was processing: ${wasProcessing})`);
    console.log(`📊 Remaining addresses being processed: ${this.processingAddresses.size}`);
    console.log(`📱 Ready for next tap (this address has a ${COOLDOWN_DURATION/1000}s cooldown)\n`);
  }

  /**
   * Mark address processing as complete WITHOUT setting cooldown (for failed payments)
   */
  static finishProcessingWithoutCooldown(address: string): void {
    const normalizedAddress = address.toLowerCase();
    const wasProcessing = this.processingAddresses.has(normalizedAddress);
    this.processingAddresses.delete(normalizedAddress);
    console.log(`✅ Finished processing address: ${address} (was processing: ${wasProcessing}) - NO COOLDOWN for failed payment`);
    console.log(`📊 Remaining addresses being processed: ${this.processingAddresses.size}`);
    console.log(`📱 Ready for immediate retry\n`);
  }

  /**
   * Clear all processing states (emergency cleanup)
   */
  static clearAllProcessing(): void {
    const addressCount = this.processingAddresses.size;
    if (addressCount > 0) {
      console.log(`🧹 Clearing ${addressCount} stuck address(es) from processing state`);
      console.log(`🔍 Addresses being cleared:`, Array.from(this.processingAddresses));
      this.processingAddresses.clear();
    } else {
      console.log(`🧹 No stuck addresses to clear`);
    }
  }

  /**
   * Debug method to show current state
   */
  static debugState(): void {
    console.log(`📊 AddressProcessor Debug State:`);
    console.log(`   Processing addresses (${this.processingAddresses.size}):`, Array.from(this.processingAddresses));
    console.log(`   Cooldown addresses (${this.addressCooldowns.size}):`, Array.from(this.addressCooldowns.keys()));
  }
} 