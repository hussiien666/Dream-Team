import { BadRequestException, PayloadTooLargeException, Injectable } from '@nestjs/common';
import type { CallHandler, ExecutionContext, NestInterceptor } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import Busboy from 'busboy';
import type { IncomingHttpHeaders } from 'node:http';

const maximum = 10 * 1024 * 1024;
const limits = { fileSize: maximum, files: 1, fields: 4, fieldSize: 2000, parts: 6 };
type Upload = { buffer: Buffer; originalname: string; mimetype: string; size: number; fieldname: string };

/** GCF has consumed the stream already; parse its bounded rawBody explicitly. */
export async function parseRegistrationUpload(raw: Buffer, headers: IncomingHttpHeaders) {
  if (raw.length > maximum + 65536) throw new PayloadTooLargeException('The uploaded workbook is too large.');
  return new Promise<{ file?: Upload; body: Record<string, string> }>((resolve, reject) => {
    let parser: ReturnType<typeof Busboy>;
    try { parser = Busboy({ headers, limits }); }
    catch { reject(new BadRequestException('The upload is unreadable. Select the workbook again.')); return; }
    const body = Object.create(null) as Record<string, string>;
    let file: Upload | undefined, failed: Error | undefined;
    const invalid = () => { failed ??= new BadRequestException('Upload one workbook with valid import fields.'); };
    parser.on('file', (name, stream, info) => {
      if (name !== 'file' || file) invalid();
      const chunks: Buffer[] = []; let size = 0;
      stream.on('limit', () => { failed = new PayloadTooLargeException('Workbooks must be 10 MB or smaller.'); });
      stream.on('data', (chunk: Buffer) => { size += chunk.length; if (!failed) chunks.push(chunk); });
      stream.on('error', invalid);
      stream.on('end', () => {
        if (!failed) file = { buffer: Buffer.concat(chunks), originalname: info.filename,
          mimetype: info.mimeType, fieldname: name, size };
      });
    });
    parser.on('field', (name, value, info) => {
      if (!['requestKey', 'previewHash', 'confirmed', 'overrideReason'].includes(name) || Object.hasOwn(body, name) || info.nameTruncated || info.valueTruncated) invalid();
      else body[name] = value;
    });
    parser.on('filesLimit', invalid); parser.on('fieldsLimit', invalid); parser.on('partsLimit', invalid);
    parser.on('error', () => { reject(new BadRequestException('The upload is incomplete. Select the workbook again.')); });
    parser.on('close', () => { if (failed) reject(failed); else resolve({ file, body }); });
    parser.end(raw);
  });
}

const StandardUpload = FileInterceptor('file', { limits });
@Injectable()
export class RegistrationUploadInterceptor implements NestInterceptor {
  private standard = new StandardUpload();
  async intercept(context: ExecutionContext, next: CallHandler) {
    const req = context.switchToHttp().getRequest<{ rawBody?: Buffer; headers: IncomingHttpHeaders; body: unknown; file?: Upload }>();
    if (Buffer.isBuffer(req.rawBody) && req.headers['content-type']?.startsWith('multipart/form-data')) {
      const parsed = await parseRegistrationUpload(req.rawBody, req.headers);
      req.body = parsed.body; req.file = parsed.file;
      return next.handle();
    }
    return this.standard.intercept(context, next);
  }
}
