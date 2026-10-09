// Reconstrucción prudente de la apertura a partir de saldos declarados en los PDF.
// Nunca modifica la bóveda: devuelve una propuesta derivada de movimientos locales.
const BANKS=new Set(['Brubank','Naranja X']);
const SUPPORTED=new Set(['ARS','USD']);
const isFx=t=>!!t.fxLeg||/(?:compra|venta) de d[oó]lar(?:es)?/i.test(t.description||'');
const round=n=>Math.round((n+Number.EPSILON)*100)/100;

function completeInternalPair(t,transactions){
  return transactions.some(o=>o!==t&&o.source!==t.source&&o.date===t.date&&
    o.currency===t.currency&&o.type!==t.type&&Math.abs(o.amount-t.amount)<=0.01&&
    o.internalTransfer&&!isFx(o));
}

export function inferOpeningFromBankStatements(transactions=[]){
  const input=Array.isArray(transactions)?transactions:[];
  const entries=input.map((t,i)=>({...t,_index:i})).filter(t=>
    BANKS.has(t.source)&&SUPPORTED.has(t.currency)&&/^\d{4}-\d{2}-\d{2}$/.test(t.date)&&
    (t.type==='debit'||t.type==='credit')&&Number.isFinite(Number(t.amount))&&Number(t.amount)>0);
  if(!entries.length)return {reliable:false,reason:'Sin movimientos bancarios con saldos.',accountCount:0};
  const groups=new Map();
  for(const t of entries){
    const key=t.source+'|'+t.currency;
    if(!groups.has(key))groups.set(key,[]);
    groups.get(key).push(t);
  }
  let earliest='',accountCount=0;
  const available={ARS:0,USD:0};
  for(const [key,account] of groups){
    account.sort((a,b)=>a.date.localeCompare(b.date)||a._index-b._index);
    earliest=earliest ? (account[0].date.slice(0,7)<earliest ? account[0].date.slice(0,7):earliest) : account[0].date.slice(0,7);
    let cumulative=0;
    const candidates=[];
    for(const t of account){
      cumulative+=t.type==='credit'?Number(t.amount):-Number(t.amount);
      // El parser usa balance=0 cuando la celda del PDF falta, por eso
      // no se toma 0 como saldo confiable sin una señal adicional.
      const b=Number(t.balance);
      if(Number.isFinite(b)&&b!==0)candidates.push(round(b-cumulative));
    }
    if(!candidates.length || candidates.length<Math.ceil(account.length*0.75))
      return {reliable:false,reason:'Faltan saldos bancarios verificables en '+key,accountCount:groups.size};
    const base=candidates[0];
    if(candidates.some(x=>Math.abs(x-base)>0.05))
      return {reliable:false,reason:'Los saldos del PDF no concilian en '+key,accountCount:groups.size};
    available[account[0].currency]=round(available[account[0].currency]+base);
    accountCount++;
  }
  // No se deduce un patrimonio total de una salida hacia otra cuenta no
  // importada. Se solicita un segundo PDF o se presenta saldo estimado.
  for(const t of entries){
    if(t.internalTransfer&&!t.savingsAction&&!isFx(t)&&!completeInternalPair(t,entries)){
      return {reliable:false,reason:'Hay transferencias hacia otras cuentas sin la contrapartida bancaria.',accountCount};
    }
  }
  const earlierManual=input.some(t=>!BANKS.has(t.source)&&typeof t.date==='string'&&t.date.slice(0,7)<earliest);
  if(earlierManual)
    return {reliable:false,reason:'Hay movimientos manuales anteriores al primer PDF bancario.',accountCount};
  return {
    reliable:true,accountCount,startMonth:earliest,
    opening:{
      confirmed:true,startMonth:earliest,available,savings:{ARS:0,USD:0},
      source:'bank-pdf-auto'
    },
    reason:'Apertura reconstruida desde los saldos de '+accountCount+' cuenta(s) en PDF.'
  };
}
