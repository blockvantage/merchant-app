// Type declarations for modules without TypeScript support

declare module 'pn532' {
  import { EventEmitter } from 'events';
  
  export class PN532 extends EventEmitter {
    constructor(serialPort: any);
    
    on(event: 'ready', listener: () => void): this;
    on(event: 'error', listener: (error: Error) => void): this;
    on(event: string, listener: (...args: any[]) => void): this;
    
    getFirmwareVersion(): Promise<any>;
    scanTag(): Promise<any>;
    writeNdefData(data: Buffer): Promise<void>;
  }
}

declare module 'ndef' {
  export interface NDEFRecord {
    tnf: number;
    type: Buffer;
    id: Buffer;
    payload: Buffer;
  }
  
  export function textRecord(text: string, languageCode?: string): NDEFRecord;
  export function uriRecord(uri: string): NDEFRecord;
  export function encodeMessage(records: NDEFRecord[]): Buffer;
  export function decodeMessage(buffer: Buffer): NDEFRecord[];
}

declare module 'i2c-bus' {
  export interface I2CBus {
    readByte(address: number, register: number, callback: (err: Error | null, data: number) => void): void;
    writeByte(address: number, register: number, byte: number, callback: (err: Error | null) => void): void;
    close(callback: (err: Error | null) => void): void;
  }
  
  export function openSync(busNumber: number): I2CBus;
  export function open(busNumber: number, callback: (err: Error | null, bus: I2CBus) => void): void;
}
