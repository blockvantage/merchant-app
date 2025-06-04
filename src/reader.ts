import pcsc from 'pcsclite';

const AID_SELECT = Buffer.from('00A4040007F2222222222200', 'hex');
const GET_STRING = Buffer.from('80CA000000', 'hex');
const OK = 0x9000;              // SW1 SW2 = 90 00

const pcscCtx = pcsc();

pcscCtx.on('reader', (r: any) => {
  console.log('Reader →', r.name);

  r.on('status', (status: any) => {
    const inField = (r.state ^ status.state) & r.SCARD_STATE_PRESENT &&
                    status.state & r.SCARD_STATE_PRESENT;
    if (!inField) return;       // ignore removes / other noise

    console.log('Card present – connecting …');
    r.connect({ share_mode: r.SCARD_SHARE_SHARED, protocol: r.SCARD_PROTOCOL_T1 },
      (err: any) => {
        if (err) return console.error('connect', err);

        // 1 SELECT
        r.transmit(AID_SELECT, 32, r.SCARD_PROTOCOL_T1, (e: any, resp: Buffer) => {
          if (e) return console.error('SELECT', e);
          if (resp.readUInt16BE(resp.length - 2) !== OK)
            return console.error('SELECT failed', resp.toString('hex'));

          // 2 GET_STRING
          r.transmit(GET_STRING, 256, r.SCARD_PROTOCOL_T1, (e2: any, data: Buffer) => {
            if (e2) return console.error('GET_STRING', e2);
            if (data.readUInt16BE(data.length - 2) !== OK)
              return console.error('Bad status', data.toString('hex'));

            const txt = data.slice(0, -2).toString();
            console.log('Phone says →', txt);

            r.disconnect(r.SCARD_LEAVE_CARD, () => pcscCtx.close());
          });
        });
      });
  });

  r.on('error', (err: any) => console.error('reader error', err));
});

pcscCtx.on('error', err => console.error('pcsc error', err));
