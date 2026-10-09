import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const root=new URL('../',import.meta.url);
const read=n=>readFileSync(new URL(n,root),'utf8');

test('todos los selectores obligatorios del panel existen en HTML',()=>{
  const app=read('app-v3.js'),html=read('index.html');
  const ids=[...new Set([...app.matchAll(/\$\('#([^']+)'\)/g)].map(m=>m[1]))];
  for(const id of ids)assert.ok(html.includes('id="'+id+'"'),'Falta elemento #'+id);
  const htmlIds=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
  assert.equal(new Set(htmlIds).size,htmlIds.length,'IDs de HTML duplicados');
});
test('la app usa cambio real y no cachea cotización externa',()=>{
  const sw=read('sw.js'),loader=read('app-loader.js'),app=read('app-v3.js'),exchange=read('exchange.js');
  assert.ok(sw.includes("url.hostname==='dolarapi.com'"));
  assert.ok(sw.includes("'./exchange.js'"));
  assert.ok(loader.includes('app-v3.js?v=8'));
  assert.ok(app.includes('createDollarPurchase({date,usd,pesos,rate:pesos/usd'));
  assert.ok(exchange.includes("'https://dolarapi.com/v1/dolares/oficial'"));
});
