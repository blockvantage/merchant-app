/* minimal typings – just enough for our script */
declare module 'nfc-pcsc' {
    import { EventEmitter } from 'events';
  
    export interface Reader extends EventEmitter {
      name: string;
      connect(): Promise<void>;
      close(): void;
      aid: string;
      transmit(data: Buffer, resLen: number): Promise<Buffer>;
      on(event: 'card',   listener: () => void): this;
      on(event: 'error',  listener: (err: Error) => void): this;
    }
  
    export class NFC extends EventEmitter {
      on(event: 'reader', listener: (reader: Reader) => void): this;
    }
  }
  