import {projectSavings,normalizeGoal,goalForecast} from './planning.js';
import {isFreshQuote} from './exchange.js';

const $=id=>document.getElementById(id);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const nowMonth=()=>new Date().getFullYear()+'-'+String(new Date().getMonth()+1).padStart(2,'0');
let env=null,bound=false,lastState=null,startTouched=false;

const money=(value,currency)=>env.money(value,currency);
const quote=()=>{const q=env.getQuote();return q&&isFreshQuote(q)?q:null};
const goalState=()=>env.getState()?.goals||[];
const titleMonth=m=>{
  if(!m)return 'sin fecha';
  const [y,n]=m.split('-').map(Number);
  return new Intl.DateTimeFormat('es-AR',{month:'long',year:'numeric'}).format(new Date(y,n-1,1));
};
function currentSaved(currency){
  const r=env.currentRow();
  return Math.max(0,Number(r?.closingSavings?.[currency]||0));
}
function applyPreferences(){
  const p=env.getState()?.settings?.projection||{};
  $('projectionCurrency').value=p.currency==='USD'?'USD':'ARS';
  $('projectionMonthly').value=Number.isFinite(p.monthly)?p.monthly:100000;
  $('projectionMonths').value=Number.isInteger(p.months)?p.months:12;
  startTouched=Number.isFinite(p.initial);
  $('projectionInitial').value=startTouched?p.initial:currentSaved($('projectionCurrency').value);
}
function simInputs(){
  return {currency:$('projectionCurrency').value,monthly:Number($('projectionMonthly').value),
    months:Number($('projectionMonths').value),initial:Number($('projectionInitial').value),
    month:nowMonth(),quote:quote()};
}
function renderProjection(){
  const box=$('projectionResults'),bars=$('projectionMilestones');
  try{
    const p=projectSavings(simInputs());
    const other=p.converted==null?'Cotización actual no disponible':money(p.converted,p.otherCurrency);
    box.innerHTML=`<div class="plan-stat"><span>Total al terminar</span><strong>${money(p.final,p.currency)}</strong></div>
      <div class="plan-stat"><span>Equivalente aproximado en ${p.otherCurrency}</span><strong>${other}</strong></div>
      <div class="plan-stat"><span>Dinero que agregarías</span><strong>${money(p.added,p.currency)}</strong></div>
      <div class="plan-stat"><span>Mes estimado de cierre</span><strong>${esc(titleMonth(p.finishMonth))}</strong></div>`;
    const max=Math.max(0.01,...p.points.map(v=>v.value));
    bars.innerHTML=p.points.slice(0,14).map(({month,value})=>
      `<div class="sim-meter-row"><span>${esc(month)}</span>
        <div class="sim-meter-track"><div style="width:${Math.max(1,Math.min(100,value/max*100))}%"></div></div>
        <strong>${money(value,p.currency)}</strong></div>`).join('');
    $('projectionQuoteNote').textContent=quote()
      ?`Conversión orientativa según dólar ${esc(quote().market)} del ${new Date(quote().updatedAt).toLocaleString('es-AR')}. El valor futuro puede cambiar.`
      :'Sin cotización reciente: no se estiman equivalencias entre monedas.';
  }catch(e){
    box.textContent=e.message;bars.replaceChildren();$('projectionQuoteNote').textContent='';
  }
}
function renderGoalCards(){
  const goals=goalState(),container=$('goalCards');
  $('goalsCount').textContent=`${goals.length} meta${goals.length===1?'':'s'} guardadas`;
  if(!goals.length){
    container.innerHTML='<div class="goal-empty">Todavía no creaste metas. Podés comenzar con «Viaje a Japón» o cualquier otro objetivo.</div>';
    return;
  }
  container.innerHTML=goals.map(g=>{
    let f;try{f=goalForecast(g,nowMonth(),quote())}catch{return ''}
    const altCurrency=f.currency==='ARS'?'USD':'ARS';
    const alt=f.convertedTarget==null?'sin cotización reciente':money(f.convertedTarget,altCurrency);
    const eta=f.monthsToGoal===null?'Sin plazo: agregá un aporte mensual':
      f.monthsToGoal===0?'Meta alcanzada':
      `En ${f.monthsToGoal} mes${f.monthsToGoal===1?'':'es'} (aprox. ${titleMonth(f.finishMonth)})`;
    let targetNote='';
    if(f.deadline){
      const needed=f.requiredMonthly===null?'Fecha límite alcanzada':
        `Necesitás ${money(f.requiredMonthly,f.currency)}/mes para esa fecha`;
      const status={achieved:'Meta alcanzada',overdue:'Plazo vencido','on-track':'Vas según el plan',behind:'Requiere aumentar el aporte'};
      targetNote=`<p class="goal-deadline">Fecha objetivo: ${esc(titleMonth(f.deadline))} · ${esc(status[f.deadlineStatus]||'')} · ${needed}</p>`;
    }
    return `<article class="goal-card">
      <div class="goal-card-head"><h3>${esc(f.title)}</h3><button type="button" class="ghost goal-edit" data-id="${esc(f.id)}">Editar</button></div>
      <div class="goal-numbers"><strong>${money(f.saved,f.currency)}</strong><span>de ${money(f.target,f.currency)} · ${f.progress.toFixed(1)}%</span></div>
      <div class="goal-progress" role="progressbar" aria-valuenow="${f.progress}" aria-valuemin="0" aria-valuemax="100" aria-label="Progreso: ${esc(f.title)}"><div style="width:${f.progress}%"></div></div>
      <p>Faltan <b>${money(f.remaining,f.currency)}</b> · Aporte previsto: ${money(f.monthly,f.currency)}/mes</p>
      <p class="goal-eta">${esc(eta)}</p>
      ${targetNote}
      <p class="tiny muted">Meta: ${alt} (estimación al cambio de hoy)</p>
    </article>`;
  }).join('');
  container.querySelectorAll('.goal-edit').forEach(b=>b.onclick=()=>openGoal(b.dataset.id));
}
function openGoal(id=''){
  const goal=goalState().find(g=>g.id===id);
  $('goalDialogTitle').textContent=goal?'Editar meta de ahorro':'Crear meta de ahorro';
  $('goalId').value=goal?.id||'';
  $('goalTitle').value=goal?.title||'';
  $('goalCurrency').value=goal?.currency||'USD';
  $('goalTarget').value=goal?.target||'';
  $('goalSaved').value=goal?.saved||0;
  $('goalMonthly').value=goal?.monthly||0;
  $('goalDeadline').value=goal?.deadline||'';
  $('deleteGoalBtn').hidden=!goal;
  $('goalDialog').showModal();
  setTimeout(()=>$('goalTitle').focus(),30);
}
async function saveGoal(){
  const existing=goalState().find(g=>g.id===$('goalId').value);
  let g;
  try{
    g=normalizeGoal({id:existing?.id||crypto.randomUUID(),title:$('goalTitle').value,
      currency:$('goalCurrency').value,target:$('goalTarget').value,saved:$('goalSaved').value,
      monthly:$('goalMonthly').value,deadline:$('goalDeadline').value,
      createdAt:existing?.createdAt||new Date().toISOString(),updatedAt:new Date().toISOString()});
  }catch(e){return env.toast(e.message,true)}
  const s=env.getState();
  const index=s.goals.findIndex(x=>x.id===g.id);
  if(index>=0)s.goals[index]=g;else s.goals.push(g);
  await env.save();$('goalDialog').close();renderGoalCards();
  env.toast('Meta guardada. No se modificó el saldo bancario.');
}
async function deleteGoal(){
  const id=$('goalId').value,g=goalState().find(x=>x.id===id);
  if(!g||!confirm('¿Eliminar la meta «'+g.title+'»? No se borran movimientos bancarios.'))return;
  const s=env.getState();s.goals=s.goals.filter(x=>x.id!==id);
  await env.save();$('goalDialog').close();renderGoalCards();env.toast('Meta eliminada.');
}
async function saveProjection(){
  try{projectSavings(simInputs())}catch(e){return env.toast(e.message,true)}
  const s=env.getState();
  s.settings.projection={currency:$('projectionCurrency').value,monthly:Number($('projectionMonthly').value),
    months:Number($('projectionMonths').value),initial:Number($('projectionInitial').value)};
  await env.save();env.toast('Simulación guardada en tu bóveda privada.');
}
export function setupPlanning(options){
  env=options;
  if(bound)return;
  bound=true;
  $('projectionCurrency').onchange=()=>{if(!startTouched)$('projectionInitial').value=currentSaved($('projectionCurrency').value);renderProjection()};
  for(const id of ['projectionInitial','projectionMonthly','projectionMonths']){
    $(id).addEventListener('input',()=>{if(id==='projectionInitial')startTouched=true;renderProjection()});
  }
  $('saveProjectionBtn').onclick=saveProjection;
  $('addGoalBtn').onclick=()=>openGoal();
  $('saveGoalDetailsBtn').onclick=saveGoal;
  $('deleteGoalBtn').onclick=deleteGoal;
}
export function renderPlanning(){
  const state=env?.getState();if(!state)return;
  if(lastState!==state){lastState=state;applyPreferences()}
  if(!startTouched)$('projectionInitial').value=currentSaved($('projectionCurrency').value);
  renderProjection();renderGoalCards();
}
