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
  const desktopCss=document.createElement('link');desktopCss.rel='stylesheet';desktopCss.href='./desktop.css?v=9';document.head.append(desktopCss);
  await import('./app-v3.js?v=9');
}
