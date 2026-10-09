import {dbGet,dbSet,dbDelete} from './db.js';
import {encryptJson,decryptJson} from './crypto.js';
import {parseBankPdf} from './parser.js';
import {buildMonthlyLedger,shiftMonth,validMonth} from './ledger.js';

const $=s=>document.querySelector(s); const $$=s=>[...document.querySelectorAll(s)];
const VAULT_KEY='vault';
const defaultCategories=['Supermercado','Comida','Transporte','Servicios','Suscripciones','Tarjeta','Compras','Transferencias','Impuestos','Rendimientos','Salud','Educación','Entretenimiento','Ingresos','Ahorros','Otros'];
const icons={Supermercado:'🛒',Comida:'🍔',Transporte:'🚗',Servicios:'💡',Suscripciones:'🔁',Tarjeta:'💳',Compras:'🛍️',Transferencias:'↔️',Impuestos:'🏛️',Rendimientos:'📈',Salud:'♥',Educación:'📚',Entretenimiento:'🎮',Ingresos:'＋',Ahorros:'🏦',Otros:'•'};
let state=null,password=null,pendingImport=null,deferredInstall=null,restoreBlob=null,lastActivity=Date.now(),autoLockTimer=null;

function defaultOpening(){return {confirmed:false,startMonth:'',available:{ARS:0,USD:0},savings:{ARS:0,USD:0}}}
function emptyState(){return {version:3,transactions:[],categories:[...defaultCategories],rules:[],settings:{autoLock:10,savingsGoalARS:0},openingBalances:defaultOpening(),createdAt:new Date().toISOString()}}
function migrateState(){
  if(!state)return;
  state.version=3;state.transactions??=[];state.categories??=[];state.rules??=[];
  state.settings??={autoLock:10};state.settings.savingsGoalARS??=0;
  state.openingBalances??=defaultOpening();
  for(const c of defaultCategories)if(!state.categories.includes(c))state.categories.push(c);
  for(const t of state.transactions){
    t.source??='Importado';t.internalTransfer??=false;t.internalTransferReason??='';
    t.savingsAction??=null;
  }
}
function localDate(){const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function monthlyLedger(){return buildMonthlyLedger(state.transactions,state.openingBalances,shiftMonth(monthKey(localDate())))}
function toast(msg,error=false){const t=$('#toast');t.textContent=msg;t.className='toast show'+(error?' error':'');clearTimeout(t._timer);t._timer=setTimeout(()=>t.className='toast',2800)}
function formatMoney(n,c='ARS'){return new Intl.NumberFormat('es-AR',{style:'currency',currency:c,minimumFractionDigits:c==='ARS'?0:2,maximumFractionDigits:2}).format(n||0).replace('US$','U$S')}
function monthKey(date){return String(date||'').slice(0,7)}
function monthLabel(key){if(!key)return 'Sin movimientos';const [y,m]=key.split('-').map(Number);return new Intl.DateTimeFormat('es-AR',{month:'long',year:'numeric'}).format(new Date(y,m-1,1)).replace(/^./,c=>c.toUpperCase())}
function uid(){return crypto.randomUUID?.()||`${Date.now()}-${Math.random().toString(16).slice(2)}`}
async function hashText(s){const d=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s));return [...new Uint8Array(d)].map(b=>b.toString(16).padStart(2,'0')).join('').slice(0,24)}
function guessCategory(desc,type){const d=desc.toLowerCase();for(const r of state?.rules||[]){if(d.includes(r.match.toLowerCase()))return r.category}
  if(/rendimiento diario|rendimientos? acreditados/.test(d))return 'Rendimientos';
  if(/pago (de resumen|anticipado).*naranja x|tarjeta naranja/.test(d))return 'Tarjeta';
  if(/compra de d[oó]lar|compra de d[oó]lares|cuenta tuya/.test(d))return 'Transferencias';
  if(type==='credit')return 'Ingresos';
  if(/pedidosya\*market|carrefour|coto|dia%|jumbo|changomas|supermerc/.test(d))return 'Supermercado';
  if(/pedidosya|burger|mostaza|pizzeria|rapanui|restaurant|cafe|pizza/.test(d))return 'Comida';
  if(/uber|cabify|sube|ypf|shell|axion/.test(d))return 'Transporte';
  if(/claro|movistar|personal|edenor|edesur|metrogas|internet|telecom/.test(d))return 'Servicios';
  if(/openai|chatgpt|prime video|netflix|spotify|youtube|plus/.test(d))return 'Suscripciones';
  if(/aliexpress|mercadolibre|mercado libre|tienda/.test(d))return 'Compras';
  if(/percepci|impuesto|iibb|ganancias|iva/.test(d))return 'Impuestos';
  if(/cuenta tuya|d[eé]bito en cuenta|^[0-9]{8,}\s*-|villagran|cardoni|ibanez|mannina/.test(d))return 'Transferencias';
  return 'Otros';
}
function merchantFromDescription(d){return d.replace(/payu\*ar\*/i,'').replace(/pedidosya\*/i,'').replace(/\s+/g,' ').trim()}
let saveQueue=Promise.resolve();
async function save(){
  if(!state||!password)return;
  const snapshot=JSON.parse(JSON.stringify(state)),pass=password;
  saveQueue=saveQueue.catch(()=>{}).then(async()=>{
    const current=await dbGet(VAULT_KEY);
    const blob=await encryptJson(snapshot,pass,current?.salt||null);
    await dbSet(VAULT_KEY,blob);
  });
  return saveQueue;
}
async function lock(){state=null;password=null;pendingImport=null;$('#app').hidden=true;$('#lockScreen').hidden=false;$('#unlockBox').hidden=false;$('#firstRunBox').hidden=true;$('#unlockPassword').value='';clearInterval(autoLockTimer)}
function resetActivity(){lastActivity=Date.now()}
function setupAutoLock(){clearInterval(autoLockTimer);if(!state?.settings.autoLock)return;autoLockTimer=setInterval(()=>{if(Date.now()-lastActivity>state.settings.autoLock*60_000)lock()},15000)}
async function init(){const v=await dbGet(VAULT_KEY);$('#firstRunBox').hidden=!!v;$('#unlockBox').hidden=!v;bind();if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});}
async function createVault(){const a=$('#newPassword').value,b=$('#newPassword2').value;if(a.length<6)return toast('Usa al menos 6 caracteres.',true);if(a!==b)return toast('Las claves no coinciden.',true);state=emptyState();password=a;await dbSet(VAULT_KEY,await encryptJson(state,password));openApp();toast('Bóveda creada.');}
async function unlock(){const p=$('#unlockPassword').value;try{const v=await dbGet(VAULT_KEY);state=await decryptJson(v,p);password=p;migrateState();reconcileInternalTransfers();openApp()}catch{toast('Clave incorrecta o bóveda dañada.',true)}}
function openApp(){lastActivity=Date.now();$('#lockScreen').hidden=true;$('#app').hidden=false;renderCategories();renderMonthOptions();render();setupAutoLock()}
function allMonths(){return monthlyLedger().rows.map(r=>r.month).reverse()}
function renderMonthOptions(keep=true){
  const sel=$('#monthSelect'),old=keep?sel.value:'',current=monthKey(localDate());
  const months=allMonths();sel.innerHTML='';
  for(const m of months){const o=document.createElement('option');o.value=m;o.textContent=monthLabel(m);sel.append(o)}
  if(old&&months.includes(old))sel.value=old;
  else if(months.includes(current))sel.value=current;
  else sel.value=months[0]||'';
}
function visibleTransactions(){const m=$('#monthSelect').value,q=$('#searchInput').value.trim().toLowerCase(),cur=$('#currencyFilter').value,src=$('#sourceFilter')?.value||'ALL';return state.transactions.filter(t=>monthKey(t.date)===m&&(cur==='ALL'||t.currency===cur)&&(src==='ALL'||t.source===src)&&(!q||`${t.description} ${t.merchant} ${t.category} ${t.source}`.toLowerCase().includes(q))).sort((a,b)=>b.date.localeCompare(a.date)||String(b.ref).localeCompare(String(a.ref)))}
function render(){
  if(!state)return;
  renderSourceOptions();
  const m=$('#monthSelect').value,ledger=monthlyLedger();
  const r=ledger.rows.find(x=>x.month===m);
  if(!r)return;
  const month=state.transactions.filter(t=>monthKey(t.date)===m);
  const put=(id,n,c='ARS')=>{$(id).textContent=formatMoney(n,c)};
  put('#openingARS',r.openingAvailable.ARS);
  put('#incomeARS',r.income.ARS);put('#expenseARS',r.expense.ARS);
  put('#monthSavingsARS',r.saved.ARS-r.withdrawn.ARS);
  put('#balanceARS',r.closingAvailable.ARS);
  put('#savingsARS',r.closingSavings.ARS);put('#totalARS',r.total.ARS);
  put('#availableUSD',r.closingAvailable.USD,'USD');
  put('#savingsUSD',r.closingSavings.USD,'USD');put('#totalUSD',r.total.USD,'USD');
  const internal=month.filter(t=>t.internalTransfer&&!t.savingsAction).length;
  const note=$('#internalTransferNote');
  if(note)note.textContent=internal?`${internal} movimiento(s) internos excluidos de ingresos/gastos; las compras de divisas sí ajustan la disponibilidad por moneda.`:'';
  const warning=$('#baselineWarning');
  warning.hidden=ledger.confirmed&&!ledger.ignoredBeforeStart;
  warning.textContent=!ledger.confirmed
    ? 'Saldo estimado desde $0: configurá el saldo inicial en Ajustes para conocer tu dinero real disponible.'
    : `${ledger.ignoredBeforeStart} movimiento(s) anteriores al mes base excluidos. Revisá el mes base en Ajustes.`;
  const goal=Math.max(0,Number(state.settings.savingsGoalARS)||0);
  const net=r.saved.ARS-r.withdrawn.ARS;
  const progress=$('#savingsGoalProgress');
  progress.hidden=!goal;
  if(goal){
    $('#savingsGoalText').textContent=`Ahorro neto del mes: ${formatMoney(net)} / meta ${formatMoney(goal)} (${Math.max(0,Math.round(net/goal*100))}%)`;
    $('#savingsGoalBar').style.width=`${Math.max(0,Math.min(100,net/goal*100))}%`;
  }
  $('#monthMovementDetails').textContent=
    `Ahorros: +${formatMoney(r.saved.ARS)} / retiros: −${formatMoney(r.withdrawn.ARS)} · Balance ARS sin depósitos/retiros: ${formatMoney(r.income.ARS-r.expense.ARS)}`;
  renderBars(month);renderTransactions();
}
function renderBars(month){const map={};for(const t of month.filter(t=>t.type==='debit'&&t.currency==='ARS'&&!t.internalTransfer&&!t.savingsAction))map[t.category]=(map[t.category]||0)+t.amount;const arr=Object.entries(map).sort((a,b)=>b[1]-a[1]);const box=$('#categoryChart');if(!arr.length){box.innerHTML='<div class="empty">Aún no hay gastos ARS en este mes.</div>';return}const max=arr[0][1];box.innerHTML=arr.slice(0,10).map(([c,v])=>`<div class="bar-row"><span>${icons[c]||'•'} ${escapeHtml(c)}</span><div class="bar-track"><div class="bar-fill" style="width:${Math.max(3,v/max*100)}%"></div></div><span class="bar-value">${formatMoney(v,'ARS')}</span></div>`).join('')}
function renderTransactions(){
  const arr=visibleTransactions();
  $('#movementCount').textContent=`${arr.length} movimiento${arr.length===1?'':'s'}`;
  const box=$('#transactionsList');
  if(!arr.length){box.innerHTML='<div class="empty">No hay movimientos para mostrar.</div>';return}
  box.innerHTML=arr.map(t=>{
    const saving=t.savingsAction==='deposit'?'Ahorro':t.savingsAction==='withdraw'?'Retiro de ahorro':'';
    const label=saving||t.category;
    const amountLabel=t.savingsAction==='deposit'?'↗':t.savingsAction==='withdraw'?'↙':t.type==='credit'?'+':'−';
    return `<button class="tx" data-id="${escapeHtml(t.id)}"><span class="tx-icon">${saving?'🏦':icons[t.category]||'•'}</span><span class="tx-main"><span class="tx-title">${escapeHtml(t.merchant||t.description)}</span><span class="tx-meta">${escapeHtml(t.date.split('-').reverse().join('/'))} · ${escapeHtml(label)} · ${escapeHtml(t.source||'')}${t.internalTransfer?' · transferencia interna':''}${t.ref?` · #${escapeHtml(t.ref)}`:''}</span></span><span class="tx-amount ${t.savingsAction?'saving':t.type}">${amountLabel}${formatMoney(t.amount,t.currency)}</span></button>`;
  }).join('');
  $$('.tx').forEach(b=>b.onclick=()=>editTransaction(b.dataset.id));
}
function escapeHtml(s){return String(s??'').replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function renderCategories(){if(!state)return;const s=$('#editCategory');s.innerHTML=state.categories.map(c=>`<option>${escapeHtml(c)}</option>`).join('');$('#categoryManager').innerHTML=state.categories.map(c=>`<div class="category-chip"><span>${icons[c]||'•'} ${escapeHtml(c)}</span><span class="badge">${state.transactions.filter(t=>t.category===c).length}</span></div>`).join('');$('#autoLockSelect').value=String(state.settings.autoLock??10)}

function renderSourceOptions(){const sel=$('#sourceFilter');if(!sel)return;const old=sel.value||'ALL';const sources=[...new Set(state.transactions.map(t=>t.source).filter(Boolean))].sort();sel.innerHTML='<option value="ALL">Todas las cuentas</option>'+sources.map(x=>`<option value="${escapeHtml(x)}">${escapeHtml(x)}</option>`).join('');if([...sel.options].some(o=>o.value===old))sel.value=old}
function reconcileInternalTransfers(){
  if(!state?.transactions)return;
  for(const t of state.transactions){if(t.internalTransferReason==='paired'){t.internalTransfer=false;t.internalTransferReason=''}}
  const arr=state.transactions;
  for(let i=0;i<arr.length;i++){
    const a=arr[i]; if(a.internalTransfer||!/(transferencia|cuenta tuya)/i.test(a.description||''))continue;
    for(let j=i+1;j<arr.length;j++){
      const b=arr[j];
      if(b.internalTransfer||a.source===b.source||a.date!==b.date||a.currency!==b.currency||a.type===b.type||Math.abs(a.amount-b.amount)>0.005)continue;
      if(!/(transferencia|cuenta tuya)/i.test(`${a.description} ${b.description}`))continue;
      a.internalTransfer=b.internalTransfer=true;a.internalTransferReason=b.internalTransferReason='paired';break;
    }
  }
}

async function choosePdf(){pendingImport=null;$('#pdfInput').value='';$('#pdfInput').click()}
async function handlePdf(file){if(!file)return;$('#importDialog').showModal();$('#confirmImportBtn').disabled=true;$('#importPreview').innerHTML='';$('#importProgress').textContent='Preparando lector PDF…';try{const parsed=await parseBankPdf(file,msg=>$('#importProgress').textContent=msg);let dup=0;for(const t of parsed.transactions){t.category=guessCategory(t.description,t.type);t.merchant=merchantFromDescription(t.description);t.id=await hashText(`${t.date}|${t.ref}|${t.description}|${t.type}|${t.currency}|${t.amount}|${t.balance}`);if(state.transactions.some(x=>x.id===t.id))dup++}pendingImport={...parsed,transactions:parsed.transactions.filter(t=>!state.transactions.some(x=>x.id===t.id))};$('#importProgress').innerHTML=`<strong>${escapeHtml(parsed.bank)}</strong> · detectados <strong>${parsed.transactions.length}</strong> movimientos en ${parsed.pages} página(s). ${dup?`<strong>${dup}</strong> ya existían y se omitirán.`:'No se detectaron duplicados.'}`;renderImportPreview();$('#confirmImportBtn').disabled=!pendingImport.transactions.length}catch(e){console.error(e);$('#importProgress').textContent=e?.message||'No pude leer este PDF. Actualmente se admiten estados de cuenta Brubank y Naranja X con texto seleccionable.';toast('Error al procesar el PDF.',true)}}
function renderImportPreview(){const arr=pendingImport?.transactions||[];$('#importPreview').innerHTML=arr.length?`<div style="overflow:auto"><table class="import-table"><thead><tr><th>Fecha</th><th>Cuenta</th><th>Descripción</th><th>Cat.</th><th>Importe</th></tr></thead><tbody>${arr.slice(0,50).map(t=>`<tr><td>${t.date}</td><td>${escapeHtml(t.source)}</td><td>${escapeHtml(t.description)}</td><td>${escapeHtml(t.category)}</td><td>${t.type==='credit'?'+':'−'}${formatMoney(t.amount,t.currency)}${t.internalTransfer?' ↔':''}</td></tr>`).join('')}</tbody></table></div>${arr.length>50?`<p class="tiny muted">Mostrando 50 de ${arr.length}.</p>`:''}`:'<div class="empty">No hay movimientos nuevos para importar.</div>'}
async function confirmImport(){if(!pendingImport?.transactions.length)return;const importedMonth=monthKey(pendingImport.transactions[0].date);state.transactions.push(...pendingImport.transactions);reconcileInternalTransfers();await save();const n=pendingImport.transactions.length;pendingImport=null;$('#importDialog').close();renderMonthOptions(false);if(importedMonth&&[...$('#monthSelect').options].some(o=>o.value===importedMonth))$('#monthSelect').value=importedMonth;renderCategories();render();toast(`${n} movimientos importados.`)}
function editTransaction(id){
  const t=state.transactions.find(x=>x.id===id);if(!t)return;
  $('#txDialogTitle').textContent='Editar movimiento';$('#editTxId').value=t.id;
  $('#editDate').value=t.date;$('#editDescription').value=t.description;$('#editMerchant').value=t.merchant||'';
  $('#editCategory').value=t.category;
  $('#editType').value=t.savingsAction==='deposit'?'save':t.savingsAction==='withdraw'?'unsave':t.type;
  $('#editCurrency').value=t.currency;$('#editAmount').value=t.amount;
  $('#learnRule').checked=!t.savingsAction;$('#deleteTxBtn').hidden=false;$('#transactionDialog').showModal();
}
function addTransaction(type='debit'){
  const selectedMonth=$('#monthSelect').value,current=monthKey(localDate());
  const date=selectedMonth&&selectedMonth!==current?`${selectedMonth}-01`:localDate();
  const isSaving=type==='save'||type==='unsave';
  $('#txDialogTitle').textContent=type==='credit'?'Agregar ingreso':type==='save'?'Agregar ahorro':type==='unsave'?'Retirar ahorros':'Agregar gasto';
  $('#editTxId').value='';$('#editDate').value=date;$('#editDescription').value=isSaving?(type==='save'?'Dinero reservado':'Retiro de mis ahorros'):'';
  $('#editMerchant').value='';$('#editCategory').value=isSaving?'Ahorros':type==='credit'?'Ingresos':'Otros';
  $('#editType').value=type;$('#editCurrency').value='ARS';$('#editAmount').value='';
  $('#learnRule').checked=false;$('#deleteTxBtn').hidden=true;$('#transactionDialog').showModal();
  setTimeout(()=>$('#editAmount').focus(),40);
}
async function saveTransaction(){
  const oldId=$('#editTxId').value,t=oldId?state.transactions.find(x=>x.id===oldId):null;
  const desc=$('#editDescription').value.trim(),n=Number($('#editAmount').value),date=$('#editDate').value;
  if(!desc||!Number.isFinite(n)||n<=0||!/^\d{4}-\d{2}-\d{2}$/.test(date))return toast('Completa fecha, descripción e importe positivo.',true);
  const choice=$('#editType').value,savingsAction=choice==='save'?'deposit':choice==='unsave'?'withdraw':null;
  const kind=savingsAction?(savingsAction==='deposit'?'debit':'credit'):choice;
  const data={date,description:desc,merchant:$('#editMerchant').value.trim(),
    category:savingsAction?'Ahorros':$('#editCategory').value,type:kind,currency:$('#editCurrency').value,amount:n,
    savingsAction,source:t?.source||'Manual',ref:t?.ref||'',balance:t?.balance||0,
    internalTransfer:t?.internalTransfer||false,internalTransferReason:t?.internalTransferReason||'',
    createdAt:t?.createdAt||new Date().toISOString()};
  data.id=oldId||await hashText(`${data.date}|manual|${data.description}|${data.type}|${data.currency}|${data.amount}|${uid()}`);
  if(t)Object.assign(t,data);else state.transactions.push(data);
  if(!savingsAction&&$('#learnRule').checked&&desc.length>=4){
    const match=desc.replace(/\d+/g,'').replace(/\s+/g,' ').trim().slice(0,28);
    if(match&&!state.rules.some(r=>r.match.toLowerCase()===match.toLowerCase()))state.rules.push({match,category:data.category});
  }
  reconcileInternalTransfers();await save();$('#transactionDialog').close();
  renderMonthOptions();renderCategories();render();
  toast((savingsAction?(savingsAction==='deposit'?'Ahorro':'Retiro de ahorro'):kind==='credit'?'Ingreso':'Gasto')+' guardado.');
}
async function deleteTransaction(){const id=$('#editTxId').value;if(!id)return;if(!confirm('¿Eliminar este movimiento?'))return;state.transactions=state.transactions.filter(t=>t.id!==id);reconcileInternalTransfers();await save();$('#transactionDialog').close();renderCategories();render();toast('Movimiento eliminado.')}
function changeMonth(delta){const opts=[...$('#monthSelect').options];const i=opts.findIndex(o=>o.value===$('#monthSelect').value);const ni=Math.min(opts.length-1,Math.max(0,i-delta));if(opts[ni]){$('#monthSelect').value=opts[ni].value;render()}}
function txKind(t){return t.savingsAction==='deposit'?'Ahorro':t.savingsAction==='withdraw'?'Retiro de ahorro':t.type==='credit'?'Ingreso':'Gasto'}
async function exportCsv(){
  const sorted=[...state.transactions].sort((a,b)=>a.date.localeCompare(b.date));
  const rows=[['Fecha','Referencia','Descripción','Comercio','Categoría','Tipo','Moneda','Importe','Saldo bancario','Origen','Transferencia interna','Ahorro/Retiro'],
    ...sorted.map(t=>[t.date,t.ref,t.description,t.merchant,t.category,txKind(t),t.currency,t.amount,t.balance,t.source,t.internalTransfer?'Sí':'No',t.savingsAction||''])];
  const csv=rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(';')).join('\r\n');
  downloadBlob(new Blob(['\ufeff'+csv],{type:'text/csv;charset=utf-8'}),`finanzas_${localDate()}.csv`);
}
async function exportExcel(){
  try{
    toast('Preparando Excel…');
    const XLSX=await loadSheetJs();
    const rows=[...state.transactions].sort((a,b)=>a.date.localeCompare(b.date)).map(t=>({
      Fecha:t.date,Referencia:t.ref,Descripción:t.description,Comercio:t.merchant,Categoría:t.category,
      Tipo:txKind(t),Moneda:t.currency,Importe:t.amount,'Saldo bancario':t.balance,Origen:t.source,
      'Transferencia interna':t.internalTransfer?'Sí':'No','Movimiento de ahorros':t.savingsAction||''
    }));
    const wb=XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(rows),'Movimientos');
    XLSX.utils.book_append_sheet(wb,XLSX.utils.json_to_sheet(buildMonthlySummary()),'Resumen mensual');
    XLSX.writeFile(wb,`finanzas_${localDate()}.xlsx`);
  }catch(e){console.error(e);toast('No se pudo exportar Excel. Usá CSV o comprobá la conexión.',true)}
}
function buildMonthlySummary(){
  return monthlyLedger().rows.map(r=>{
    const o={Mes:r.month,'Saldo confirmado':r.confirmed?'Sí':'No'};
    for(const c of ['ARS','USD']){
      o[`Inicial disponible ${c}`]=r.openingAvailable[c];
      o[`Ingresos ${c}`]=r.income[c];o[`Gastos ${c}`]=r.expense[c];
      o[`Ahorros depositados ${c}`]=r.saved[c];o[`Ahorros retirados ${c}`]=r.withdrawn[c];
      o[`Compra/venta divisas entrada ${c}`]=r.exchangeIn[c];o[`Compra/venta divisas salida ${c}`]=r.exchangeOut[c];
      o[`Disponible final ${c}`]=r.closingAvailable[c];
      o[`Ahorros acumulados ${c}`]=r.closingSavings[c];
      o[`Patrimonio final ${c}`]=r.total[c];
    }
    return o;
  });
}
let sheetPromise=null;function loadSheetJs(){if(window.XLSX)return Promise.resolve(window.XLSX);if(!sheetPromise)sheetPromise=new Promise((resolve,reject)=>{const s=document.createElement('script');s.src='https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';s.onload=()=>resolve(window.XLSX);s.onerror=reject;document.head.append(s)});return sheetPromise}
function downloadBlob(blob,name){const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
async function exportBackup(){const blob=await dbGet(VAULT_KEY);downloadBlob(new Blob([JSON.stringify({app:'Finanzas Privadas',createdAt:new Date().toISOString(),vault:blob},null,2)],{type:'application/json'}),`finanzas_${new Date().toISOString().slice(0,10)}.finbackup`);toast('Backup cifrado creado.')}
function startRestore(){restoreBlob=null;$('#backupInput').value='';$('#backupInput').click()}
async function handleBackupFile(file){try{const j=JSON.parse(await file.text());if(!j.vault?.cipher)throw new Error();restoreBlob=j.vault;$('#restorePassword').value='';$('#restoreDialog').showModal()}catch{toast('Backup no válido.',true)}}
async function confirmRestore(){if(!restoreBlob)return;try{await decryptJson(restoreBlob,$('#restorePassword').value);await dbSet(VAULT_KEY,restoreBlob);$('#restoreDialog').close();toast('Backup restaurado. Desbloquea con su clave.');setTimeout(()=>lock(),500)}catch{toast('Clave incorrecta para este backup.',true)}}
async function wipe(){if(!confirm('Esto borrará toda la bóveda de este dispositivo. ¿Continuar?'))return;if(!confirm('Última confirmación: esta acción no se puede deshacer sin un backup.'))return;await dbDelete(VAULT_KEY);location.reload()}
async function addCategory(){const c=$('#newCategoryInput').value.trim();if(!c)return;if(!state.categories.includes(c)){state.categories.push(c);await save();renderCategories()}$('#newCategoryInput').value=''}
function renderOpeningSettings(){
  const b=state.openingBalances||defaultOpening();
  const months=state.transactions.map(t=>monthKey(t.date)).filter(Boolean).sort();
  $('#openingMonth').value=b.startMonth||months[0]||monthKey(localDate());
  for(const c of ['ARS','USD']){
    $('#openingAvailable'+c).value=b.available?.[c]??0;
    $('#openingSavings'+c).value=b.savings?.[c]??0;
  }
  $('#savingsGoalARS').value=state.settings.savingsGoalARS||0;
}
async function saveOpeningSettings(){
  const m=$('#openingMonth').value;
  if(!validMonth(m))return toast('Elegí un mes de inicio válido.',true);
  const b={confirmed:true,startMonth:m,available:{},savings:{}};
  for(const c of ['ARS','USD']){
    const available=Number($('#openingAvailable'+c).value),savings=Number($('#openingSavings'+c).value);
    if(!Number.isFinite(available)||!Number.isFinite(savings)||savings<0)return toast('Revisá los saldos iniciales.',true);
    b.available[c]=available;b.savings[c]=savings;
  }
  const goal=Number($('#savingsGoalARS').value);
  if(!Number.isFinite(goal)||goal<0)return toast('La meta de ahorro no puede ser negativa.',true);
  state.openingBalances=b;state.settings.savingsGoalARS=goal;
  await save();renderMonthOptions();render();toast('Saldo inicial y meta de ahorro guardados.');
}
function bind(){
  $('#createVaultBtn').onclick=createVault;$('#unlockBtn').onclick=unlock;
  $('#unlockPassword').addEventListener('keydown',e=>{if(e.key==='Enter')unlock()});$('#lockBtn').onclick=lock;
  $('#fabImport').onclick=choosePdf;$('#pdfInput').onchange=e=>handlePdf(e.target.files[0]);$('#confirmImportBtn').onclick=confirmImport;
  $('#addExpenseDesktopBtn')?.addEventListener('click',()=>addTransaction('debit'));
  $('#addIncomeDesktopBtn')?.addEventListener('click',()=>addTransaction('credit'));
  $('#addSavingDesktopBtn')?.addEventListener('click',()=>addTransaction('save'));
  $('#addSavingBtn')?.addEventListener('click',()=>addTransaction('save'));
  $('#monthSelect').onchange=render;
  $('#prevMonthBtn').onclick=()=>changeMonth(-1);$('#nextMonthBtn').onclick=()=>changeMonth(1);
  $('#searchInput').oninput=renderTransactions;$('#currencyFilter').onchange=renderTransactions;$('#sourceFilter').onchange=renderTransactions;
  $$('[data-tab]').forEach(b=>b.onclick=()=>{
    if(b.dataset.tab==='add')addTransaction('debit');
    if(b.dataset.tab==='savings')addTransaction('save');
    if(b.dataset.tab==='settings'){renderOpeningSettings();$('#settingsDialog').showModal();renderCategories()}
  });
  $('#editType').onchange=e=>{if(['save','unsave'].includes(e.target.value)){$('#editCategory').value='Ahorros';$('#learnRule').checked=false}};
  $('#saveTxBtn').onclick=saveTransaction;$('#deleteTxBtn').onclick=deleteTransaction;
  $('#exportCsvBtn').onclick=exportCsv;$('#exportExcelBtn').onclick=exportExcel;
  $('#exportBackupBtn').onclick=exportBackup;$('#restoreBackupBtn').onclick=startRestore;
  $('#restoreFromLockBtn').onclick=startRestore;$('#restoreFromFirstRunBtn').onclick=startRestore;
  $('#backupInput').onchange=e=>handleBackupFile(e.target.files[0]);$('#confirmRestoreBtn').onclick=confirmRestore;
  $('#wipeBtn').onclick=wipe;$('#addCategoryBtn').onclick=addCategory;
  $('#saveOpeningBtn').onclick=saveOpeningSettings;
  $('#autoLockSelect').onchange=async e=>{state.settings.autoLock=Number(e.target.value);await save();setupAutoLock();toast('Bloqueo automático actualizado.')};
  ['pointerdown','keydown','touchstart'].forEach(ev=>document.addEventListener(ev,resetActivity,{passive:true}));
  document.addEventListener('keydown',e=>{
    const tag=e.target?.tagName;
    if(['INPUT','SELECT','TEXTAREA'].includes(tag)||e.ctrlKey||e.metaKey||e.altKey)return;
    if(e.key==='ArrowLeft'){changeMonth(-1);e.preventDefault()}else if(e.key==='ArrowRight'){changeMonth(1);e.preventDefault()}
  });
  window.addEventListener('beforeinstallprompt',e=>{e.preventDefault();deferredInstall=e;$('#installBtn').hidden=false});
  $('#installBtn').onclick=async()=>{if(deferredInstall){deferredInstall.prompt();await deferredInstall.userChoice;deferredInstall=null;$('#installBtn').hidden=true}};
}
init();
