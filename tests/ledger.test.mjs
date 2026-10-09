import test from 'node:test';
import assert from 'node:assert/strict';
import {buildMonthlyLedger,shiftMonth} from '../ledger.js';

const baseline={confirmed:true,startMonth:'2026-09',
  available:{ARS:200,USD:0},savings:{ARS:100,USD:0}};
function tx(date,type,amount,currency='ARS',extra={}){
  return {date,type,amount,currency,description:'Movimiento de prueba',...extra};
}

test('saldo disponible pasa de un mes al siguiente, incluso sin operaciones',()=>{
  const rows=buildMonthlyLedger([
    tx('2026-09-01','credit',300),tx('2026-09-10','debit',70),
    tx('2026-09-15','debit',50,'ARS',{savingsAction:'deposit'}),
    tx('2026-10-02','credit',30),
    tx('2026-10-04','credit',20,'ARS',{savingsAction:'withdraw'})
  ],baseline,'2026-11').rows;
  assert.equal(rows.length,3);
  assert.equal(rows[0].openingAvailable.ARS,200);
  assert.equal(rows[0].closingAvailable.ARS,380);
  assert.equal(rows[0].closingSavings.ARS,150);
  assert.equal(rows[1].openingAvailable.ARS,380);
  assert.equal(rows[1].closingAvailable.ARS,430);
  assert.equal(rows[1].closingSavings.ARS,130);
  assert.equal(rows[1].income.ARS,30);
  assert.equal(rows[1].expense.ARS,0);
  assert.equal(rows[1].total.ARS,560);
  assert.equal(rows[2].openingAvailable.ARS,430);
  assert.equal(rows[2].closingAvailable.ARS,430);
});

test('cambiar un gasto antiguo corrige todos los cierres posteriores',()=>{
  const entries=[tx('2026-09-01','debit',70)];
  let rows=buildMonthlyLedger(entries,baseline,'2026-11').rows;
  assert.equal(rows.at(-1).closingAvailable.ARS,130);
  entries[0].amount=100;
  rows=buildMonthlyLedger(entries,baseline,'2026-11').rows;
  assert.equal(rows.at(-1).closingAvailable.ARS,100);
});

test('transferencias internas no afectan patrimonio; cambio de divisas afecta saldo por moneda',()=>{
  const rows=buildMonthlyLedger([
    tx('2026-09-01','debit',30,'ARS',{internalTransfer:true,description:'transferencia entre mis cuentas'}),
    tx('2026-09-04','debit',200,'ARS',{internalTransfer:true,description:'Compra de dólares'}),
    tx('2026-09-04','credit',1,'USD',{internalTransfer:true,description:'Compra de dólar oficial'}),
    tx('2026-09-05','debit',50,'ARS',{savingsAction:'deposit',internalTransfer:true})
  ],baseline,'2026-09').rows;
  assert.equal(rows[0].expense.ARS,0);
  assert.equal(rows[0].income.USD,0);
  assert.equal(rows[0].closingAvailable.ARS,-50);
  assert.equal(rows[0].closingSavings.ARS,150);
  assert.equal(rows[0].closingAvailable.USD,1);
  assert.equal(rows[0].total.ARS,100);
});

test('ancla confirmada excluye meses anteriores; sin ancla el primero retrocede',()=>{
  const entry=[tx('2026-08-01','credit',100)];
  const confirmed=buildMonthlyLedger(entry,baseline,'2026-10');
  assert.equal(confirmed.ignoredBeforeStart,1);
  assert.equal(confirmed.rows[0].month,'2026-09');
  const draft=buildMonthlyLedger(entry,{confirmed:false,startMonth:'2026-09'},'2026-10');
  assert.equal(draft.rows[0].month,'2026-08');
  assert.equal(draft.rows[0].closingAvailable.ARS,100);
  assert.equal(shiftMonth('2026-12'),'2027-01');
});

test('bóveda vacía muestra el mes actual y el siguiente sin movimientos',()=>{
  const rows=buildMonthlyLedger([],{confirmed:false,startMonth:'2026-10'},'2026-11').rows;
  assert.deepEqual(rows.map(r=>r.month),['2026-10','2026-11']);
  assert.equal(rows[1].closingAvailable.ARS,0);
});
