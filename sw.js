const CACHE='finanzas-privadas-v8';
const SHELL=['./','./index.html','./styles.css','./desktop.css','./app-loader.js','./app-v3.js','./ledger.js','./exchange.js','./crypto.js','./db.js','./parser.js','./manifest.webmanifest','./robots.txt','./icons/icon.svg'];
self.addEventListener('install',e=>e.waitUntil(caches.open(CACHE).then(c=>c.addAll(SHELL)).then(()=>self.skipWaiting())));
self.addEventListener('activate',e=>e.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',e=>{
  if(e.request.method!=='GET')return;
  const url=new URL(e.request.url);
  // La cotización siempre se consulta en la red: nunca servir el precio viejo desde el SW.
  if(url.hostname==='dolarapi.com'){e.respondWith(fetch(e.request));return}
  if(url.origin===self.location.origin){
    e.respondWith(fetch(e.request,{cache:'no-cache'}).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});return resp}).catch(()=>caches.match(e.request)));
  }else{
    e.respondWith(caches.match(e.request).then(cached=>cached||fetch(e.request).then(resp=>{const copy=resp.clone();caches.open(CACHE).then(c=>c.put(e.request,copy)).catch(()=>{});return resp})));
  }
});
