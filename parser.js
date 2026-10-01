const PDFJS_URL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
const PDFJS_WORKER='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
let pdfjsPromise=null;

function normalize(s){return String(s||'').replace(/\s+/g,' ').trim()}
function fold(s){return normalize(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase()}
function parseARNumber(s){
  if(!s)return 0;
  let x=String(s).replace(/U\$S|USD|ARS|\$/gi,'').replace(/\s/g,'');
  if(/,\d{1,2}$/.test(x))x=x.replace(/\./g,'').replace(',','.');
  else if(/\.\d{1,2}$/.test(x)&&x.includes(','))x=x.replace(/,/g,'');
  else x=x.replace(/\./g,'').replace(',','.');
  x=x.replace(/[^\d.-]/g,'');
  return Number(x)||0;
}
function amountText(parts){return normalize(parts.join(' '))}
async function getPdfJs(){if(!pdfjsPromise)pdfjsPromise=import(PDFJS_URL).then(m=>{m.GlobalWorkerOptions.workerSrc=PDFJS_WORKER;return m});return pdfjsPromise}

const MONTHS={ENE:1,ENERO:1,FEB:2,FEBRERO:2,MAR:3,MARZO:3,ABR:4,ABRIL:4,MAY:5,MAYO:5,JUN:6,JUNIO:6,JUL:7,JULIO:7,AGO:8,AGOST:8,AGOSTO:8,SEP:9,SEPT:9,SET:9,SEPTIEMBRE:9,OCT:10,OCTUBRE:10,NOV:11,NOVIEMBRE:11,DIC:12,DICIEMBRE:12};
function monthNumber(token){const t=fold(token).replace(/[^A-Z0-9]/g,'');if(/^\d{1,2}$/.test(t)){const n=Number(t);return n>=1&&n<=12?n:0}return MONTHS[t]||0}
function isoDateBrubank(d){const m=/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/.exec(d);if(!m)return '';let y=Number(m[3]);if(y<100)y+=2000;return `${y}-${String(Number(m[2])).padStart(2,'0')}-${String(Number(m[1])).padStart(2,'0')}`}
function isoDateNaranja(d,year){const m=/^(\d{1,2})\/([A-ZÁÉÍÓÚÑ0-9]{1,12})(?:\/(\d{2,4}))?$/i.exec(d);if(!m)return '';const mon=monthNumber(m[2]);if(!mon)return '';let y=m[3]?Number(m[3]):Number(year);if(y<100)y+=2000;if(!y)return '';return `${y}-${String(mon).padStart(2,'0')}-${String(Number(m[1])).padStart(2,'0')}`}

function groupRows(items,width=595){
  const rows=[];
  const sorted=items.map(i=>({x:i.transform[4],y:i.transform[5],str:normalize(i.str)})).filter(i=>i.str).sort((a,b)=>Math.abs(b.y-a.y)>1?b.y-a.y:a.x-b.x);
  for(const it of sorted){let row=rows.find(r=>Math.abs(r.y-it.y)<2.4);if(!row){row={y:it.y,width,items:[]};rows.push(row)}row.items.push(it)}
  rows.sort((a,b)=>b.y-a.y);rows.forEach(r=>r.items.sort((a,b)=>a.x-b.x));return rows;
}
function rowText(row){return normalize(row.items.map(i=>i.str).join(' '))}
function documentText(pageRows){return pageRows.flatMap(rows=>rows.map(rowText)).join('\n')}
function detectBank(rawText){
  const t=fold(rawText);
  const brubankStrong=/MI CUENTA\s+RESUMEN/.test(t)||/BRUBANK\s+S\.?A\.?U?\.?/.test(t)||(/FECHA\s+#?REF\s+DESCRIPCION\s+DEBITO\s+CREDITO\s+SALDO/.test(t)&&/MONEDA\s+(PESOS|DOLAR)/.test(t));
  if(brubankStrong)return 'Brubank';
  const naranjaStrong=/NARANJA DIGITAL/.test(t)||/DATOS CUENTA EN (PESOS|DOLARES)/.test(t)||(/OPERACION/.test(t)&&/DINERO A LA FECHA/.test(t)&&/RESUMEN DEL MES/.test(t));
  if(naranjaStrong)return 'Naranja X';
  return '';
}
function currencySignal(text,current='ARS'){const t=fold(text);if(/DATOS CUENTA EN DOLARES|MONEDA DOLARES|DOLAR \(USD\)|MONEDA DOLAR|SALDO INICIAL U\$S|DINERO INICIAL USD/.test(t))return 'USD';if(/DATOS CUENTA EN PESOS|MONEDA PESOS|PESOS \(ARS\)|MONEDA PESOS \(ARS\)|SALDO INICIAL \$|DINERO INICIAL \$/.test(t))return 'ARS';return current}

function findHeaderX(row,rx){const it=row.items.find(i=>rx.test(fold(i.str)));return it?.x??null}
function brubankLayoutFromHeader(row,prev=null){
  const t=fold(rowText(row));if(!/FECHA/.test(t)||!/DESCRIPCION/.test(t)||!/DEBITO/.test(t)||!/CREDITO/.test(t)||!/SALDO/.test(t))return prev;
  const x={date:findHeaderX(row,/^FECHA$/),ref:findHeaderX(row,/REF/),desc:findHeaderX(row,/DESCRIPCION/),debit:findHeaderX(row,/DEBITO/),credit:findHeaderX(row,/CREDITO/),balance:findHeaderX(row,/SALDO/)};
  if([x.date,x.ref,x.desc,x.debit,x.credit,x.balance].some(v=>v==null))return prev;
  const debitStart=x.debit-Math.max(18,(x.credit-x.debit)*.46);
  return {...x,debitStart,creditStart:(x.debit+x.credit)/2,balanceStart:(x.credit+x.balance)/2};
}
function defaultBrubankLayout(w){return {date:w*.052,ref:w*.123,desc:w*.228,debit:w*.684,credit:w*.794,balance:w*.916,debitStart:w*.61,creditStart:w*.745,balanceStart:w*.855}}
function parseBrubankRow(row,currency,layout){
  const items=row.items,w=row.width||595,L=layout||defaultBrubankLayout(w);
  const dateItem=items.find(i=>i.x<w*.2&&/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$/.test(i.str));if(!dateItem)return null;
  const date=isoDateBrubank(dateItem.str);if(!date)return null;
  const numeric=items.filter(i=>/^\d{6,15}$/.test(i.str));
  let refItem=numeric.filter(i=>i.x>dateItem.x+20&&i.x<(L.desc??w*.3)).sort((a,b)=>Math.abs(a.x-L.ref)-Math.abs(b.x-L.ref))[0];
  if(!refItem)refItem=numeric.sort((a,b)=>Math.abs(a.x-L.ref)-Math.abs(b.x-L.ref))[0];
  if(!refItem)return null;
  const ref=refItem.str;
  const descStart=Math.min((L.desc??w*.22)-8,refItem.x+30),descEnd=Math.max(descStart+20,(L.debitStart??w*.61)-4);
  const desc=normalize(items.filter(i=>i.x>=descStart&&i.x<descEnd).map(i=>i.str).join(' '));
  const debitRaw=amountText(items.filter(i=>i.x>=L.debitStart&&i.x<L.creditStart).map(i=>i.str));
  const creditRaw=amountText(items.filter(i=>i.x>=L.creditStart&&i.x<L.balanceStart).map(i=>i.str));
  const balanceRaw=amountText(items.filter(i=>i.x>=L.balanceStart).map(i=>i.str));
  const debit=parseARNumber(debitRaw),credit=parseARNumber(creditRaw);
  let type=debit?'debit':credit?'credit':null,amount=debit||credit;
  if(!type||!amount){
    const money=[];
    for(const it of items.filter(i=>i.x>w*.55&&/(U\$S|USD|\$|\d+[.,]\d{1,2})/i.test(i.str))){let g=money.find(q=>Math.abs(q.x-it.x)<28);if(!g){g={x:it.x,p:[]};money.push(g)}g.p.push(it.str)}
    money.sort((a,b)=>a.x-b.x);
    for(const g of money){const n=parseARNumber(g.p.join(' '));if(!n)continue;if(g.x<L.creditStart){type='debit';amount=n;break}if(g.x<L.balanceStart){type='credit';amount=n;break}}
  }
  if(!type||!amount)return null;
  const internalTransfer=/a una cuenta tuya|compra de d[oó]lares/i.test(desc);
  return {id:'',date,ref,description:desc||'Movimiento',merchant:'',category:'',type,currency,amount,balance:parseARNumber(balanceRaw),source:'Brubank',internalTransfer,internalTransferReason:internalTransfer?'explicit':'',createdAt:new Date().toISOString()};
}

function periodFromFilename(name){const s=String(name||'');let m=/(20\d{2})[-_ .]?(0[1-9]|1[0-2])/.exec(s);if(m)return {year:Number(m[1]),month:Number(m[2])};m=/(0[1-9]|1[0-2])[-_ .]?(20\d{2})/.exec(s);if(m)return {year:Number(m[2]),month:Number(m[1])};return {year:0,month:0}}
function periodFromText(rawText){const t=fold(rawText);let m=/RESUMEN DEL MES DE ([A-Z]+)(?:\s+DE\s+(20\d{2}))?/.exec(t);if(m)return {year:m[2]?Number(m[2]):0,month:monthNumber(m[1])};m=/DINERO INICIAL DEL \d{1,2}\/([A-Z0-9]+)/.exec(t);if(m)return {year:0,month:monthNumber(m[1])};return {year:0,month:0}}
function inferNaranjaPeriod(file,metadata,rawText){const byName=periodFromFilename(file?.name),byText=periodFromText(rawText);let year=byName.year||byText.year||0,month=byName.month||byText.month||0;const cd=metadata?.info?.CreationDate||metadata?.info?.ModDate||'';const y=/D:(20\d{2})/.exec(cd)||/(20\d{2})/.exec(cd);if(!year&&y)year=Number(y[1]);const now=new Date();if(!year){year=now.getFullYear();if(month&&month>now.getMonth()+2)year--}return {year,month}}
function isNaranjaDateToken(s){return /^\d{1,2}\/[A-ZÁÉÍÓÚÑ0-9]{1,12}(?:\/\d{2,4})?$/i.test(s||'')}
function parseNaranjaRow(rows,currency,year,startIndex){
  const row=rows[startIndex],items=row.items,w=row.width||595,first=items[0]?.str||'';if(!isNaranjaDateToken(first))return null;
  const date=isoDateNaranja(first,year);if(!date)return null;
  const refItem=items.find(x=>x.x>=w*.16&&x.x<w*.31&&/^\d{8,}$/.test(x.str));if(!refItem)return null;
  const ref=refItem.str,descParts=items.filter(x=>x.x>=w*.285&&x.x<w*.56).map(x=>x.str);
  for(let j=startIndex+1;j<rows.length&&j<=startIndex+4;j++){const next=rows[j],nextFirst=next.items[0]?.str||'',txt=rowText(next);if(isNaranjaDateToken(nextFirst)||/^Dinero final$/i.test(txt))break;const continuation=next.items.filter(x=>x.x>=w*.285&&x.x<w*.56).map(x=>x.str);if(continuation.length)descParts.push(...continuation);if(next.items.some(x=>x.x<w*.27||x.x>=w*.56)&&!continuation.length)break}
  const description=normalize(descParts.join(' '))||'Movimiento';
  const income=parseARNumber(amountText(items.filter(x=>x.x>=w*.55&&x.x<w*.68).map(x=>x.str))),expense=parseARNumber(amountText(items.filter(x=>x.x>=w*.67&&x.x<w*.79).map(x=>x.str))),balance=parseARNumber(amountText(items.filter(x=>x.x>=w*.78).map(x=>x.str)));
  let type=income?'credit':expense?'debit':null,amount=income||expense;
  if(!type||!amount){const groups=[];for(const it of items.filter(x=>x.x>=w*.54&&/(\$|USD|\d+[.,]\d{2})/i.test(x.str))){let g=groups.find(q=>Math.abs(q.x-it.x)<w*.04);if(!g){g={x:it.x,p:[]};groups.push(g)}g.p.push(it.str)}groups.sort((a,b)=>a.x-b.x);for(const g of groups){const n=parseARNumber(g.p.join(' '));if(!n)continue;if(g.x<w*.69){type='credit';amount=n;break}if(g.x<w*.81){type='debit';amount=n;break}}}
  if(!type||!amount)return null;
  const internalTransfer=/compra de d[oó]lar oficial.*transferencia (desde|a) tu cuenta/i.test(description);
  return {id:'',date,ref,description,merchant:'',category:'',type,currency,amount,balance,source:'Naranja X',internalTransfer,internalTransferReason:internalTransfer?'explicit':'',createdAt:new Date().toISOString()};
}
function dominantPeriod(txs){const counts={};for(const t of txs){const k=t.date.slice(0,7);counts[k]=(counts[k]||0)+1}return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0]||''}

export async function parseBankPdf(file,onProgress=()=>{}){
  const pdfjs=await getPdfJs(),buf=await file.arrayBuffer(),doc=await pdfjs.getDocument({data:buf}).promise,pageRows=[];
  for(let p=1;p<=doc.numPages;p++){onProgress(`Leyendo página ${p} de ${doc.numPages}…`);const page=await doc.getPage(p),vp=page.getViewport({scale:1}),tc=await page.getTextContent();pageRows.push(groupRows(tc.items,vp.width))}
  const rawText=documentText(pageRows),bank=detectBank(rawText);if(!bank)throw new Error('Formato bancario no reconocido. Actualmente se admiten Brubank y Naranja X.');
  let metadata={};try{metadata=await doc.getMetadata()}catch{}
  const txs=[],warnings=[];
  if(bank==='Brubank'){
    let currency='ARS',layout=null,candidates=0;
    for(const rows of pageRows){
      for(const row of rows){const txt=rowText(row);currency=currencySignal(txt,currency);layout=brubankLayoutFromHeader(row,layout);if(/^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b/.test(txt))candidates++;const tx=parseBrubankRow(row,currency,layout);if(tx)txs.push(tx)}
    }
    if(candidates&&txs.length<candidates*.8)warnings.push(`Brubank: se pudieron leer ${txs.length} de ${candidates} filas con fecha. El resumen usa una variante de formato.`);
  }else{
    const periodInfo=inferNaranjaPeriod(file,metadata,rawText);let currency='ARS';
    for(const rows of pageRows){for(let i=0;i<rows.length;i++){currency=currencySignal(rowText(rows[i]),currency);const tx=parseNaranjaRow(rows,currency,periodInfo.year,i);if(tx)txs.push(tx)}}
    if(periodInfo.month){const expected=`${periodInfo.year}-${String(periodInfo.month).padStart(2,'0')}`,matches=txs.filter(t=>t.date.startsWith(expected));if(matches.length&&matches.length!==txs.length){warnings.push(`Se descartaron ${txs.length-matches.length} filas fuera del período ${expected}.`);txs.splice(0,txs.length,...matches)}}
  }
  const period=dominantPeriod(txs);if(!txs.length)throw new Error(`Se reconoció ${bank}, pero no se pudieron extraer movimientos. El formato de este resumen puede ser diferente.`);
  return {transactions:txs,period,pages:doc.numPages,rawText,bank,warnings};
}
export const parseBrubankPdf=parseBankPdf;