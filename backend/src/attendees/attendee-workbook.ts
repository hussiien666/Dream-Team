import ExcelJS from 'exceljs';
import { BadRequestException } from '@nestjs/common';
import { boundWorkbook } from '../students/workbook.js';
const headings=['Full name','Email address','Phone number','Student / National ID','Organization','Ticket category','Notes'];
const key=(v:string)=>v.toLowerCase().replace(/[^a-z0-9]/g,'');
const aliases:Record<string,string>={fullname:'fullName',name:'fullName',email:'email',emailaddress:'email',phone:'phone',phonenumber:'phone',mobile:'phone',
  studentnationalid:'identityNumber',studentid:'identityNumber',nationalid:'identityNumber',identitynumber:'identityNumber',organization:'organization',
  ticketcategory:'category',category:'category',categorycode:'category',notes:'notes'};
export type ImportRow={row:number;data:Record<string,string>};
async function attendeeTable(buffer:Buffer,name:string) {
  if(buffer.length>10*1024*1024)throw new BadRequestException('Files must be 10 MB or smaller.');
  const rows:{row:number;cells:unknown[]}[]=[];
  if(name.toLowerCase().endsWith('.csv')) {
    let text:string;try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer).replace(/^\uFEFF/,'');}catch{throw new BadRequestException('Use a readable UTF-8 CSV.');}
    let cell='',cells:string[]=[],quoted=false,closed=false,line=1,start=1;
    const finish=()=>{cells.push(cell);cell='';closed=false;if(cells.length>50)throw new BadRequestException('At most 50 columns are allowed.');};
    for(let i=0;i<text.length;i++) {
      const c=text[i];
      if(quoted){if(c==='"'){if(text[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else{cell+=c;if(c==='\n')line++;}continue;}
      if(c==='"'){if(cell||closed)throw new BadRequestException('Malformed CSV quoting.');quoted=true;continue;}
      if(c===','){finish();continue;}
      if(c==='\r'||c==='\n'){if(c==='\r'&&text[i+1]==='\n')i++;finish();rows.push({row:start,cells});cells=[];line++;start=line;if(rows.length>5001)throw new BadRequestException('At most 5,000 data rows are allowed.');continue;}
      if(closed)throw new BadRequestException('Malformed CSV quoting.');
      if(c==='\0')throw new BadRequestException('Invalid CSV contents.');cell+=c;
    }
    if(quoted)throw new BadRequestException('Unclosed CSV quote.');
    if(cell||cells.length){finish();rows.push({row:start,cells});}
  }else if(name.toLowerCase().endsWith('.xlsx')) {
    boundWorkbook(buffer);const book=new ExcelJS.Workbook();try{await book.xlsx.load(buffer as never);}catch{throw new BadRequestException('Upload a readable workbook.');}
    const sheet=book.getWorksheet('Attendees')??book.worksheets[0];
    if(!sheet||sheet.rowCount>5001||sheet.columnCount>50)throw new BadRequestException('Use at most 5,000 rows and 50 columns.');
    for(let i=1;i<=sheet.rowCount;i++)rows.push({row:i,cells:Array.from({length:sheet.columnCount},(_,j)=>sheet.getCell(i,j+1).value)});
  }else throw new BadRequestException('Upload .xlsx or UTF-8 .csv.');
  if(rows.length<2||rows.length>5001)throw new BadRequestException('Provide 1-5,000 attendee rows.');
  if(rows[0].cells.some(v=>v!==null&&typeof v==='object'))throw new BadRequestException('Use plain text column headings.');
  return rows;
}
export async function attendeeColumns(buffer:Buffer,name:string) {
  const rows=await attendeeTable(buffer,name),headers=rows[0].cells.map(v=>String(v??''));
  const mapping:Record<string,number>={};headers.forEach((h,i)=>{const field=aliases[key(h)];if(field&&mapping[field]===undefined)mapping[field]=i;});
  return {headers,mapping};
}
export async function readAttendees(buffer:Buffer,name:string,mapping?:Record<string,number>):Promise<ImportRow[]> {
  const rows=await attendeeTable(buffer,name);
  const header=rows.shift()!;
  const fields=new Set(Object.values(aliases));
  if(mapping&&(Object.entries(mapping).some(([field,i])=>!fields.has(field)||!Number.isInteger(i)||i<0||i>=header.cells.length)||new Set(Object.values(mapping)).size!==Object.keys(mapping).length))
    throw new BadRequestException('Choose a different valid source column for each field.');
  const columns=header.cells.map((v,i)=>mapping?(Object.keys(mapping).find(field=>mapping[field]===i)??''):(aliases[key(String(v??''))]??''));
  if(!columns.includes('fullName')||columns.filter(Boolean).length!==new Set(columns.filter(Boolean)).size)throw new BadRequestException('Use unique recognized headings including Full name.');
  return rows.filter(r=>r.cells.some(v=>v!==null&&v!==undefined&&String(v).trim()!=='')).map(r=>{
    const data:Record<string,string>={};
    r.cells.forEach((value,j)=>{
      const column=columns[j];
      if(typeof value==='object'&&value!==null) {
        const item=value as {formula?:string;sharedFormula?:string;hyperlink?:string;text?:string;richText?:{text:string}[]};
        if(item.formula||item.sharedFormula)throw new BadRequestException(`Row ${r.row}: replace formulas with plain values.`);
        if(item.hyperlink){if(column!=='email'||item.hyperlink.toLowerCase()!=='mailto:'+String(item.text??'').toLowerCase())throw new BadRequestException(`Row ${r.row}: external cell links are not allowed.`);value=item.text;}
        else if(item.richText)value=item.richText.map(t=>t.text).join('');else throw new BadRequestException(`Row ${r.row}: unsupported cell value.`);
      }
      if(!column)return;
      if(['identityNumber','phone'].includes(column)&&typeof value==='number')throw new BadRequestException(`Row ${r.row}: format IDs and phones as Text before entry.`);
      const text=String(value??'').trim();
      if(/^[=+@-]/.test(text)&&!(column==='phone'&&/^\+?[\d\s().-]+$/.test(text)))throw new BadRequestException(`Row ${r.row}: replace formulas with plain values.`);
      data[column]=text;
    });
    return {row:r.row,data};
  });
}
export async function attendeeTemplate(categories:{name:string;code:string}[]) {
  const book=new ExcelJS.Workbook();book.creator='Dream Events';const sheet=book.addWorksheet('Attendees');sheet.addRow(headings);
  sheet.columns=headings.map((h,i)=>({header:h,width:i===0?30:25}));sheet.getColumn(3).numFmt='@';sheet.getColumn(4).numFmt='@';
  const list=book.addWorksheet('Ticket categories');list.addRow(['Name','Code']);categories.forEach(c=>list.addRow([c.name,c.code]));
  if(categories.length)for(let i=2;i<=5001;i++)sheet.getCell(i,6).dataValidation={type:'list',allowBlank:true,formulae:[`'Ticket categories'!$B$2:$B$${categories.length+1}`]};
  book.addWorksheet('Instructions').addRows([['Enter one person per row. Name and an email or ID are required.'],['Keep IDs and phone numbers as Text. Imports do not issue tickets or send email.']]);
  return Buffer.from(await book.xlsx.writeBuffer());
}
