const PDFJS_URL='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.min.mjs';
const PDFJS_WORKER='https://cdnjs.cloudflare.com/ajax/libs/pdf.js/4.10.38/pdf.worker.min.mjs';
let pdfjsPromise=null;

function normalize(s){return String(s||'').replace(/\s+/g,' ').trim()}
function parseARNumber(s){
  if(!s)return 0;
  const x=String(s).replace(/U\$S|USD|\$/gi,'').replace(/\s/g,'').replace(/\./g,'').replace(',','.').replace(/[^\d.-]/g,'');
  return Number(x)||0;
}
function isoDateBrubank(d){const m=/^(\d{2})-(\d{2})-(\d{2})$/.exec(d);if(!m)return '';return `20${m[3]}-${m[2]}-${m[1]}`}
const MONTHS={ENE:1,FEB:2,MAR:3,ABR:4,MAY:5,JUN:6,JUL:7,AGO:8,SEPT:9,SEP:9,OCT:10,NOV:11,DIC:12};
function isoDateNaranja(d,year){const m=/^(\d{2})\/([A-ZÁÉÍÓÚÑ]{3,5})$/i.exec(d);if(!m)return '';const mon=MONTHS[m[2].toUpperCase()];if(!mon)return '';return `${year}-${String(mon).padStart(2,'0')}-${m[1]}`}
function amountText(parts){return normalize(parts.join(' '))}
async function getPdfJs(){if(!pdfjsPromise)pdfjsPromise=import(PDFJS_URL).then(m=>{m.GlobalWorkerOptions.workerSrc=PDFJS_WORKER;return m});return pdfjsPromise}

function groupRows(items){
  const rows=[];
  const sorted=items.map(i=>({x:i.transform[4],y:i.transform[5],str:normalize(i.str)})).filter(i=>i.str).sort((a,b)=>Math.abs(b.y-a.y)>1?b.y-a.y:a.x-b.x);
  for(const it of sorted){
    let row=rows.find(r=>Math.abs(r.y-it.y)<2.2);
    if(!row){row={y:it.y,items:[]};rows.push(row)}
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

function detectBrubankCurrency(rows,current='ARS'){
  const text=rows.map(rowText).join(' ');
  if(/Dólar \(USD\)|Saldo Inicial\s+U\$S|Moneda\s+Dólar/i.test(text))return 'USD';
  if(/Pesos \(ARS\)|Saldo Inicial\s+\$/i.test(text))return 'ARS';return current;
}
function parseBrubankRow(row,currency){
  const items=row.items; const first=items[0]?.str||''; if(!/^\d{2}-\d{2}-\d{2}$/.test(first))return null;
  const date=isoDateBrubank(first);
  const refItem=items.find(i=>i.x>70&&i.x<135&&/^\d{6,}$/.test(i.str)); if(!refItem)return null; const ref=refItem.str;
  const desc=normalize(items.filter(i=>i.x>=130&&i.x<365).map(i=>i.str).join(' '));
  const debitRaw=amountText(items.filter(i=>i.x>=365&&i.x<445).map(i=>i.str));
  const creditRaw=amountText(items.filter(i=>i.x>=445&&i.x<515).map(i=>i.str));
  const balanceRaw=amountText(items.filter(i=>i.x>=510).map(i=>i.str));
  const hasDebit=/\d/.test(debitRaw)&&debitRaw!=='-'; const hasCredit=/\d/.test(creditRaw)&&creditRaw!=='-';
  let type=hasDebit?'debit':hasCredit?'credit':null; let amount=hasDebit?parseARNumber(debitRaw):hasCredit?parseARNumber(creditRaw):0;
  if(!type||!amount){
    const money=items.filter(i=>i.x>350&&/(\$|U\$S|\d+[.,]\d{2})/.test(i.str));
    const groups=[]; for(const m of money){let g=groups.find(q=>Math.abs(q.x-m.x)<28);if(!g){g={x:m.x,p:[]};groups.push(g)}g.p.push(m.str)}groups.sort((a,b)=>a.x-b.x);
    if(groups.length>=2){const firstAmount=parseARNumber(groups[0].p.join(' '));if(firstAmount){amount=firstAmount;type=groups[0].x<445?'debit':'credit'}}
  }
  if(!type||!amount)return null;
  const internalTransfer=/a una cuenta tuya|compra de d[oó]lares/i.test(desc);
  return {id:'',date,ref,description:desc||'Movimiento',merchant:'',category:'',type,currency,amount,balance:parseARNumber(balanceRaw),source:'Brubank',internalTransfer,internalTransferReason:internalTransfer?'explicit':'',createdAt:new Date().toISOString()};
}

function inferNaranjaYear(file,metadata){
  const name=String(file?.name||'');
  const ym=/(20\d{2})[-_ ]?(0[1-9]|1[0-2])/.exec(name); if(ym)return Number(ym[1]);
  const cd=metadata?.info?.CreationDate||metadata?.info?.ModDate||'';
  const y=/D:(20\d{2})/.exec(cd)||/(20\d{2})/.exec(cd); if(y)return Number(y[1]);
  return new Date().getFullYear();
}
function detectNaranjaCurrency(rows,current='ARS'){
  const text=rows.map(rowText).join(' ');
  if(/Datos cuenta en dólares|Moneda\s+Dólares|Dinero inicial\s+USD/i.test(text))return 'USD';
  if(/Datos cuenta en pesos|Moneda\s+Pesos|Dinero inicial\s+\$/i.test(text))return 'ARS';
  return current;
}
function parseNaranjaBlocks(rows,currency,year){
  const txs=[];
  for(let i=0;i<rows.length;i++){
    const items=rows[i].items; const first=items[0]?.str||'';
    if(!/^\d{2}\/[A-ZÁÉÍÓÚÑ]{3,5}$/i.test(first))continue;
    const date=isoDateNaranja(first,year); if(!date)continue;
    const refItem=items.find(x=>x.x>=105&&x.x<180&&/^\d{8,}$/.test(x.str)); if(!refItem)continue;
    const ref=refItem.str;
    const descParts=items.filter(x=>x.x>=176&&x.x<330).map(x=>x.str);
    for(let j=i+1;j<rows.length;j++){
      const next=rows[j], nextFirst=next.items[0]?.str||'';
      if(/^\d{2}\/[A-ZÁÉÍÓÚÑ]{3,5}$/i.test(nextFirst)||/^Dinero final$/i.test(rowText(next)))break;
      const continuation=next.items.filter(x=>x.x>=176&&x.x<330).map(x=>x.str);
      if(continuation.length)descParts.push(...continuation);
      if(next.items.some(x=>x.x<170||x.x>=330)&&!continuation.length)break;
      if(j-i>3)break;
    }
    const description=normalize(descParts.join(' '))||'Movimiento';
    const incomeRaw=amountText(items.filter(x=>x.x>=330&&x.x<400).map(x=>x.str));
    const expenseRaw=amountText(items.filter(x=>x.x>=400&&x.x<465).map(x=>x.str));
    const balanceRaw=amountText(items.filter(x=>x.x>=465).map(x=>x.str));
    const income=parseARNumber(incomeRaw),expense=parseARNumber(expenseRaw);
    const type=income?'credit':expense?'debit':null; const amount=income||expense;
    if(!type||!amount)continue;
    const internalTransfer=/compra de d[oó]lar oficial.*transferencia (desde|a) tu cuenta/i.test(description);
    txs.push({id:'',date,ref,description,merchant:'',category:'',type,currency,amount,balance:parseARNumber(balanceRaw),source:'Naranja X',internalTransfer,internalTransferReason:internalTransfer?'explicit':'',createdAt:new Date().toISOString()});
  }
  return txs;
}

export async function parseBankPdf(file,onProgress=()=>{}){
  const pdfjs=await getPdfJs(); const buf=await file.arrayBuffer(); const doc=await pdfjs.getDocument({data:buf}).promise;
  const pageRows=[];
  for(let p=1;p<=doc.numPages;p++){
    onProgress(`Leyendo página ${p} de ${doc.numPages}…`);
    const page=await doc.getPage(p); const tc=await page.getTextContent(); pageRows.push(groupRows(tc.items));
  }
  const rawText=documentText(pageRows); const bank=detectBank(rawText);
  if(!bank)throw new Error('Formato bancario no reconocido. Actualmente se admiten Brubank y Naranja X.');
  let metadata={}; try{metadata=await doc.getMetadata()}catch{}
  const txs=[];
  if(bank==='Brubank'){
    let currency='ARS';
    for(const rows of pageRows){currency=detectBrubankCurrency(rows,currency);for(const row of rows){const tx=parseBrubankRow(row,currency);if(tx)txs.push(tx)}}
  }else{
    let currency='ARS'; const year=inferNaranjaYear(file,metadata);
    for(const rows of pageRows){currency=detectNaranjaCurrency(rows,currency);txs.push(...parseNaranjaBlocks(rows,currency,year))}
  }
  let period='';
  if(txs.length){period=txs.map(t=>t.date.slice(0,7)).sort()[0]}
  return {transactions:txs,period,pages:doc.numPages,rawText,bank};
}

export const parseBrubankPdf=parseBankPdf;
