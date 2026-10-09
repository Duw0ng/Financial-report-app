// Proyecciones locales: no crea movimientos bancarios ni reserva dinero real.
// La conversión usa precio vendedor para ARS → USD y comprador para USD → ARS.
// El tipo de cambio es una foto actual; no implica previsión del tipo de cambio futuro.
import {shiftMonth,validMonth} from './ledger.js';

const round=n=>Math.round((n+Number.EPSILON)*100)/100;
const cents=n=>Math.round(Number(n)*100);
const validValue=n=>Number.isFinite(Number(n))&&Number(n)>=0&&Number(n)<=1e10;
export function conversion(amount,from,to,quote){
  if(!validValue(amount)||!['ARS','USD'].includes(from)||!['ARS','USD'].includes(to))return null;
  if(from===to)return round(Number(amount));
  const buy=Number(quote?.venta),sell=Number(quote?.compra);
  if(!(buy>0&&sell>0&&Number.isFinite(buy)&&Number.isFinite(sell)))return null;
  return round(from==='ARS'?Number(amount)/buy:Number(amount)*sell);
}
export function monthDistance(from,to){
  if(!validMonth(from)||!validMonth(to))return null;
  const [fy,fm]=from.split('-').map(Number),[ty,tm]=to.split('-').map(Number);
  return (ty-fy)*12+tm-fm;
}
export function projectSavings({initial=0,monthly=0,months=12,currency='ARS',month='2026-10',quote=null}={}){
  if(!validValue(initial)||!validValue(monthly)||!Number.isInteger(Number(months))||Number(months)<1||Number(months)>600||
    !['ARS','USD'].includes(currency)||!validMonth(month))
    throw new Error('Revisá los montos, la moneda y el plazo (1 a 600 meses).');
  const first=cents(initial),step=cents(monthly),n=Number(months);
  const final=round((first+step*n)/100);
  const otherCurrency=currency==='ARS'?'USD':'ARS';
  const converted=conversion(final,currency,otherCurrency,quote);
  const jump=Math.max(1,Math.ceil(n/12));
  const points=[];
  for(let i=0;i<=n;i+=jump)points.push({monthIndex:i,month:shiftMonth(month,i),value:round((first+step*i)/100)});
  if(points.at(-1)?.monthIndex!==n)points.push({monthIndex:n,month:shiftMonth(month,n),value:final});
  return {initial:round(first/100),monthly:round(step/100),months:n,currency,final,
    otherCurrency,converted,finishMonth:shiftMonth(month,n),added:round(step*n/100),points};
}
export function normalizeGoal({id='',title='',currency='ARS',target,saved=0,monthly=0,deadline='',createdAt='',updatedAt=''}={}){
  const name=String(title).trim().replace(/\s+/g,' ');
  if(!name||name.length>100)throw new Error('Ingresá un nombre de meta de hasta 100 caracteres.');
  if(!['ARS','USD'].includes(currency)||!validValue(target)||Number(target)<=0||
    !validValue(saved)||!validValue(monthly))
    throw new Error('Usá montos válidos y una meta mayor a cero.');
  if(deadline&&!validMonth(deadline))throw new Error('Fecha objetivo inválida.');
  return {id:String(id),title:name,currency,target:round(Number(target)),
    saved:round(Number(saved)),monthly:round(Number(monthly)),deadline,createdAt,updatedAt};
}
export function goalForecast(goal,nowMonth,quote=null){
  const g=normalizeGoal(goal);
  if(!validMonth(nowMonth))throw new Error('Mes actual inválido.');
  const remaining=round(Math.max(0,g.target-g.saved));
  const progress=Math.min(100,Math.max(0,round(g.saved/g.target*100)));
  const monthsToGoal=remaining===0?0:g.monthly>0?Math.ceil(remaining/g.monthly):null;
  const finishMonth=monthsToGoal===null||monthsToGoal>600?null:shiftMonth(nowMonth,monthsToGoal);
  const monthsToDeadline=g.deadline?monthDistance(nowMonth,g.deadline):null;
  const requiredMonthly=monthsToDeadline===null||monthsToDeadline<=0
    ?null:round(Math.ceil(remaining/monthsToDeadline*100)/100);
  const deadlineStatus=!g.deadline?'none':remaining===0?'achieved':monthsToDeadline<=0?'overdue':
    g.monthly*monthsToDeadline+0.000001>=remaining?'on-track':'behind';
  return {...g,remaining,progress,monthsToGoal,finishMonth,monthsToDeadline,requiredMonthly,
    deadlineStatus,convertedTarget:conversion(g.target,g.currency,g.currency==='ARS'?'USD':'ARS',quote)};
}
