import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const path=process.env.HGHUB_PLUGIN_DIR ? process.env.HGHUB_PLUGIN_DIR+'/91porn.js' : new URL('../../plugins/91porn.js', import.meta.url);
const s=(await fs.readFile(path,'utf8')).replace('  function encodeUrl(u)', '  hg.test = { fetchHtml, origin };\n  function encodeUrl(u)');
const mod=await import('data:text/javascript;base64,'+Buffer.from(s).toString('base64'));
class PluginError extends Error {constructor(code,m){super(m);this.code=code;}}
const ctx=()=>({signal:new AbortController().signal});
let pass=0;
async function test(name, steps, expected, opts={}) {
 const calls=[];
 const hg={PluginError,settings:{get:()=>null},endpoint:{current:{url:'https://91porn.com'}},http:{fetch:async r=>{calls.push(r);const step=steps.shift();assert.ok(step,'unexpected retry');if(step instanceof Error)throw step;return step;}},log:{info:()=>{}}};
 mod.default(hg);
 if(opts.code)await assert.rejects(hg.test.fetchHtml('https://91porn.com/view_video.php?viewkey=abc',opts.ctx||ctx()),e=>e.code===opts.code);
 else assert.equal(await hg.test.fetchHtml('https://91porn.com/view_video.php?viewkey=abc',ctx()),'valid html');
 assert.equal(calls.length,expected);
 if(expected===2){assert.equal(calls[1].url,'https://sp2026.com/view_video.php?viewkey=abc');assert.equal(calls[1].headers.Referer,'https://sp2026.com/');}
 if(opts.sticky){hg.http.fetch=async r=>{assert.ok(r.url.startsWith('https://sp2026.com/'));return {ok:true,data:'valid html'};};assert.equal(hg.test.origin(),'https://sp2026.com');}
 console.log('PASS',name);pass++;
}
const good=()=>({ok:true,status:200,data:'valid html'});
for(const status of [403,408,429,500,502,503])await test('HTTP '+status,[{ok:false,status},good()],2,{sticky:true});
for(const code of ['NETWORK','TIMEOUT'])await test(code,[new PluginError(code,'bad'),good()],2);
await test('healthy main',[good()],1);
await test('challenge page',[{ok:true,status:200,data:'<title>Just a moment</title>'},good()],2);
for(const [status,code] of [[401,'AUTH_REQUIRED'],[404,'NOT_FOUND']])await test('no retry '+status,[{ok:false,status}],1,{code});
for(const code of ['CANCELLED','CONTENT_LOCKED','AUTH_REQUIRED'])await test('no retry '+code,[new PluginError(code,'stop')],1,{code});
await test('all failed',[new PluginError('NETWORK','a'),new PluginError('TIMEOUT','b')],2,{code:'TIMEOUT'});
const cancelled=ctx();cancelled.signal.throwIfAborted;const ac=new AbortController();ac.abort();await test('already aborted',[],0,{code:'CANCELLED',ctx:{signal:ac.signal}});
console.log(pass+' cases passed; actual plugin function, offline fault injection.');
