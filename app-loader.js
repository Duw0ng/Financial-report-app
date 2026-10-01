const criticalStyle=document.createElement('style');
criticalStyle.textContent='[hidden]{display:none!important}';
document.head.append(criticalStyle);

const EXPECTED='18f4501792cbf73410e2bae3c49d4a0ea4e50c15cc07c48e0fff541572b580f5';
const AUTH_KEY='fp_device_authorized_v1';
const enc=new TextEncoder();
const hex=b=>[...new Uint8Array(b)].map(x=>x.toString(16).padStart(2,'0')).join('');
let authorized=localStorage.getItem(AUTH_KEY)==='1';
const match=/^#k=([A-Za-z0-9_-]{20,})$/.exec(location.hash);
if(!authorized&&match){
  const digest=hex(await crypto.subtle.digest('SHA-256',enc.encode(match[1])));
  if(digest===EXPECTED){authorized=true;localStorage.setItem(AUTH_KEY,'1');history.replaceState(null,'',location.pathname+location.search)}
}
if(!authorized){
  document.body.innerHTML='<main style="min-height:100vh;display:grid;place-items:center;background:#0b1020;color:#94a3b8;font-family:system-ui;padding:24px;text-align:center"><div><h1 style="color:#e2e8f0;font-size:22px">Página no disponible</h1><p>El enlace no es válido para este dispositivo.</p></div></main>';
}else{
  const desktopCss=document.createElement('link');desktopCss.rel='stylesheet';desktopCss.href='./desktop.css?v=4';document.head.append(desktopCss);
  const parts=['app.part1.txt','app.part2.txt','app.part3.txt','app.part4.txt','app.part5.txt'];
  const texts=await Promise.all(parts.map(p=>fetch('./'+p+'?v=4',{cache:'no-store'}).then(r=>{if(!r.ok)throw new Error('No se pudo cargar '+p);return r.text()})));
  let src=texts.join('');
  const here=new URL('./',location.href);
  src=src.replace("from './db.js'",`from '${new URL('./db.js?v=4',here).href}'`)
         .replace("from './crypto.js'",`from '${new URL('./crypto.js?v=4',here).href}'`)
         .replace("from './parser.js'",`from '${new URL('./parser.js?v=4',here).href}'`);
  const url=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
  try{await import(url)}finally{setTimeout(()=>URL.revokeObjectURL(url),10000)}
}
