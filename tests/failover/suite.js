// No network: actual exported plugin factories + actual media.resolvePlayback calls.
class PluginError extends Error { constructor(code, message) { super(message); this.code = code; } }
function assert(ok, message) { if (!ok) throw new Error(message); }
const ids = Object.keys(SOURCES);
let count=0, maxSlice=0, boundary=Date.now();
const nativeTimer=setTimeout;
globalThis.setTimeout=function(fn, ms) { maxSlice=Math.max(maxSlice,Date.now()-boundary); return nativeTimer(function() { boundary=Date.now(); fn(); },ms); };
function make(id, mode, opts) {
  opts=opts||{};
  const calls=[], signal={aborted:!!opts.aborted};
  const first=id==='mwxk62'?'h3.xinghun1.com':id==='hkdoll'?'t33.cdn2020.com':'primary.fixture.invalid';
  const second=id==='mwxk62'?'h1.qhkjapp.com':id==='hkdoll'?'t26.cdn2020.com':'backup.fixture.invalid';
  let entry=false;
  function response(req,data,status,url) {status=status||200;return {ok:status>=200&&status<300,status:status,url:url||req.url,data:data,headers:{},setCookies:[],fromCache:false};}
  const hg={PluginError:PluginError,endpoint:{current:null},storage:{get:async function(k){return k==='site:v2'?{url:'https://www.57hqky.com',at:Date.now()}:null;}},
    codec:{hexEncode:function(){return MD5;}},crypto:{digest:function(){return []; }},
    http:{fetch:async function(req){
      maxSlice=Math.max(maxSlice,Date.now()-boundary);
      await new Promise(function(r){nativeTimer(r,0);}); boundary=Date.now();
      calls.push(req);
      assert(req.signal===signal,'signal lost');
      const u=req.url;
      if(id==='mwxk62'&&u.indexOf('/api/movie/1')>=0) return response(req,JSON.stringify({code:0,data:{h264m3u8url:'/path/index.m3u8'}}));
      if(id==='avjb'&&u.indexOf('/video/1/test/')>=0) return response(req,'PLAYER_CSRF = "token"');
      if(id==='avjb'&&u.indexOf('/player/spped.php')>=0) return response(req,{defaultKey:'a',sources:[{key:'b',url:'https://'+second+'/path/index.m3u8'},{key:'a',url:'https://'+first+'/path/index.m3u8'}]});
      if(id==='xhamster'&&u.indexOf('/videos/test')>=0) return response(req,'xplayerSettings = '+JSON.stringify({sources:{hls:{h264:{url:'https://'+first+'/path/index.m3u8',fallback:'https://'+second+'/path/index.m3u8'}}}})+';');
      if(id==='hkdoll'&&u.indexOf('/video/test')>=0) return response(req,DOLL_PAGE);
      assert(req.retry===0,'precheck must not retry same resource');
      assert(req.timeoutMs>0&&req.timeoutMs<=4000,'unbounded timeout');
      assert(req.maxBytes<=2*1024*1024,'unbounded body');
      const primary=u.indexOf(first)>=0;
      if(!entry) {entry=true;if(opts.cancelAtMedia) signal.aborted=true;}
      if(opts.mutate) opts.mutate(signal,calls);
      if(mode==='allBad'||(primary&&mode==='network')) throw new PluginError('NETWORK','injected TLS failure');
      if(primary&&mode==='timeout') throw new PluginError('TIMEOUT','injected timeout');
      if(primary&&/^fatal:/.test(mode)) throw new PluginError(mode.slice(6),'injected terminal error');
      if(primary&&/^status:/.test(mode)) return response(req,'failure',+mode.slice(7));
      if(primary&&mode==='html') return response(req,'<!doctype html> parking');
      if(primary&&mode==='redirectHttp') return response(req,'#EXTM3U\n#EXTINF:1,\na.ts',200,'http://'+first+'/index.m3u8');
      if(u.endsWith('key.bin')) {
        if(primary&&mode==='keyDown') throw new PluginError('NETWORK','key unavailable');
        return response(req,new Uint8Array(primary&&mode==='badKey'?15:16));
      }
      if(u.endsWith('seg.ts')||u.endsWith('seg.m4s')||u.endsWith('init.mp4')) {
        assert(req.responseType==='bytes','segment must use bytes');
        assert(req.headers.Range==='bytes=0-1023','segment range missing');
        if(primary&&mode==='segmentDown') throw new PluginError('NETWORK','segment unavailable');
        if(primary&&mode==='segmentHtml') return response(req,new Uint8Array([60,104,116,109,108,62]));
        return response(req,new Uint8Array([71,0,0,0]));
      }
      if(mode==='nestedTooDeep') return response(req,'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nchild.m3u8');
      if(mode==='master'&&u.endsWith('index.m3u8')) return response(req,'#EXTM3U\n#EXT-X-STREAM-INF:BANDWIDTH=100\nchild.m3u8');
      if(mode==='redirectBase'&&u.endsWith('index.m3u8')) return response(req,'#EXTM3U\n#EXTINF:1,\nseg.ts',200,'https://'+(primary?first:second)+'/relocated/list.m3u8');
      let text='#EXTM3U\n';
      if(mode==='large') text+=Array(3500).fill('# comment').join('\n')+'\n';
      if(['keyDown','badKey','encrypted'].indexOf(mode)>=0) text+='#EXT-X-KEY:METHOD=AES-128,URI="key.bin"\n';
      return response(req,text+'#EXTINF:1,\nseg.ts\n#EXT-X-ENDLIST');
    }} };
  const source=SOURCES[id].replace('export const meta =','const meta =').replace('export default function (hg)','function factory(hg)');
  const plugin=new Function(source+';return factory;')()(hg);
  const params=id==='mwxk62'?{mediaId:'1',serverId:opts.serverId}:id==='avjb'?{episodeId:'1/test'}:id==='hkdoll'?{episodeId:'/video/test'}:{episodeId:'/videos/test'};
  return {run:function(){boundary=Date.now();return plugin.media.resolvePlayback(params,{signal:signal});},calls:calls,first:first,second:second,signal:signal};
}
async function test(id,mode,expected,opts) {
  const m=make(id,mode,opts);let result,error;
  try{result=await m.run();}catch(e){error=e;}
  if(expected.indexOf('error:')===0) {
    assert(error&&error.code===expected.slice(6),id+' '+mode+' expected '+expected+' got '+(error&&error.stack));
    assert(!result,id+' returned streams on error');
    if(/^fatal:/.test(mode)||mode==='status:401'||mode==='status:429') assert(!m.calls.some(function(r){return r.url.indexOf(m.second)>=0;}),id+' retried terminal error');
  } else {
    assert(!error,id+' '+mode+': '+(error&&error.stack));
    assert(result.streams[0].url.indexOf(expected==='primary'?m.first:m.second)>=0,id+' '+mode+' wrong first stream');
    const chosen=expected==='primary'?m.first:m.second;
    assert(m.calls.some(function(r){return r.url.indexOf(chosen)>=0&&r.url.endsWith('seg.ts');}),id+' returned unverified stream');
    if(expected==='primary') assert(!m.calls.some(function(r){return r.url.indexOf(m.second)>=0;}),id+' eagerly contacted backup');
    if(mode==='redirectBase') assert(m.calls.some(function(r){return r.url.indexOf('/relocated/seg.ts')>=0;}),'final response URL base not used');
  }
  count++;console.log('PASS '+id+' '+mode);
}
(async function(){
 for(const id of ids) {
  for(const mode of ['ok','master','encrypted','redirectBase','large']) await test(id,mode,'primary');
  for(const mode of ['network','timeout','status:403','status:404','status:500','html','redirectHttp','keyDown','badKey','segmentDown','segmentHtml']) await test(id,mode,'backup');
  for(const code of ['AUTH_REQUIRED','CONTENT_LOCKED','CANCELLED','AUTH_EXPIRED','RATE_LIMITED','INVALID_ARGUMENT','INTERNAL']) await test(id,'fatal:'+code,'error:'+code);
  await test(id,'status:401','error:AUTH_REQUIRED');
  await test(id,'status:429','error:RATE_LIMITED');
  await test(id,'allBad','error:NETWORK');
  await test(id,'nestedTooDeep','error:UPSTREAM_CHANGED');
  await test(id,'ok','error:CANCELLED',{aborted:true});
  await test(id,'ok','error:CANCELLED',{cancelAtMedia:true});
 }
 // Saved selected KKAV server is validated too; failures still select the other server.
 const selected=make('mwxk62','ok',{serverId:'l1'}); const r=await selected.run();
 assert(r.streams[0].serverId==='l1','explicit selected server not preserved');count++;
 const stale=make('mwxk62','allBad',{serverId:'l1'});let e;try{await stale.run();}catch(x){e=x;}assert(e&&e.code==='NETWORK','all selected servers bad returned streams');count++;
 assert(maxSlice<1000,'synchronous slice exceeded hard limit: '+maxSlice);
 console.log('RESULT '+count+' passed; observed longest synchronous slice '+maxSlice+'ms');
})().catch(function(e){console.log('FAIL '+e.stack); if(typeof process!=='undefined')process.exitCode=1;else throw e;});
