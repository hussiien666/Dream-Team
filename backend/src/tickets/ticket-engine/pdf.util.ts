import { PDFDocument, rgb, type PDFPage } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';
import bidiFactory from 'bidi-js';
import { readFileSync } from 'node:fs';
import { BadRequestException } from '@nestjs/common';
import { generateQrPng } from './qr.util.js';
import { defaultDesign, imageBytes, type TicketDesign } from './design.js';
import { details } from './content.js';
export { formatEventTime } from './content.js';
const fontBytes = readFileSync(
  new URL('../../../assets/fonts/NotoSansArabic.ttf', import.meta.url),
);
const bidi = bidiFactory();
/** Shape each logical directional run separately, then place runs in visual bidi order. */
export function visualRuns(text: string): string[] {
  if (!text) return [];
  const embedding = bidi.getEmbeddingLevels(text),
    indices = bidi.getReorderedIndices(text, embedding);
  const groups: { start: number; end: number }[] = [],
    groupAt: number[] = [];
  for (let i = 0; i < text.length; i++) {
    if (i === 0 || embedding.levels[i] !== embedding.levels[i - 1])
      groups.push({ start: i, end: i + 1 });
    else groups.at(-1)!.end = i + 1;
    groupAt[i] = groups.length - 1;
  }
  const order = [...new Set(indices.map((i) => groupAt[i]))];
  return order.map((g) => text.slice(groups[g].start, groups[g].end));
}
export async function generatePdfTicket(
  event: any,
  attendee: any,
  category: any,
  ticket: any,
  rawToken: string,
  entrances: any[],
  design: TicketDesign = defaultDesign,
): Promise<Buffer> {
  const pdf = await PDFDocument.create();
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true }),
    supported = new Set(font.getCharacterSet());
  const color = (hex: string) =>
    rgb(
      ...([1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255) as [
        number,
        number,
        number,
      ]),
    );
  const primary = color(design.primaryColor),
    accent = color(design.accentColor),
    background = color(design.backgroundColor);
  const width = 419.53,
    height = 595.28,
    margin = 30,
    available = width - margin * 2;
  let page: PDFPage = undefined!,
    y = 0;
  const bg = design.background
    ? await embedImage(design.background)
    : undefined;
  const customLogo = !design.showLogo
    ? undefined
    : design.logo
      ? await embedImage(design.logo)
      : event.logo
        ? (Buffer.from(event.logo)[0]===0xff ? await pdf.embedJpg(Buffer.from(event.logo)) : await pdf.embedPng(Buffer.from(event.logo)))
        : undefined;
  async function embedImage(value: string) {
    const { type, bytes } = imageBytes(value);
    return type === 'png' ? pdf.embedPng(bytes) : pdf.embedJpg(bytes);
  }
  function addPage() {
    page = pdf.addPage([width, height]);
    page.drawRectangle({ x: 0, y: 0, width, height, color: background });
    if (bg) page.drawImage(bg, { x: 0, y: 0, width, height, opacity: 0.12 });
    page.drawRectangle({
      x: 0,
      y: height - 8,
      width,
      height: 8,
      color: accent,
    });
    y = height - 30;
  }
  addPage();
  const clean = (value: string) =>
    value
      .normalize('NFC')
      .replace(
        /[\u0000-\u0008\u000b-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g,
        '',
      );
  function check(value: string) {
    for (const ch of value)
      if (ch !== '\n' && !supported.has(ch.codePointAt(0)!))
        throw new BadRequestException(
          'The ticket font does not support one of the entered characters. Use supported Arabic/Latin text.',
        );
  }
  function drawLine(value: string, size: number, ink = primary) {
    if (y < size + 25) addPage();
    const runs = visualRuns(value),
      total = runs.reduce((sum, r) => sum + font.widthOfTextAtSize(r, size), 0);
    let x = /^[^A-Za-z\u0600-\u06ff]*[\u0600-\u06ff]/u.test(value)
      ? width - margin - total
      : margin;
    for (const run of runs) {
      page.drawText(run, { x, y, font, size, color: ink });
      x += font.widthOfTextAtSize(run, size);
    }
    y -= size * 1.6;
  }
  function text(value: string, size: number, ink = primary) {
    const lineWidth=(v:string)=>visualRuns(v).reduce((sum,r)=>sum+font.widthOfTextAtSize(r,size),0);
    value = clean(value);
    check(value);
    for (const paragraph of value.split('\n')) {
      let line = '';
      for (const word of paragraph.split(/\s+/)) {
        if (!word) continue;
        const candidate = line ? line + ' ' + word : word;
        if (lineWidth(candidate) <= available) {
          line = candidate;
          continue;
        }
        if (line) {
          drawLine(line, size, ink);
          line = '';
        }
        for (const char of word) {
          if (lineWidth(line + char) > available) {
            drawLine(line, size, ink);
            line = '';
          }
          line += char;
        }
      }
      if (line) drawLine(line, size, ink);
    }
  }
  if (customLogo) {
    const scale = Math.min(100 / customLogo.width, 45 / customLogo.height);
    page.drawImage(customLogo, {
      x: margin,
      y: y - 45,
      width: customLogo.width * scale,
      height: customLogo.height * scale,
    });
    y -= 58;
  }
  if (design.heading) text(design.heading, 10);
  if (design.layout === 'banner') {
    page.drawRectangle({
      x: 20,
      y: y - 9,
      width: width - 40,
      height: 35,
      color: accent,
      opacity: 0.18,
    });
  }
  text(event.name, design.layout === 'compact' ? 16 : 19);
  y -= 5;
  text(attendee.fullName, 16);
  y -= 5;
  // Keep the complete QR and white quiet zone on a single page.
  const qrSize = design.layout === 'compact' ? 144 : 176;
  if (y < qrSize + 35) addPage();
  const qr = await pdf.embedPng(await generateQrPng(rawToken));
  page.drawRectangle({
    x: (width - qrSize) / 2 - 4,
    y: y - qrSize - 4,
    width: qrSize + 8,
    height: qrSize + 8,
    color: rgb(1, 1, 1),
  });
  page.drawImage(qr, {
    x: (width - qrSize) / 2,
    y: y - qrSize,
    width: qrSize,
    height: qrSize,
  });
  y -= qrSize + 22;
  for (const row of details(
    event,
    attendee,
    category,
    ticket,
    entrances,
    design,
  )) {
    const needed = 32;
    if (y < needed + 25) addPage();
    if (row.label) text(row.label, 8);
    text(row.value, design.layout === 'compact' ? 9 : 10);
    y -= 5;
  }
  if (design.footer) {
    y -= 8;
    text(design.footer, 8);
  }
  pdf.setTitle(`Ticket ${ticket.number}`);
  pdf.setAuthor('Dream Events');
  return Buffer.from(await pdf.save());
}
