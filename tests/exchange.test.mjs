import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMonthlyLedger} from '../ledger.js';
import {normalizeDollarQuote,fetchDollarQuote,isFreshQuote,pesoCost,createDollarPurchase,reconcileImportedFx} from '../exchange.js';

const today='2026-10-08';
const opening={confirmed:true,startMonth:'2026-10',available:{ARS:250000,USD:5},savings:{ARS:0,USD:10}};
test('cotización usa precio de venta para comprar USD y fecha de fuente',async()=>{
  const q=await fetchDollarQuote('oficial',async (url,options)=>{
    assert.match(url,/dolares\/oficial$/);
    assert.equal(options.cache,'no-store');
    return {ok:true,json:async()=>({compra:1450,venta:1500,fechaActualizacion:'2026-10-08T17:00:00Z',nombre:'Oficial'})};
  });
  assert.equal(q.compra,1450);
  assert.equal(q.venta,1500);
  assert.equal(pesoCost(20,q.venta),30000);
  assert.equal(isFreshQuote(q,Date.parse('2026-10-08T18:00:00Z')),true);
  assert.equal(isFreshQuote(q,Date.parse('2026-10-12T18:00:00Z')),false);
  assert.throws(()=>normalizeDollarQuote({compra:0,venta:0,fechaActualizacion:'2026-10-08'}));
});
test('compra debita ARS y acredita USD sin ingresos ni gastos',()=>{
 const pair=createDollarPurchase({date:today,usd:20,pesos:30020,rate:1501});
 assert.equal(pair.length,2);
 assert.equal(pair[0].fxGroup,pair[1].fxGroup);
 const r=buildMonthlyLedger(pair,opening,'2026-11').rows;
 assert.equal(r[0].closingAvailable.ARS,219980);
 assert.equal(r[0].closingAvailable.USD,25);
 assert.equal(r[0].total.USD,35);
 assert.equal(r[0].expense.ARS,0);
 assert.equal(r[0].income.USD,0);
 assert.equal(r[0].exchangeOut.ARS,30020);
 assert.equal(r[0].exchangeIn.USD,20);
 assert.equal(r[1].openingAvailable.ARS,219980);
 assert.equal(r[1].openingAvailable.USD,25);
});
test('importar movimientos del banco sustituye las dos piernas manuales',()=>{
 const old=createDollarPurchase({date:today,usd:20,pesos:30000,rate:1500});
 old.forEach(x=>x.fxReferenceRate=1510);
 const incoming=[
   {date:today,description:'Compra de dólares',type:'debit',currency:'ARS',amount:30000,internalTransfer:true,source:'Brubank'},
   {date:today,description:'Compra de dólares',type:'credit',currency:'USD',amount:20,internalTransfer:true,source:'Brubank'}
 ];
 const m=reconcileImportedFx(old,incoming);
 assert.equal(m.reconciled,2);
 assert.equal(m.removeIds.size,2);
 assert.equal(incoming[0].fxGroup,incoming[1].fxGroup);
 assert.equal(incoming[0].fxReferenceRate,1510);
 const rows=buildMonthlyLedger([...old.filter(x=>!m.removeIds.has(x.id)),...incoming],opening,'2026-10').rows;
 assert.equal(rows[0].closingAvailable.ARS,220000);
 assert.equal(rows[0].closingAvailable.USD,25);
});
test('no conciliar operaciones de diferente día, importe ni operaciones que no sean FX',()=>{
 const old=createDollarPurchase({date:today,usd:20,pesos:30000,rate:1500});
 const incoming=[
   {date:'2026-10-07',description:'Compra de dólares',type:'debit',currency:'ARS',amount:30000,internalTransfer:true},
   {date:today,description:'Compra de dólares',type:'credit',currency:'USD',amount:30,internalTransfer:true},
   {date:today,description:'Sueldo',type:'debit',currency:'ARS',amount:30000,internalTransfer:true}
 ];
 const match=reconcileImportedFx(old,incoming);
 assert.equal(match.reconciled,0);
 assert.equal(match.removeIds.size,0);
});
