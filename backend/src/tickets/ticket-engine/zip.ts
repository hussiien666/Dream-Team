import { crc32, deflateRawSync } from 'node:zlib';
import { BadRequestException } from '@nestjs/common';
/** Bounded ZIP32 writer: generated names only; never writes to disk. */
export function ticketZip(files: { name: string; bytes: Buffer }[]): Buffer {
  const data: Buffer[] = [],
    central: Buffer[] = [];
  let offset = 0,
    total = 0;
  for (const file of files) {
    if (!/^[A-Za-z0-9_.-]+$/.test(file.name))
      throw new BadRequestException('Invalid archive filename.');
    total += file.bytes.length;
    if (total > 30 * 1024 * 1024)
      throw new BadRequestException(
        'Ticket archive exceeds 30 MB. Select fewer tickets.',
      );
    const name = Buffer.from(file.name),
      compressed = deflateRawSync(file.bytes),
      crc = crc32(file.bytes);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50);
    h.writeUInt16LE(20, 4);
    h.writeUInt16LE(8, 8);
    h.writeUInt16LE(33, 12); // 1980-01-01, a valid ZIP/DOS date.
    h.writeUInt32LE(crc, 14);
    h.writeUInt32LE(compressed.length, 18);
    h.writeUInt32LE(file.bytes.length, 22);
    h.writeUInt16LE(name.length, 26);
    data.push(h, name, compressed);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(8, 10);
    c.writeUInt16LE(33, 14);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(compressed.length, 20);
    c.writeUInt32LE(file.bytes.length, 24);
    c.writeUInt16LE(name.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, name);
    offset += h.length + name.length + compressed.length;
  }
  const directory = Buffer.concat(central),
    end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(directory.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...data, directory, end]);
}
