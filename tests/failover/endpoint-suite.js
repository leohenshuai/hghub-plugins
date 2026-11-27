class PluginError extends Error { constructor(code,message){super(message);this.code=code;} }
function assert(v,m){if(!v)throw new Error(m);}
let count=0,maxSlice=0,boundary=Date.now();
const nativeTimer=setTimeout;
globalThis.setTimeout=function(f,ms){maxSlice=Math.max(maxSlice,Date.now()-boundary);return nativeTimer(function(){boundary=Date.now();f();},ms);};
async function run(id,mode,opts){
 opts=opts||{};
 const declared=id==='mrds'?['https://mrds.com','https://www.mrds66.com','https://capital.opukapynj.cc']:['https://d1k1nd82ice0a7.cloudfront.net','https://d9altmxkp5q0i.cloudfront.net','https://blw66.com'];
 const start=opts.selected||declared[0],sig={aborted:!!opts.aborted},calls=[];
 const html="<div class=\"dplayer\" data-config='"+JSON.stringify({video:{url:'https://media.fixture.invalid/index.m3u8?auth_key=1900000000',type:'hls'}})+"'></div>";
 const hg={PluginError:PluginError,endpoint:{current:{url:start}},html:{parse:function(){return {first:function(){return null;}};}},storage:{get:async function(){return opts.dynamic?[{url:'http://invalid.cloudfront.net'},{url:'https://not-cloudfront.fixture.invalid'},{url:'https://cached123.cloudfront.net/'}]:null;}},
  http:{fetch:async function(req){
   maxSlice=Math.max(maxSlice,Date.now()-boundary);await new Promise(function(r){nativeTimer(r,0);});boundary=Date.now();calls.push(req);
   assert(req.url.endsWith('/archives/123/'),'must retry same actual article path, not homepage: '+req.url);
   assert(req.timeoutMs>0&&req.timeoutMs<=6000&&req.retry===0,'unexpected request budget/retry');
   assert(req.signal===sig,'signal lost');
   assert(req.headers.Referer===req.url.replace('/archives/123/','/'),'wrong per-mirror referer');
   assert(req.credentials==='omit','cookie jar should not leak across mirrors');
   const primary=req.url.indexOf(start+'/')===0;
   if(mode==='dynamic' && req.url.indexOf('https://cached123.cloudfront.net/')!==0)throw new PluginError('NETWORK','static endpoint down');
   if(primary&&mode==='emptyPrimary')return {ok:true,status:200,url:req.url,data:''};
   if(primary&&mode==='challenge')return {ok:true,status:200,url:req.url,data:'<title>Just a moment...</title><script src="/cdn-cgi/challenge-platform/"></script>'};
   if(opts.cancelDuring)sig.aborted=true;
   if(mode==='allBad'||(primary&&mode==='network'))throw new PluginError('NETWORK','injected TLS');
   if(primary&&mode==='timeout')throw new PluginError('TIMEOUT','injected timeout');
   if(primary&&mode.startsWith('fatal:'))throw new PluginError(mode.slice(6),'fatal');
   const status=primary&&mode.startsWith('status:')?+mode.slice(7):200;
   return {ok:status>=200&&status<300,status:status,url:req.url,data:mode==='empty'?'<!doctype html> parking':html,headers:{}};
  }}};
 const text=SOURCES[id].replace('export const meta =','const meta =').replace('export default function (hg)','function factory(hg)');
 const plugin=new Function(text+';return factory;')()(hg);
 const params=id==='mrds'?{episodeId:'123:0'}:{mediaId:'123',episodeId:'1'};
 let result,error;
 boundary=Date.now();try{result=await plugin.media.resolvePlayback(params,{signal:sig});}catch(e){error=e;}
 return {result:result,error:error,calls:calls,declared:declared,start:start,plugin:plugin,params:params,sig:sig};
}
async function test(id,mode,expected,opts){
 const x=await run(id,mode,opts);
 if(expected.startsWith('error:')) {
  assert(x.error&&x.error.code===expected.slice(6),id+' '+mode+' expected '+expected+' got '+(x.error&&x.error.stack));
  assert(!x.result,'failed mirrors returned stream');
  if(expected!=='error:NETWORK'&&mode!=='allBad'&&mode!=='empty')assert(x.calls.length<2,id+' retried terminal failure');
 }else{
  assert(!x.error,id+' '+mode+' '+(x.error&&x.error.stack));
  assert(x.result.streams[0].url.indexOf('https://media.fixture.invalid/')===0,'real target page config not parsed');
  const want=expected==='backup'?x.declared.filter(function(u){return u!==x.start;})[0]:x.start;
  assert(x.result.streams[0].headers.Referer===want+'/','playback referer not active mirror');
  assert(x.calls.length===(expected==='backup'?2:1),'unexpected request count');
  // Subsequent resolution starts on the successful mirror, not the broken saved main.
  const n=x.calls.length;
  await x.plugin.media.resolvePlayback(x.params,{signal:x.sig});
  assert(x.calls[n].url===want+'/archives/123/','successful mirror not reused');
 }
 count++;console.log('PASS '+id+' '+mode+' '+(opts&&opts.selected?'selected':'default'));
}
(async function(){
 for(const id of Object.keys(SOURCES)){
  await test(id,'ok','primary');
  for(const mode of ['network','timeout','status:403','status:408','status:500','status:502','status:503','emptyPrimary','challenge'])await test(id,mode,'backup');
  for(const code of ['AUTH_REQUIRED','AUTH_INVALID','AUTH_EXPIRED','CONTENT_LOCKED','CANCELLED','RATE_LIMITED','INVALID_ARGUMENT','UPSTREAM_CHANGED','UPSTREAM_ERROR','INTERNAL'])await test(id,'fatal:'+code,'error:'+code);
  await test(id,'status:401','error:AUTH_REQUIRED');await test(id,'status:404','error:NOT_FOUND');await test(id,'status:429','error:RATE_LIMITED');await test(id,'status:400','error:UPSTREAM_ERROR');
  await test(id,'allBad','error:NETWORK');
  await test(id,'ok','error:CANCELLED',{aborted:true});await test(id,'ok','error:CANCELLED',{cancelDuring:true});
  await test(id,'empty','error:UPSTREAM_CHANGED');
  const selected=id==='mrds'?'https://www.mrds66.com':'https://blw66.com';
  await test(id,'network','backup',{selected:selected});
  const custom=await run(id,'allBad',{selected:'https://custom.fixture.invalid'});
  assert(custom.calls.length===1&&custom.error.code==='NETWORK','custom endpoint must not be silently rewritten');count++;
 }
 const dyn=await run('bl911','dynamic',{dynamic:true});
 assert(!dyn.error && dyn.calls.length===4,'cached dynamic mirror fallback failed '+(dyn.error&&dyn.error.stack));
 assert(dyn.result.streams[0].headers.Referer==='https://cached123.cloudfront.net/','dynamic mirror referer lost');
 assert(!dyn.calls.some(function(r){return r.url.indexOf('invalid.cloudfront')>=0||r.url.indexOf('not-cloudfront')>=0;}),'unsafe cached endpoint used');count++;
 for(const id of Object.keys(SOURCES)){
  let pageRequests=0;
  const src=SOURCES[id].replace('export const meta =','const meta =').replace('export default function (hg)','function factory(hg)');
  const h={PluginError:PluginError,endpoint:{current:null},storage:{get:async function(){return null;}},http:{fetch:async function(req){pageRequests++;return {ok:false,status:404,data:'',url:req.url};}}};
  const p=new Function(src+';return factory;')()(h);
  const page=id==='mrds'?await p.catalog.list({categoryId:'mrds',cursor:'2'},{signal:{aborted:false}}):await p.home.listSection({sectionId:'latest',cursor:'2'},{signal:{aborted:false}});
  assert(pageRequests===1&&page.items.length===0&&page.next===null,'allow404 pagination semantics changed '+id);count++;
 }
 // Many cached mirrors cannot extend one target fetch beyond the shared 15s budget.
 const realNow=Date.now, budgets=[];let clock=1000000;
 const code=SOURCES.bl911.replace('export const meta =','const meta =').replace('export default function (hg)','function factory(hg)');
 const many=Array.from({length:30},function(_,i){return {url:'https://cached'+i+'.cloudfront.net'};});
 const host={PluginError:PluginError,endpoint:{current:null},storage:{get:async function(){return many;}},http:{fetch:async function(req){budgets.push(req.timeoutMs);clock+=req.timeoutMs;throw new PluginError('TIMEOUT','simulated elapsed timeout');}}};
 const limited=new Function(code+';return factory;')()(host);let budgetError;
 try{Date.now=function(){return clock;};await limited.media.resolvePlayback({mediaId:'123',episodeId:'1'},{signal:{aborted:false}});}catch(e){budgetError=e;}finally{Date.now=realNow;boundary=Date.now();}
 assert(budgetError&&budgetError.code==='TIMEOUT'&&budgets.join(',')==='6000,6000,3000','cached mirrors exceeded 15s budget: '+budgets);count++;
 assert(maxSlice<1000,'synchronous slice '+maxSlice+'ms');
 console.log('RESULT '+count+' passed; observed longest synchronous slice '+maxSlice+'ms');
})().catch(function(e){console.log('FAIL '+e.stack);if(typeof process!=='undefined')process.exitCode=1;else throw e;});
