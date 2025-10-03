import { INFCService } from '../interfaces/INFCService.js';
import { NFCService } from './nfcService.js';
import { PN532Service } from './pn532Service.js';
import { 
  NFC_READER_TYPE, 
  PN532_SERIAL_PORT, 
  PN532_BAUD_RATE, 
  PN532_CONNECTION_TYPE,
  PN532_I2C_BUS,
  PN532_I2C_ADDRESS
} from '../config/index.js';

/**
 * Factory for creating NFC service instances based on configuration
 */
export class NFCFactory {
  /**
   * Create an NFC service instance based on the configured reader type
   */
  static createNFCService(): INFCService {
    console.log(`🏭 NFCFactory: Creating NFC service for reader type: ${NFC_READER_TYPE}`);
    
    switch (NFC_READER_TYPE) {
      case 'PN532':
        if (PN532_CONNECTION_TYPE.toLowerCase() === 'i2c') {
          console.log(`🔧 Creating PN532Service with I2C connection (bus: ${PN532_I2C_BUS}, address: 0x${PN532_I2C_ADDRESS.toString(16)})`);
          return new PN532Service('I2C', '/dev/null', 115200, PN532_I2C_ADDRESS, PN532_I2C_BUS);
        } else {
          console.log(`🔧 Creating PN532Service with UART connection: ${PN532_SERIAL_PORT}, baud rate: ${PN532_BAUD_RATE}`);
          return new PN532Service('UART', PN532_SERIAL_PORT, PN532_BAUD_RATE);
        }
      
      case 'ACR1252U':
      default:
        console.log(`🔧 Creating NFCService for ACR1252U reader`);
        return new NFCService();
    }
  }

  /**
   * Get the current reader type from configuration
   */
  static getReaderType(): string {
    return NFC_READER_TYPE;
  }

  /**
   * Check if the current reader type is supported
   */
  static isReaderTypeSupported(readerType: string): boolean {
    return ['ACR1252U', 'PN532'].includes(readerType);
  }
}
