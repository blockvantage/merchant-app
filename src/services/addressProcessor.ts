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
   * Mark an address as being processed
   */
  static startProcessing(address: string): void {
    const normalizedAddress = address.toLowerCase();
    this.processingAddresses.add(normalizedAddress);
    console.log(`🔄 Starting to process address: ${address}`);
  }

  /**
   * Mark address processing as complete and set cooldown
   */
  static finishProcessing(address: string): void {
    const normalizedAddress = address.toLowerCase();
    this.processingAddresses.delete(normalizedAddress);
    this.addressCooldowns.set(normalizedAddress, Date.now());
    console.log(`✅ Finished processing address: ${address}`);
    console.log(`📱 Ready for next tap (this address has a ${COOLDOWN_DURATION/1000}s cooldown)\n`);
  }
} 