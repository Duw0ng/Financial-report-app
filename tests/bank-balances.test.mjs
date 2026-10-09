import test from 'node:test';
import assert from 'node:assert/strict';
import {inferOpeningFromBankStatements} from '../bank-balances.js';
import {buildMonthlyLedger} from '../ledger.js';

function bank({source='Brubank',currency='ARS',date='2026-09-01',type='credit',amount=100,balance=300,description='Deposito',internalTransfer=false,internalTransferReason='' }={}){
 return {source,currency,date,type,amount,balance,description,internalTransfer,internalTransferReason};
}
test('reconstruye el saldo anterior a un movimiento y lo pasa al siguiente mes',()=>{
 const t=[
  bank({type:'credit',amount:100,balance:300}),
  bank({date:'2026-09-03',type:'debit',amount:30,balance:270}),
  bank({date:'2026-10-02',type:'credit',amount:40,balance:310})
 ];
 const auto=inferOpeningFromBankStatements(t);
 assert.equal(auto.reliable,true);
 assert.equal(auto.opening.available.ARS,200);
 assert.equal(auto.opening.startMonth,'2026-09');
 const ledger=buildMonthlyLedger(t,auto.opening,'2026-11');
 assert.equal(ledger.rows[0].closingAvailable.ARS,270);
 assert.equal(ledger.rows[1].closingAvailable.ARS,310);
 assert.equal(ledger.rows[2].openingAvailable.ARS,310);
});
test('suma varias cuentas y no duplica transferencias internas verificadas',()=>{
 const t=[
  bank({source:'Brubank',type:'credit',amount:100,balance:1100}),
  bank({source:'Brubank',date:'2026-09-03',type:'debit',amount:200,balance:900,description:'Transferencia a cuenta tuya',internalTransfer:true}),
  bank({source:'Naranja X',type:'credit',amount:50,balance:550}),
  bank({source:'Naranja X',date:'2026-09-03',type:'credit',amount:200,balance:750,description:'Transferencia desde cuenta tuya',internalTransfer:true}),
  bank({source:'Brubank',currency:'USD',amount:2,balance:7}),
 ];
 const auto=inferOpeningFromBankStatements(t);
 assert.equal(auto.reliable,true);
 assert.deepEqual(auto.opening.available,{ARS:1500,USD:5});
 const ledger=buildMonthlyLedger(t,auto.opening,'2026-09');
 assert.equal(ledger.rows[0].closingAvailable.ARS,1650);
 assert.equal(ledger.rows[0].closingAvailable.USD,7);
});
test('no inventa un saldo de PDF cuando faltan balances o se contradicen',()=>{
 const missing=inferOpeningFromBankStatements([
   bank({balance:0}),bank({date:'2026-09-03',balance:270,type:'debit',amount:30})
 ]);
 assert.equal(missing.reliable,false);
 const different=inferOpeningFromBankStatements([
   bank({balance:300}),bank({date:'2026-09-03',balance:100,type:'debit',amount:30})
 ]);
 assert.equal(different.reliable,false);
 assert.match(different.reason,/no concilian/);
});
test('no confirma una transferencia interna cuando falta la otra cuenta',()=>{
 const t=[
  bank({balance:1100}),
  bank({date:'2026-09-03',type:'debit',amount:100,balance:1000,description:'A una cuenta tuya',internalTransfer:true}),
 ];
 assert.equal(inferOpeningFromBankStatements(t).reliable,false);
});
test('si faltan extractos, no bloquea ni modifica transacciones',()=>{
 const t=[{date:'2026-09-01',type:'credit',currency:'ARS',amount:200,source:'Manual'}];
 assert.equal(inferOpeningFromBankStatements(t).reliable,false);
 assert.equal(buildMonthlyLedger(t,{confirmed:false,startMonth:'2026-09'},'2026-10').rows[1].openingAvailable.ARS,200);
});
