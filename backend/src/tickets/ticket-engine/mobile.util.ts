import { generateQrPng } from './qr.util.js';
import {
  defaultDesign,
  escapeHtml as esc,
  type TicketDesign,
} from './design.js';
import { details } from './content.js';
export async function generateMobileTicket(
  event: any,
  attendee: any,
  category: any,
  ticket: any,
  rawToken: string,
  entrances: any[],
  design: TicketDesign = defaultDesign,
): Promise<Buffer> {
  const qr = await generateQrPng(rawToken),
    logo = design.showLogo
      ? design.logo ||
        (event.logo
          ? `data:image/${Buffer.from(event.logo)[0]===0xff?'jpeg':'png'};base64,${Buffer.from(event.logo).toString('base64')}`
          : null)
      : null;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="no-referrer"><title>Ticket ${esc(ticket.number)}</title>
  <style>body{margin:0;background:#f3f5f7;font:16px/1.5 Arial,sans-serif;color:${design.primaryColor}}main{position:relative;isolation:isolate;max-width:460px;margin:24px auto;padding:24px;background:${design.backgroundColor};border-top:6px solid ${design.accentColor};overflow-wrap:anywhere}main:before{content:"";position:absolute;inset:0;opacity:.12;z-index:-1;background-image:${design.background ? `url("${design.background}")` : 'none'};background-size:cover}h1{font-size:${design.layout === 'compact' ? 22 : 26}px;${design.layout === 'banner' ? `background:${design.accentColor}22;padding:12px` : ''}}.name{font-size:23px}.qr{display:block;width:${design.layout === 'compact' ? 240 : 280}px;max-width:100%;margin:20px auto;background:white}.logo{max-width:120px;max-height:65px}dt{font-size:12px;margin-top:12px}dd{margin:0;white-space:pre-wrap}footer{margin-top:24px;font-size:12px;white-space:pre-wrap}@media print{main{margin:0}body{background:white}}</style></head>
  <body><main>${logo ? `<img class="logo" alt="Event logo" src="${logo}">` : ''}${design.heading ? `<p dir="auto">${esc(design.heading)}</p>` : ''}<h1 dir="auto">${esc(event.name)}</h1><p class="name" dir="auto">${esc(attendee.fullName)}</p><img class="qr" alt="Entry QR code" src="data:image/png;base64,${qr.toString('base64')}"><dl>${details(
    event,
    attendee,
    category,
    ticket,
    entrances,
    design,
  )
    .map((r) => `<dt>${esc(r.label)}</dt><dd dir="auto">${esc(r.value)}</dd>`)
    .join(
      '',
    )}</dl><footer dir="auto">${esc(design.footer)}</footer></main></body></html>`;
  return Buffer.from(html, 'utf8');
}
