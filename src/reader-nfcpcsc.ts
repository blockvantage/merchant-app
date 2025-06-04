import { NFC, Reader } from 'nfc-pcsc';

// Define a basic interface for the card object based on expected properties
interface CardData {
  type?: string; // e.g., 'TAG_ISO_14443_4'
  standard?: string; // e.g., 'TAG_ISO_14443_4'
  uid?: string;
  data?: Buffer; // Response from SELECT AID if autoProcessing is on
  atr?: Buffer;
}

const AID = 'F2222222222222';                 // must match the AID in your Android app
const GET = Buffer.from('80CA000000', 'hex'); // "GET_STRING" APDU

const nfc = new NFC();

nfc.on('reader', (reader: Reader) => {
  console.log('Reader →', reader.name);

  reader.aid = AID;                       // ★ IMPORTANT ★

  // @ts-ignore TS7006: Parameter 'card' implicitly has an 'any' type - this will be handled by explicit typing if ts-ignore is too broad, or if the specific overload error is the main issue.
  // The primary issue is likely the event signature in the .d.ts file for nfc-pcsc's Reader.on('card', ...)
  reader.on('card', async (card: CardData) => { // Explicitly type 'card', ts-ignore for the overall assignment if types are too mismatched
    try {
      // await reader.connect();             // This is likely redundant as nfc-pcsc connects when reader.aid is set

      // If the GetUIDError (wrapping "Transaction Failed") occurred during auto-SELECT,
      // this part might not be reached or will operate on a failed state.
      // The error you see is likely from that initial auto-SELECT failing.

      // @ts-expect-error Argument of type '{}' is not assignable to parameter of type 'never'.
      const resp = await reader.transmit(GET, 256, {}); // Pass empty options object; suppress TS error due to typings
      const sw  = resp.readUInt16BE(resp.length - 2);
      if (sw !== 0x9000) throw new Error('Bad status ' + sw.toString(16));

      console.log('Phone says →', resp.slice(0, -2).toString());
    } catch (e) {
      console.error('reader err', e); // This will catch the GetUIDError or errors from transmit
    } finally {
      reader.close();                     // free the reader for the next tap
    }
  });

  reader.on('error', err => console.error('reader err', err));
});
