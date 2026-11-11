import * as QRCode from 'qrcode';
import { qrPayload } from '../../common/crypto.util.js';

/** Generate a QR code PNG buffer from a raw token */
export async function generateQrPng(rawToken: string): Promise<Buffer> {
  const data = qrPayload(rawToken);
  return QRCode.toBuffer(data, {
    errorCorrectionLevel: 'M',
    type: 'png',
    width: 400,
    margin: 4,
    color: { dark: '#000000', light: '#ffffff' },
  });
}
