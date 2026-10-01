const parts=['app.part1.txt', 'app.part2.txt', 'app.part3.txt', 'app.part4.txt', 'app.part5.txt'];
const texts=await Promise.all(parts.map(p=>fetch('./'+p,{cache:'no-cache'}).then(r=>{if(!r.ok)throw new Error('No se pudo cargar '+p);return r.text()})));
let src=texts.join('');
const here=new URL('./',location.href);
src=src.replace("from './db.js'",`from '${new URL('./db.js',here).href}'`)
       .replace("from './crypto.js'",`from '${new URL('./crypto.js',here).href}'`)
       .replace("from './parser.js'",`from '${new URL('./parser.js',here).href}'`);
const url=URL.createObjectURL(new Blob([src],{type:'text/javascript'}));
try{await import(url)}finally{setTimeout(()=>URL.revokeObjectURL(url),10000)}
