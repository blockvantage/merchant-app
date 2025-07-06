/**
 * CAIP-10 address handling service
 * Implements Chain Agnostic Improvement Proposal 10 for blockchain account identifiers
 * Format: namespace:reference:address
 * Example: eip155:1:0xab16a96D359eC26a11e2C2b3d8f8B8942d5Bfcdb
 */
export class CAIP10Service {
  /**
   * Parse a CAIP-10 address into its components
   */
  static parseCAIP10Address(caip10Address: string): {
    namespace: string;
    reference: string;
    address: string;
    chainId?: number;
  } | null {
    const parts = caip10Address.trim().split(':');
    
    if (parts.length !== 3) {
      return null;
    }
    
    const [namespace, reference, address] = parts;
    
    // For EIP-155 (Ethereum), the reference is the chain ID
    const chainId = namespace === 'eip155' ? parseInt(reference, 10) : undefined;
    
    return {
      namespace,
      reference,
      address,
      chainId
    };
  }
  
  /**
   * Check if a string is a valid CAIP-10 address
   */
  static isCAIP10Address(str: string): boolean {
    const parsed = this.parseCAIP10Address(str);
    if (!parsed) return false;
    
    // Validate namespace (should be lowercase)
    if (parsed.namespace !== parsed.namespace.toLowerCase()) return false;
    
    // For EIP-155, validate the address format
    if (parsed.namespace === 'eip155') {
      // Address should be 40 hex characters with optional 0x prefix
      const hexPattern = /^(0x)?[0-9a-fA-F]{40}$/;
      return hexPattern.test(parsed.address);
    }
    
    // For other namespaces, just ensure address is not empty
    return parsed.address.length > 0;
  }
  
  /**
   * Extract Ethereum address from CAIP-10 format
   * Returns null if not an EIP-155 address
   */
  static extractEthereumAddress(caip10Address: string): string | null {
    const parsed = this.parseCAIP10Address(caip10Address);
    
    if (!parsed || parsed.namespace !== 'eip155') {
      return null;
    }
    
    // Ensure address has 0x prefix
    const address = parsed.address.toLowerCase();
    return address.startsWith('0x') ? address : `0x${address}`;
  }
  
  /**
   * Convert a regular Ethereum address to CAIP-10 format
   */
  static toCAIP10Address(address: string, chainId: number = 1): string {
    // Remove 0x prefix if present
    const cleanAddress = address.toLowerCase().replace(/^0x/, '');
    return `eip155:${chainId}:0x${cleanAddress}`;
  }
}