// DólarApi: cotización informativa de mercado; no refleja necesariamente tu banco.
// Nunca se envían importes, saldos, movimientos ni datos de la bóveda al servicio.
export const DOLLAR_ENDPOINTS={
  oficial:'https://dolarapi.com/v1/dolares/oficial',
  bolsa:'https://dolarapi.com/v1/dolares/bolsa',
  blue:'https://dolarapi.com/v1/dolares/blue'
};
export function normalizeDollarQuote(raw,market='oficial'){
  const compra=Number(raw?.compra),venta=Number(raw?.venta);
  if(!Number.isFinite(compra)||!Number.isFinite(venta)||compra<=0||venta<=0)
    throw new Error('La cotización recibida no es válida.');
  const updated=new Date(raw.fechaActualizacion || 0);
  if(!Number.isFinite(updated.getTime()))
    throw new Error('Fecha de cotización inválida.');
  return {market,compra,venta,updatedAt:updated.toISOString(),name:String(raw.nombre||market),source:'DolarAPI'};
}
export async function fetchDollarQuote(market='oficial',fetchImpl=fetch){
  const url=DOLLAR_ENDPOINTS[market];
  if(!url)throw new Error('Mercado de cambio inválido.');
  const controller=new AbortController();
  const timeout=setTimeout(()=>controller.abort(),9000);
  try{
    const response=await fetchImpl(url,{cache:'no-store',signal:controller.signal,headers:{Accept:'application/json'}});
    if(!response.ok)throw new Error('Cotización no disponible (HTTP '+response.status+').');
    return normalizeDollarQuote(await response.json(),market);
  }finally{clearTimeout(timeout)}
}
export function isFreshQuote(q,at=Date.now(),hours=24){
  const date=Date.parse(q?.updatedAt||'');
  return Number.isFinite(date)&&date<=at+300000&&at-date<hours*3600000;
}
export function pesoCost(usd,rate){
  const u=Number(usd),r=Number(rate);
  if(!Number.isFinite(u)||u<=0||!Number.isFinite(r)||r<=0)return NaN;
  return Math.round((u*r+Number.EPSILON)*100)/100;
}
export function createDollarPurchase({date,usd,pesos,rate,market='oficial',source='Manual FX',quotedAt='',group='',ids=[]}){
  if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z')))
    throw new Error('Fecha inválida.');
  const amountUSD=Number(usd),amountARS=Number(pesos),quoteRate=Number(rate);
  if(!(Number.isFinite(amountUSD)&&amountUSD>0&&Number.isFinite(amountARS)&&amountARS>0&&Number.isFinite(quoteRate)&&quoteRate>0))
    throw new Error('Importes y cotización deben ser mayores a cero.');
  if(!['oficial','bolsa','blue','manual'].includes(market))throw new Error('Mercado inválido.');
  const fxGroup=group||crypto.randomUUID();
  const common={date,description:'Compra de dólares',merchant:'Cambio ARS → USD',category:'Transferencias',source,
    balance:0,ref:'',savingsAction:null,internalTransfer:true,internalTransferReason:'fx',
    fxGroup,fxRate:quoteRate,fxMarket:market,fxQuotedAt:quotedAt||null,createdAt:new Date().toISOString()};
  return [
    {...common,id:ids[0]||crypto.randomUUID(),type:'debit',currency:'ARS',amount:Math.round(amountARS*100)/100,fxLeg:'out'},
    {...common,id:ids[1]||crypto.randomUUID(),type:'credit',currency:'USD',amount:Math.round(amountUSD*100)/100,fxLeg:'in'}
  ];
}
// Al importar el PDF bancario, sus movimientos reales sustituyen los dos apuntes
// manuales cuando coinciden tipo, moneda, importe y fecha. Cada pierna se concilia
// individualmente, sin modificar ni borrar otros movimientos históricos.
export function reconcileImportedFx(existing,imported){
  const removeIds=new Set();
  const used=new Set();
  let reconciled=0;
  for(const t of imported){
    const isFx=/\b(?:compra|venta) de d[oó]lar(?:es)?\b/i.test(t.description||'');
    if(!isFx||!t.internalTransfer)continue;
    const old=existing.find(x=>x.source==='Manual FX'&&x.fxGroup&&!used.has(x.id)&&
      x.date===t.date&&x.currency===t.currency&&x.type===t.type&&
      Math.abs(x.amount-t.amount)<=0.01&&x.fxLeg);
    if(!old)continue;
    used.add(old.id);removeIds.add(old.id);reconciled++;
    for(const k of ['fxGroup','fxLeg','fxRate','fxMarket','fxQuotedAt'])t[k]=old[k];
    t.internalTransfer=true;t.internalTransferReason='fx';
  }
  return {removeIds,reconciled};
}
