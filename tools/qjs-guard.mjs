// 卡死检查：在 QuickJS（与 HGhub App 同类的引擎）里运行插件，测量「插件自身最长连续同步执行时间」。
// HGhub 规定一次连续同步执行超过 1 秒就强行中断，连续 3 次停用插件（「运行时连续故障」）。
// 电脑上的 node 比手机快很多，node 体检发现不了这类问题，所以单独在 QuickJS 里量。
//
// 用法：qjs --module tools/qjs-guard.mjs <插件文件> [超时秒数]
// 输出一行 JSON：{ id, maxSliceMs, at, steps, ok, error }
// 计时口径：网络请求由宿主异步完成，不算插件时间；每次 await 返回到插件后重新计时。
import * as std from 'std';
import * as os from 'os';

const file = scriptArgs[1];
const limitSec = Number(scriptArgs[2] || 120);
const t0 = Date.now();
let maxSlice = 0, maxAt = '', sliceStart = Date.now(), phase = 'load', enteredBy = 'start';
// 进入插件代码时开始计时，回到宿主（发出请求 / 让出）时结算
function enter(by) { sliceStart = Date.now(); hostSpent = 0; enteredBy = by || '?'; }
// 看门狗：一段同步执行超过 HARD_MS 就直接判定卡死并退出（App 里此时早已被强行中断）。
// 只能在插件调用宿主接口时检查，纯计算循环里不调用宿主的情况由外层 timeout 兜底。
const HARD_MS = Number(std.getenv('QJS_GUARD_HARD_MS') || 5000);
function watchdog(where) {
  const d = Date.now() - sliceStart - hostSpent;
  if (d > HARD_MS) {
    result.maxSliceMs = d; result.at = phase + ' · ' + enteredBy + ' → ' + where; result.ms = Date.now() - t0; result.ok = false;
    result.error = '同步执行已超过 ' + HARD_MS + 'ms 仍未让出（App 里会被强行中断）';
    std.out.puts(JSON.stringify(result) + '\n'); std.out.flush(); std.exit(0);
  }
}
const top = []; function leave(where) { const d = Date.now() - sliceStart - hostSpent; top.push([d, phase + ' · ' + enteredBy + ' → ' + where]); if (d > maxSlice) { maxSlice = d; maxAt = phase + ' · ' + enteredBy + ' → ' + where; } }

class PluginError extends Error {
  constructor(code, message, extra) { super(message); this.code = code; Object.assign(this, extra || {}); }
}
const enc = s => unescape(encodeURIComponent(s));
function shellQuote(s) { return "'" + String(s).replace(/'/g, "'\\''") + "'"; }
let seq = 0;
const tmp = std.getenv('TMPDIR') || '/tmp';

// 同步 curl：只在「宿主」里调用，计时已在调用前结算
function curl(req) {
  const id = (++seq) + '_' + os.now ? Math.floor(Math.random() * 1e9) : seq;
  const hf = `${tmp}/qg_${id}_h.txt`, bf = `${tmp}/qg_${id}_b.bin`;
  const args = ['curl', '-s', '--compressed', '-m', String(Math.min((req.timeoutMs || 15000) / 1000, 30)), '-D', hf, '-o', bf, '-w', '%{http_code} %{url_effective}'];
  if (req.redirect !== 'manual') args.push('-L');
  const headers = Object.assign({ 'User-Agent': 'HGhub/0.0.4' }, req.headers || {});
  let url = req.url;
  if (req.query) { const q = Object.entries(req.query).filter(([, v]) => v !== undefined).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&'); if (q) url += (url.includes('?') ? '&' : '?') + q; }
  let body = req.body;
  if (body && typeof body === 'object') {
    if (body.json !== undefined) { headers['Content-Type'] = headers['Content-Type'] || 'application/json'; body = JSON.stringify(body.json); }
    else if (body.form) { headers['Content-Type'] = headers['Content-Type'] || 'application/x-www-form-urlencoded'; body = Object.entries(body.form).map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&'); }
    else if (body.text !== undefined) body = body.text;
  }
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  if (req.method && req.method !== 'GET') args.push('-X', req.method);
  if (body !== undefined && body !== null) args.push('--data-binary', enc(String(body)));
  args.push(url);
  const p = std.popen(args.map(shellQuote).join(' '), 'r'); const out = p.readAsString(); p.close();
  const sp = out.indexOf(' '); const status = Number(out.slice(0, sp)) || 0;
  const raw = std.loadFile(hf) || ''; const hdr = {}; const setCookies = [];
  for (const line of raw.split(/\r?\n/)) { const i = line.indexOf(':'); if (i > 0) { const k = line.slice(0, i).trim().toLowerCase(), v = line.slice(i + 1).trim(); if (k === 'set-cookie') setCookies.push(v); hdr[k] = v; } }
  let data;
  if (req.responseType === 'bytes') {
    const f = std.open(bf, 'rb'); const buf = []; if (f) { let c; while ((c = f.getByte()) >= 0) buf.push(c); f.close(); } data = new Uint8Array(buf);
  } else {
    const txt = std.loadFile(bf) || '';
    if (req.responseType === 'json') { try { data = JSON.parse(txt); } catch (e) { throw new PluginError('UPSTREAM_CHANGED', '响应不是 JSON'); } }
    else data = txt;
  }
  os.remove(hf); os.remove(bf);
  return { status, ok: status >= 200 && status < 300, url: out.slice(sp + 1), headers: hdr, setCookies, data, fromCache: false };
}

// 极简 HTML：插件常用 select/first/text/attr/html。用正则实现，够跑通流程即可（解析本身在 App 里是原生 Rust，不计入插件时间）
// App 里每个节点方法（select/first/text/attr/html）都是一次原生调用，这里同样包成宿主同步调用，不计入插件时间
function wrapNode(n) {
  if (!n) return n;
  return {
    attr: hostSync('html.node', k => n.attr(k)),
    text: hostSync('html.node', () => n.text()),
    html: hostSync('html.node', () => n.html()),
    select: hostSync('html.node', sel => n.select(sel).map(wrapNode)),
    first: hostSync('html.node', sel => wrapNode(n.first(sel))),
  };
}
function parseHTML(html) {
  html = String(html || '');
  function makeNode(start, end, tag, attrs) {
    const inner = html.slice(start, end);
    return {
      attr: n => { const m = attrs.match(new RegExp('(?:^|\\s)' + n.replace(/[-]/g, '\\-') + '\\s*=\\s*(?:"([^"]*)"|\'([^\']*)\'|([^\\s>]+))', 'i')); return m ? (m[1] ?? m[2] ?? m[3]) : null; },
      text: () => inner.replace(/<script[\s\S]*?<\/script>/gi, '').replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'),
      html: () => inner,
      select: sel => query(inner, sel),
      first: sel => query(inner, sel)[0] || null,
    };
  }
  function query(src, sel) {
    // 支持：tag、.cls、#id、[attr]、[attr*=v]、[attr^=v]、tag.cls、后代选择器（取最后一段近似匹配）
    const last = sel.split(',')[0].trim().split(/\s+/).pop();
    const m = last.match(/^([a-z0-9]*)?((?:\.[\w-]+)*)(?:#([\w-]+))?(?:\[([\w-]+)(?:([*^$]?=)["']?([^"'\]]*)["']?)?\])?/i) || [];
    const tag = m[1] || '[a-z0-9]+', classes = (m[2] || '').split('.').filter(Boolean), id = m[3], an = m[4], op = m[5], av = m[6];
    const re = new RegExp('<(' + tag + ')(\\s[^>]*)?>', 'gi'); const out = []; let r;
    while ((r = re.exec(src)) && out.length < 400) {
      const attrs = r[2] || '';
      const node = makeNode(0, 0, r[1], attrs);
      if (classes.length) { const c = ' ' + (node.attr('class') || '') + ' '; if (!classes.every(x => c.includes(' ' + x + ' '))) continue; }
      if (id && node.attr('id') !== id) continue;
      if (an) { const v = node.attr(an); if (v == null) continue; if (op === '=' && v !== av) continue; if (op === '*=' && !v.includes(av)) continue; if (op === '^=' && !v.startsWith(av)) continue; }
      const start = r.index + r[0].length; const close = src.indexOf('</' + r[1], start);
      const end = /^(img|br|hr|input|meta|link|source)$/i.test(r[1]) || close < 0 ? start : close;
      out.push(Object.assign(makeNode(start, end, r[1], attrs), { html: () => src.slice(start, end), text: () => src.slice(start, end).replace(/<[^>]+>/g, '').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&'), select: s2 => query(src.slice(start, end), s2), first: s2 => query(src.slice(start, end), s2)[0] || null }));
    }
    return out;
  }
  return { select: s => query(html, s), first: s => query(html, s)[0] || null, html: () => html, text: () => html.replace(/<[^>]+>/g, '') };
}

// 宿主同步接口：调用前结算插件时间、返回后重新计时（宿主内部耗时不算插件的）
// 口径（与 App 一致）：宿主的同步接口（html 解析、digest、编解码…）不会让出事件循环，
// 它们和插件代码连在一起算作同一段；但宿主内部耗时（这里的 curl/sha256sum/正则解析远慢于 App 的原生实现）要扣掉，
// 所以记下每次同步调用的宿主耗时，从当前段里减去。只有 await 异步接口或 setTimeout 才结束一段。
let hostSpent = 0;
function hostSync(name, fn) { return function () { watchdog(name); const t = Date.now(); try { return fn.apply(null, arguments); } finally { hostSpent += Date.now() - t; } }; }
// 宿主异步接口：在下一个事件循环里完成，插件的 await 期间不计时
function hostAsync(name, fn) {
  return function () {
    const a = arguments; leave(name);
    return new Promise((res, rej) => os.setTimeout(() => {
      // 宿主在这里同步执行（curl 等），这段时间不属于任何插件段：执行完后再开始计时
      let v, err; try { v = fn.apply(null, a); } catch (e) { err = e; }
      enter(name);
      if (err) rej(err); else res(v);
    }, 0));
  };
}
const store = {};
const hex = b => Array.from(b).map(x => (x < 16 ? '0' : '') + x.toString(16)).join('');
function sha256Bytes(str) {
  const p = std.popen('printf %s ' + shellQuote(enc(str)) + ' | sha256sum', 'r'); const h = p.readAsString().slice(0, 64); p.close();
  const out = new Uint8Array(32); for (let i = 0; i < 32; i++) out[i] = parseInt(h.substr(i * 2, 2), 16); return out;
}
const hg = {
  PluginError,
  env: { platform: 'ios', media: { codecs: ['h264', 'hevc'] }, features: ['charset.legacy', 'article.image'] },
  endpoint: { current: null },
  settings: { get: () => undefined },
  log: { debug() {}, info() {}, warn() {}, error() {} },
  http: { fetch: hostAsync('http.fetch', curl) },
  html: { parse: hostSync('html.parse', h => wrapNode(parseHTML(h))) },
  crypto: {
    digest: hostSync('crypto.digest', (alg, data) => sha256Bytes(typeof data === 'string' ? data : String.fromCharCode.apply(null, data))),
    hmac: hostSync('crypto.hmac', () => new Uint8Array(32)),
    randomBytes: hostSync('crypto.randomBytes', n => { const o = new Uint8Array(n || 16); for (let i = 0; i < o.length; i++) o[i] = Math.floor(Math.random() * 256); return o; }),
    randomUUID: hostSync('crypto.randomUUID', () => 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => { const r = Math.random() * 16 | 0; return (c === 'x' ? r : (r & 3 | 8)).toString(16); })),
    // 这里只保证「能跑完流程」，不保证解密结果正确：卡死检查只关心同步执行时长
    aesEncrypt: hostSync('crypto.aes', (p, d) => (typeof d === 'string' ? Uint8Array.from(enc(d), c => c.charCodeAt(0)) : d)),
    aesDecrypt: hostSync('crypto.aes', (p, d) => (typeof d === 'string' ? Uint8Array.from(enc(d), c => c.charCodeAt(0)) : d)),
    rsaEncrypt: hostSync('crypto.rsa', (p, d) => d),
  },
  codec: {
    base64Encode: hostSync('codec', v => btoaLike(typeof v === 'string' ? v : String.fromCharCode.apply(null, v))),
    base64Decode: hostSync('codec', v => atobLike(String(v))),
    utf8Encode: hostSync('codec', v => Uint8Array.from(enc(String(v)), c => c.charCodeAt(0))),
    utf8Decode: hostSync('codec', b => { try { return decodeURIComponent(escape(String.fromCharCode.apply(null, b))); } catch (e) { return String.fromCharCode.apply(null, b); } }),
    hexEncode: hostSync('codec', b => Array.from(b).map(x => (x < 16 ? '0' : '') + x.toString(16)).join('')),
    hexDecode: hostSync('codec', h => { const o = new Uint8Array(String(h).length >> 1); for (let i = 0; i < o.length; i++) o[i] = parseInt(String(h).substr(i * 2, 2), 16); return o; }),
    decodeText: hostSync('codec', (b) => { try { return decodeURIComponent(escape(String.fromCharCode.apply(null, b))); } catch (e) { return String.fromCharCode.apply(null, b); } }),
  },
  storage: {
    get: hostAsync('storage', k => store[k]), set: hostAsync('storage', (k, v) => { store[k] = v; }),
    delete: hostAsync('storage', k => { delete store[k]; }), keys: hostAsync('storage', p => Object.keys(store).filter(k => k.startsWith(p || ''))),
  },
  cookies: { set: hostAsync('cookies', () => {}), get: hostAsync('cookies', () => []) },
};
function atobLike(s) {
  const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  s = String(s).replace(/[^A-Za-z0-9+/]/g, ''); const out = [];
  for (let i = 0; i < s.length; i += 4) {
    const n = (c.indexOf(s[i]) << 18) | (c.indexOf(s[i + 1]) << 12) | ((c.indexOf(s[i + 2]) & 63) << 6) | (c.indexOf(s[i + 3]) & 63);
    out.push((n >> 16) & 255); if (s[i + 2]) out.push((n >> 8) & 255); if (s[i + 3]) out.push(n & 255);
  }
  return new Uint8Array(out);
}
function btoaLike(s) { const c = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'; let o = '', i = 0; s = enc(s); while (i < s.length) { const a = s.charCodeAt(i++), b = s.charCodeAt(i++), d = s.charCodeAt(i++); o += c[a >> 2] + c[((a & 3) << 4) | (b >> 4)] + (isNaN(b) ? '=' : c[((b & 15) << 2) | (d >> 6)]) + (isNaN(d) ? '=' : c[d & 63]); } return o; }
// 插件里的 setTimeout 也是让出点
globalThis.setTimeout = (fn, ms) => { leave('setTimeout'); return os.setTimeout(() => { enter('setTimeout'); fn(); }, ms || 0); };
globalThis.clearTimeout = id => os.clearTimeout(id);
if (typeof globalThis.URL === 'undefined') {
  globalThis.URL = class { constructor(u, base) { const s = base && !/^[a-z]+:/i.test(u) ? String(base).replace(/\/[^/]*$/, '/') + u.replace(/^\//, '') : u; const m = String(s).match(/^([a-z]+:)\/\/([^/?#]+)([^?#]*)(\?[^#]*)?/i) || []; this.href = s; this.protocol = m[1] || ''; this.host = this.hostname = m[2] || ''; this.pathname = m[3] || '/'; this.search = m[4] || ''; this.origin = this.protocol + '//' + this.host; } toString() { return this.href; } };
}
if (typeof globalThis.URLSearchParams === 'undefined') {
  globalThis.URLSearchParams = class { constructor(i) { this.p = []; if (typeof i === 'string') for (const kv of i.replace(/^\?/, '').split('&')) { if (!kv) continue; const [k, v = ''] = kv.split('='); this.p.push([decodeURIComponent(k), decodeURIComponent(v)]); } else if (i) for (const k in i) this.p.push([k, String(i[k])]); } get(k) { const e = this.p.find(x => x[0] === k); return e ? e[1] : null; } set(k, v) { this.p = this.p.filter(x => x[0] !== k); this.p.push([k, String(v)]); } append(k, v) { this.p.push([k, String(v)]); } toString() { return this.p.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&'); } };
}

const result = { file: file.split('/').pop(), steps: [], ok: false };
function done(err) {
  leave('end');
  result.top = top.sort((a,b)=>b[0]-a[0]).slice(0,5).map(x=>x[0]+'ms '+x[1]); result.maxSliceMs = maxSlice; result.at = maxAt; result.ms = Date.now() - t0;
  if (err) result.error = (err.code ? err.code + ' ' : '') + String(err.message || err).slice(0, 160);
  result.ok = !err;
  std.out.puts(JSON.stringify(result) + '\n'); std.out.flush(); std.exit(0);
}
// 纯计算循环不调用宿主接口，看门狗抓不到；靠总超时兜底，并把「卡住时已连续执行多久」报出来
os.setTimeout(() => {
  const stuck = Date.now() - sliceStart - hostSpent;
  result.steps.push('总超时');
  result.stuckMs = stuck;
  if (stuck > HARD_MS) result.maxSliceMs = Math.max(maxSlice, stuck);
  done(new Error('超过 ' + limitSec + ' 秒未跑完' + (stuck > HARD_MS ? '；卡在一段连续执行里已 ' + stuck + 'ms（App 里会被强行中断）' : '')));
}, limitSec * 1000);

(async () => {
  enter();
  const mod = await import(file);
  phase = 'factory';
  const api = await mod.default(hg);
  result.id = mod.meta && mod.meta.id;
  const ctx = () => ({ signal: { aborted: false, addEventListener() {} }, deadline: Date.now() + 30000 });
  let sample = null;
  async function step(name, fn) {
    phase = name;
    try { const r = await fn(); result.steps.push(name + ' ✓'); return r; }
    catch (e) { result.steps.push(name + ' ✗ ' + (e.code || '') + ' ' + String(e.message || e).slice(0, 60)); return null; }
  }
  if (api.home) { const h = await step('home', () => api.home.getSections({}, ctx())); if (h) for (const s of h.items || []) if (!sample && s.items && s.items.length) sample = s.items[0]; }
  if (api.catalog) {
    const cats = await step('categories', () => api.catalog.getCategories({}, ctx())) || [];
    const leaves = []; for (const c of cats) { if (c.children && c.children.length) leaves.push(...c.children); else leaves.push(c); }
    // 并发拉前 4 个分类：App 的分类页就是这样并发请求的，最容易一起撞上大段同步计算
    const lists = await step('catalog.list×4', () => Promise.all(leaves.slice(0, 4).map(c => api.catalog.list({ categoryId: c.id }, ctx()))));
    if (lists) for (const l of lists) if (!sample && l.items && l.items.length) sample = l.items[0];
  }
  if (api.media && sample) {
    const d = await step('detail', () => api.media.getDetail({ id: sample.id }, ctx()));
    const pl = d && (d.playlists || []).find(p => p.episodes && p.episodes.length);
    if (pl) await step('playback', () => api.media.resolvePlayback({ mediaId: d.id || sample.id, episodeId: pl.episodes[0].id, playlistId: pl.id, reason: 'play', codecs: ['h264'] }, ctx()));
  }
  done(null);
})().catch(done);
