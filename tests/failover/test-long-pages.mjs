import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
import path from 'node:path';
const root=process.env.HGHUB_PLUGIN_DIR || new URL('../../plugins/',import.meta.url).pathname;
class PluginError extends Error{constructor(code,message){super(message);this.code=code;}}
let count=0;
for(const id of ['mrds','bl911']){
 const source=(await fs.readFile(path.join(root,id+'.js'),'utf8')).replace('  async function fetchHtml(', '  hg.test={fetchHtml};\n  async function fetchHtml(');
 const mod=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
 const origin=id==='mrds'?'https://mrds.com':'https://d1k1nd82ice0a7.cloudfront.net';
 const fixtures=[['90KB-header','<!doctype html><html><head><!--'+'x'.repeat(90000)+'--></head><body><article>valid content</article></body></html>']];
 if(process.env.LIVE_HTML_DIR){fixtures.push(['captured-live-page',await fs.readFile(path.join(process.env.LIVE_HTML_DIR,'failover-'+id+'-home.html'),'utf8')]);}
 for(const [name,html] of fixtures){
  let calls=0;
  const hg={PluginError,endpoint:{current:{url:origin}},storage:{get:async()=>null},http:{fetch:async req=>{calls++;return {ok:true,status:200,data:html,url:req.url};}}};
  mod.default(hg);
  assert.equal(await hg.test.fetchHtml(origin+'/',{signal:new AbortController().signal}),html);
  assert.equal(calls,1,'valid page must not trigger mirror switch');
  console.log('PASS',id,name);count++;
 }
}
console.log(count+' long-header and optional live-page cases passed');
