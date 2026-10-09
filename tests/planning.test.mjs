import test from 'node:test';
import assert from 'node:assert/strict';
import {conversion,projectSavings,normalizeGoal,monthDistance,goalForecast} from '../planning.js';
const q={compra:1490,venta:1540,updatedAt:'2026-10-09T00:00:00Z'};
test('proyecta capital inicial y aportes mensuales sin modificar cuentas',()=>{
 const p=projectSavings({initial:5000,monthly:1200,months:12,currency:'ARS',month:'2026-10',quote:q});
 assert.equal(p.final,19400);
 assert.equal(p.added,14400);
 assert.equal(p.finishMonth,'2027-10');
 assert.equal(p.converted,Math.round(19400/1540*100)/100);
 assert.equal(p.points[0].value,5000);
 assert.equal(p.points.at(-1).value,19400);
});
test('simulación USD a ARS utiliza el precio comprador, ARS a USD el vendedor',()=>{
 assert.equal(conversion(100,'USD','ARS',q),149000);
 assert.equal(conversion(154000,'ARS','USD',q),100);
 assert.equal(conversion(15500,'ARS','USD',null),null);
 assert.equal(projectSavings({initial:10,monthly:30,months:3,currency:'USD',month:'2026-10',quote:q}).final,100);
});
test('valida plazos, valores negativos y nombre de la meta',()=>{
 assert.throws(()=>projectSavings({monthly:-1,months:4}));
 assert.throws(()=>projectSavings({monthly:1,months:0}));
 assert.throws(()=>projectSavings({monthly:1,months:601}));
 assert.throws(()=>normalizeGoal({title:' ',target:100}));
 assert.throws(()=>normalizeGoal({title:'Viaje',target:0}));
 assert.equal(monthDistance('2026-10','2027-03'),5);
});
test('Viaje a Japón calcula progreso, plazo, ahorro necesario en dólares y equivalencia',()=>{
 const goal=normalizeGoal({id:'japon',title:'Viaje a Japón',currency:'USD',target:4000,
   saved:1000,monthly:250,deadline:'2027-10'});
 const f=goalForecast(goal,'2026-10',q);
 assert.equal(f.remaining,3000);
 assert.equal(f.progress,25);
 assert.equal(f.monthsToGoal,12);
 assert.equal(f.finishMonth,'2027-10');
 assert.equal(f.monthsToDeadline,12);
 assert.equal(f.requiredMonthly,250);
 assert.equal(f.deadlineStatus,'on-track');
 assert.equal(f.convertedTarget,5960000);
});
test('aporte insuficiente advierte y muestra lo necesario por mes',()=>{
 const f=goalForecast(normalizeGoal({title:'PC',target:1000000,saved:100000,monthly:100000,
    currency:'ARS',deadline:'2027-01'}),'2026-10',q);
 assert.equal(f.monthsToDeadline,3);
 assert.equal(f.requiredMonthly,300000);
 assert.equal(f.deadlineStatus,'behind');
 assert.equal(f.finishMonth,'2027-07');
 const achieved=goalForecast({title:'Ya conseguida',target:100,saved:150,monthly:0},'2026-10',q);
 assert.equal(achieved.progress,100);
 assert.equal(achieved.monthsToGoal,0);
 assert.equal(achieved.deadlineStatus,'none');
});
test('conversión no inventa precio sin cotización',()=>{
 assert.equal(goalForecast({title:'Japón',target:500,saved:100,monthly:100,currency:'USD'},'2026-10').convertedTarget,null);
 assert.equal(goalForecast({title:'Plan',target:500,saved:0,monthly:0},'2026-10').finishMonth,null);
});
