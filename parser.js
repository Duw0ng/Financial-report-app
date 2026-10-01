const PDFJS_URL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
const PDFJS_WORKER='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
let pdfjsPromise=null;

function normalize(s){return String(s||'').replace(/\s+/g,' ').trim()}
function fold(s){return normalize(s).normalize('NFD').replace(/[\u0300-\u036f]/g,'').toUpperCase()}
function parseARNumber(s){
  if(!s)return 0;
  const x=String(s).replace(/U\$S|USD|\$/gi,'').replace(/\s/g,'').replace(/\./g,'').replace(',','.').replace(/[^\d.-]/g,'');
  return Number(x)||0;
}
function amountText(parts){return normalize(parts.join(' '))}
async function getPdfJs(){if(!pdfjsPromise)pdfjsPromise=import(PDFJS_URL).then(m=>{m.GlobalWorkerOptions.workerSrc=PDFJS_WORKER;return m});return pdfjsPromise}

const MONTHS={
  ENE:1,ENERO:1,FEB:2,FEBRERO:2,MAR:3,MARZO:3,ABR:4,ABRIL:4,MAY:5,MAYO:5,
  JUN:6,JUNIO:6,JUL:7,JULIO:7,AGO:8,AGOST:8,AGOSTO:8,SEP:9,SEPT:9,SET:9,SEPTIEMBRE:9,
  OCT:10,OCTUBRE:10,NOV:11,NOVIEMBRE:11,DIC:12,DICIEMBRE:12
};
function monthNumber(token){
  if(!token)return 0;
  const t=fold(token).replace(/[^A-Z0-9]/g,'');
  if(/^\d{1,2}$/.test(t)){const n=Number(t);return n>=1&&n<=12?n:0}
  return MONTHS[t]||0;
}
function isoDateBrubank(d){
  const m=/^(\d{2})[-/](\d{2})[-/](\d{2,4})$/.exec(d);if(!m)return '';
  const y=m[3].length===2?`20${m[3]}`:m[3];return `${y}-${m[2]}-${m[1]}`;
}
function isoDateNaranja(d,year){
  const m=/^(\d{1,2})\/([A-ZÁÉÍÓÚÑ0-9]{1,12})(?:\/(\d{2,4}))?$/i.exec(d);if(!m)return '';
  const mon=monthNumber(m[2]);if(!mon)return '';
  let y=m[3]?Number(m[3]):Number(year);if(y<100)y+=2000;if(!y)return '';
  return `${y}-${String(mon).padStart(2,'0')}-${String(Number(m[1])).padStart(2,'0')}`;
}

function groupRows(items,width=595){
  const rows=[];
  const sorted=items.map(i=>({x:i.transform[4],y:i.transform[5],str:normalize(i.str)})).filter(i=>i.str).sort((a,b)=>Math.abs(b.y-a.y)>1?b.y-a.y:a.x-b.x);
  for(const it of sorted){
    let row=rows.find(r=>Math.abs(r.y-it.y)<2.2);
    if(!row){row={y:it.y,width,items:[]};rows.push(row)}
    row.items.push(it);
  }
  rows.sort((a,b)=>b.y-a.y);rows.forEach(r=>r.items.sort((a,b)=>a.x-b.x));return rows;
}
function rowText(row){return normalize(row.items.map(i=>i.str).join(' '))}
function documentText(pageRows){return pageRows.flatMap(rows=>rows.map(rowText)).join('\n')}

function detectBank(rawText){
  if(/Naranja\s*X|NaranjaX|Naranja Digital|Datos cuenta en pesos/i.test(rawText))return 'Naranja X';
  if(/Brubank|Mi cuenta Resumen|Cobro percepcion IVA Serv\.Dig/i.test(rawText))return 'Brubank';
  return '';
}

function currencySignal(text,current='ARS'){
  const t=fold(text);
  if(/DATOS CUENTA EN DOLARES|MONEDA DOLARES|DOLAR \(USD\)|MONEDA DOLAR|SALDO INICIAL U\$S|DINERO INICIAL USD/.test(t))return 'USD';
  if(/DATOS CUENTA EN PESOS|MONEDA PESOS|PESOS \(ARS\)|SALDO INICIAL \$|DINERO INICIAL \$/.test(t))return 'ARS';
  return current;
}

function parseBrubankRow(row,currency){
  const items=row.items,w=row.width||595;const first=items[0]?.str||'';
  if(!/^\d{2}[-/]\d{2}[-/]\d{2,4}$/.test(first))return null;
  const date=isoDateBrubank(first);if(!date)return null;
  const refItem=items.find(i=>i.x>w*.11&&i.x<w*.24&&/^\d{6,}$/.test(i.str));if(!refItem)return null;
  const ref=refItem.str;
  const desc=normalize(items.filter(i=>i.x>=w*.215&&i.x<w*.615).map(i=>i.str).join(' '));
  const debitRaw=amountText(items.filter(i=>i.x>=w*.61&&i.x<w*.75).map(i=>i.str));
  const creditRaw=amountText(items.filter(i=>i.x>=w*.745&&i.x<w*.865).map(i=>i.str));
  const balanceRaw=amountText(items.filter(i=>i.x>=w*.855).map(i=>i.str));
  const hasDebit=/\d/.test(debitRaw)&&debitRaw!=='-';const hasCredit=/\d/.test(creditRaw)&&creditRaw!=='-';
  let type=hasDebit?'debit':hasCredit?'credit':null;let amount=hasDebit?parseARNumber(debitRaw):hasCredit?parseARNumber(creditRaw):0;
  if(!type||!amount){
    const money=items.filter(i=>i.x>w*.58&&/(\$|U\$S|USD|\d+[.,]\d{2})/i.test(i.str));
    const groups=[];
    for(const m of money){let g=groups.find(q=>Math.abs(q.x-m.x)<w*.047);if(!g){g={x:m.x,p:[]};groups.push(g)}g.p.push(m.str)}
    groups.sort((a,b)=>a.x-b.x);
    for(const g of groups){const n=parseARNumber(g.p.join(' '));if(!n)continue;if(g.x<w*.75){type='debit';amount=n;break}if(g.x<w*.86){type='credit';amount=n;break}}
  }
  if(!type||!amount)return null;
  const internalTransfer=/a una cuenta tuya|compra de d[oó]lares/i.test(desc);
  return {id:'',date,ref,description:desc||'Movimiento',merchant:'',category:'',type,currency,amount,balance:parseARNumber(balanceRaw),source:'Brubank',internalTransfer,internalTransferReason:internalTransfer?'explicit':'',createdAt:new Date().toISOString()};
}

function periodFromFilename(name){
  const s=String(name||'');
  let m=/(20\d{2})[-_ .]?(0[1-9]|1[0-2])/.exec(s);if(m)return {year:Number(m[1]),month:Number(m[2])};
  m=/(0[1-9]|1[0-2])[-_ .]?(20\d{2})/.exec(s);if(m)return {year:Number(m[2]),month:Number(m[1])};
  return {year:0,month:0};
}
function periodFromText(rawText){
  const t=fold(rawText);
  let m=/RESUMEN DEL MES DE ([A-Z]+)(?:\s+DE\s+(20\d{2}))?/.exec(t);
  if(m)return {year:m[2]?Number(m[2]):0,month:monthNumber(m[1])};
  m=/DINERO INICIAL DEL \d{1,2}\/([A-Z0-9]+)/.exec(t);
  if(m)return {year:0,month:monthNumber(m[1])};
  return {year:0,month:0};
}
function inferNaranjaPeriod(file,metadata,rawText){
  const byName=periodFromFilename(file?.name);const byText=periodFromText(rawText);
  let year=byName.year||byText.year||0,month=byName.month||byText.month||0;
  const cd=metadata?.info?.CreationDate||metadata?.info?.ModDate||'';
  const y=/D:(20\d{2})/.exec(cd)||/(20\d{2})/.exec(cd);
  if(!year&&y)year=Number(y[1]);
  const now=new Date();
  if(!year){year=now.getFullYear();if(month&&month>now.getMonth()+2)year--}
  return {year,month};
}

function isNaranjaDateToken(s){return /^\d{1,2}\/[A-ZÁÉÍÓÚÑ0-9]{1,12}(?:\/\d{2,4})?$/i.test(s||'')}
function parseNaranjaBlocks(rows,currency,year,startIndex){
  const row=rows[startIndex],items=row.items,w=row.width||595,first=items[0]?.str||'';
  if(!isNaranjaDateToken(first))return null;
  const date=isoDateNaranja(first,year);if(!date)return null;
  const refItem=items.find(x=>x.x>=w*.16&&x.x<w*.31&&/^\d{8,}$/.test(x.str));if(!refItem)return null;
  const ref=refItem.str;const descParts=items.filter(x=>x.x>=w*.285&&x.x<w*.56).map(x=>x.str);
  for(let j=startIndex+1;j<rows.length&&j<=startIndex+4;j++){
    const next=rows[j],nextFirst=next.items[0]?.str||'',txt=rowText(next);
    if(isNaranjaDateToken(nextFirst)||/^Dinero final$/i.test(txt))break;
    const continuation=next.items.filter(x=>x.x>=w*.285&&x.x<w*.56).map(x=>x.str);
    if(continuation.length)descParts.push(...continuation);
    if(next.items.some(x=>x.x<w*.27||x.x>=w*.56)&&!continuation.length)break;
  }
  const description=normalize(descParts.join(' '))||'Movimiento';
  const incomeRaw=amountText(items.filter(x=>x.x>=w*.55&&x.x<w*.68).map(x=>x.str));
  const expenseRaw=amountText(items.filter(x=>x.x>=w*.67&&x.x<w*.79).map(x=>x.str));
  const balanceRaw=amountText(items.filter(x=>x.x>=w*.78).map(x=>x.str));
  let income=parseARNumber(incomeRaw),expense=parseARNumber(expenseRaw);
  if(!income&&!expense){
    const groups=[];for(const it of items.filter(x=>x.x>=w*.54&&/(\$|USD|\d+[.,]\d{2})/i.test(x.str))){let g=groups.find(q=>Math.abs(q.x-it.x)<w*.04);if(!g){g={x:it.x,p:[]};groups.push(g)}g.p.push(it.str)}
    groups.sort((a,b)=>a.x-b.x);
    for(const g of groups){const n=parseARNumber(g.p.join(' '));if(!n)continue;if(g.x<w*.69){income=n;break}if(g.x<w*.81){expense=n;break}}
  }
  const type=income?'credit':expense?'debit':null,amount=income||expense;if(!type||!amount)return null;
  const internalTransfer=/compra de d[oó]lar oficial.*transferencia (desde|a) tu cuenta/i.test(description);
  return {id:'',date,ref,description,merchant:'',category:'',type,currency,amount,balance:parseARNumber(balanceRaw),source:'Naranja X',internalTransfer,internalTransferReason:internalTransfer?'explicit':'',createdAt:new Date().toISOString()};
}

function dominantPeriod(txs){
  const counts={};for(const t of txs){const k=t.date.slice(0,7);counts[k]=(counts[k]||0)+1}
  return Object.entries(counts).sort((a,b)=>b[1]-a[1])[0]?.[0]||'';
}

export async function parseBankPdf(file,onProgress=()=>{}){
  const pdfjs=await getPdfJs();const buf=await file.arrayBuffer();const doc=await pdfjs.getDocument({data:buf}).promise;
  const pageRows=[];
  for(let p=1;p<=doc.numPages;p++){
    onProgress(`Leyendo página ${p} de ${doc.numPages}…`);
    const page=await doc.getPage(p);const vp=page.getViewport({scale:1});const tc=await page.getTextContent();pageRows.push(groupRows(tc.items,vp.width));
  }
  const rawText=documentText(pageRows),bank=detectBank(rawText);if(!bank)throw new Error('Formato bancario no reconocido. Actualmente se admiten Brubank y Naranja X.');
  let metadata={};try{metadata=await doc.getMetadata()}catch{}
  const txs=[];const warnings=[];
  if(bank==='Brubank'){
    let currency='ARS';
    for(const rows of pageRows){
      for(const row of rows){currency=currencySignal(rowText(row),currency);const tx=parseBrubankRow(row,currency);if(tx)txs.push(tx)}
    }
  }else{
    const periodInfo=inferNaranjaPeriod(file,metadata,rawText);let currency='ARS';
    for(const rows of pageRows){
      for(let i=0;i<rows.length;i++){currency=currencySignal(rowText(rows[i]),currency);const tx=parseNaranjaBlocks(rows,currency,periodInfo.year,i);if(tx)txs.push(tx)}
    }
    if(periodInfo.month){
      const expected=`${periodInfo.year}-${String(periodInfo.month).padStart(2,'0')}`;
      const matches=txs.filter(t=>t.date.startsWith(expected));
      if(matches.length&&matches.length!==txs.length){warnings.push(`Se descartaron ${txs.length-matches.length} filas fuera del período ${expected}.`);txs.splice(0,txs.length,...matches)}
    }
  }
  const period=dominantPeriod(txs);
  if(!txs.length)throw new Error(`Se reconoció ${bank}, pero no se pudieron extraer movimientos. El formato de este resumen puede ser diferente; prueba con otro PDF o actualiza el importador.`);
  return {transactions:txs,period,pages:doc.numPages,rawText,bank,warnings};
}

export const parseBrubankPdf=parseBankPdf;
