// 轻量 HPP 模拟宿主：只实现插件用到的 API，用于离线诊断（不是官方宿主）
import { parseHTML } from 'linkedom';
import { execFileSync, execFile } from 'node:child_process';
const execAsync = (cmd, args) => new Promise(res => execFile(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 26 }, (err, stdout) => res(stdout || '')));
import crypto from 'node:crypto';
import fs from 'node:fs';

class PluginError extends Error { constructor(code, message, extra) { super(message); this.code = code; this.extra = extra; } }

function wrap(el) {
  if (!el) return null;
  return {
    get tag() { return el.nodeType === 9 ? '#document' : (el.tagName || '').toLowerCase(); },
    select(s) { return Array.from(el.querySelectorAll(s)).map(wrap); },
    first(s) { return wrap(el.querySelector(s)); },
    text() { return (el.textContent || '').replace(/\s+/g, ' ').trim(); },
    ownText() { return Array.from(el.childNodes).filter(n => n.nodeType === 3).map(n => n.textContent).join('').replace(/\s+/g, ' ').trim(); },
    attr(n) { return el.getAttribute ? el.getAttribute(n) : null; },
    attrs() { const o = {}; for (const a of el.attributes || []) o[a.name] = a.value; return o; },
    html() { return el.innerHTML || ''; },
    outerHtml() { return el.outerHTML || ''; },
    parent() { return wrap(el.parentElement); },
    children() { return Array.from(el.children || []).map(wrap); },
  };
}

const jar = {};
let seq=0;
async function fetchImpl(req) {
  const tries=(req.retry||0)+1; let last;
  for(let t=0;t<tries;t++){ try{ return await fetchOnce(req); }catch(e){ last=e; if(e.code!=='NETWORK') throw e; } }
  throw last;
}
async function fetchOnce(req) {
  const tag=(++seq)+'_'+process.pid; const HF='/tmp/mh_'+process.pid+'_h'+tag+'.txt', BF='/tmp/mh_'+process.pid+'_b'+tag+'.bin', RF='/tmp/mh_'+process.pid+'_r'+tag+'.bin';
  let url = req.url;
  if (req.query) { const u = new URL(url); for (const [k, v] of Object.entries(req.query)) if (v !== undefined) u.searchParams.set(k, String(v)); url = u.toString(); }
  const args = ['-s', ...(req.redirect === 'manual' ? [] : ['-L']), '--compressed', '-m', String(Math.min((req.timeoutMs || 15000) / 1000, 30)), '-D', HF, '-o', BF, '-w', '%{http_code} %{url_effective}', '-X', req.method || 'GET'];
  const headers = { 'User-Agent': 'HGhub/0.0.2', ...(req.headers || {}) };
  const host = new URL(url).host;
  if (jar[host] && req.credentials !== 'omit') headers.Cookie = jar[host];
  let body = req.body;
  if (body && typeof body === 'object' && !(body instanceof Uint8Array)) {
    if (body.json !== undefined) { headers['Content-Type'] ||= 'application/json'; body = JSON.stringify(body.json); }
    else if (body.form) { headers['Content-Type'] ||= 'application/x-www-form-urlencoded'; body = new URLSearchParams(body.form).toString(); }
  }
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  if (body !== undefined) { fs.writeFileSync(RF, body); args.push('--data-binary', '@'+RF); }
  args.push(url);
  let out = '000 ' + url;
  out = (await execAsync('curl', args)) || ('000 ' + url);
  const [code, ...rest] = out.trim().split(' ');
  const status = Number(code);
  if (!status) throw new PluginError('NETWORK', '连接失败: ' + url);
  const raw = fs.existsSync(BF) ? fs.readFileSync(BF) : Buffer.alloc(0);
  const hdr = {}; const setCookies = [];
  for (const line of (fs.existsSync(HF) ? fs.readFileSync(HF, 'utf8') : '').split(/\r?\n/)) {
    const i = line.indexOf(':'); if (i < 1) continue;
    const k = line.slice(0, i).toLowerCase(), v = line.slice(i + 1).trim();
    if (k === 'set-cookie') setCookies.push(v); hdr[k] = v;
  }
  if (setCookies.length) jar[host] = setCookies.map(c => c.split(';')[0]).join('; ');
  let data;
  if (req.responseType === 'bytes') data = new Uint8Array(raw);
  else { const t = raw.toString('utf8'); if (req.responseType === 'json') { try { data = JSON.parse(t); } catch { throw new PluginError('UPSTREAM_CHANGED', 'JSON 解析失败 ' + t.slice(0, 80)); } } else data = t; }
  return { status, ok: status >= 200 && status < 300, url: rest.join(' '), headers: hdr, setCookies, data, fromCache: false };
}

const toBuf = d => typeof d === 'string' ? Buffer.from(d, 'utf8') : Buffer.from(d);
export function makeHost(settings = {}) {
  const STORE_FILE = process.env.HG_STORE || ((process.env.TMPDIR || '/tmp') + '/hg-store-' + (process.env.HG_PLUGIN || 'default') + '.json');
  let store = {}; try { store = JSON.parse(fs.readFileSync(STORE_FILE, 'utf8')); } catch (_) {}
  const save = () => { try { fs.writeFileSync(STORE_FILE, JSON.stringify(store)); } catch (_) {} };
  return {
    PluginError,
    env: { platform: 'ios', media: { codecs: ['h264', 'hevc'] }, features: ['charset.legacy', 'article.image'] },
    endpoint: { current: null },
    settings: { get: k => settings[k] },
    storage: {
      get: async k => { const e = store[k]; if (!e) return undefined; if (e.exp && e.exp < Date.now()) { delete store[k]; save(); return undefined; } return e.v; },
      set: async (k, v, o) => { store[k] = { v, exp: o && o.ttlSec ? Date.now() + o.ttlSec * 1000 : 0 }; save(); },
      delete: async k => { delete store[k]; save(); },
      keys: async p => Object.keys(store).filter(k => !p || k.startsWith(p)),
      clear: async () => { for (const k in store) delete store[k]; save(); },
    },
    cookies: { set: async () => {} },
    log: { info() {}, warn() {}, error() {} },
    http: { fetch: fetchImpl },
    html: { parse: h => { const { document } = parseHTML(h.includes('<html') ? h : `<html><body>${h}</body></html>`); return wrap(document); } },
    codec: {
      utf8Encode: t => new Uint8Array(Buffer.from(t, 'utf8')),
      utf8Decode: d => Buffer.from(d).toString('utf8'),
      base64Encode: (d, o = {}) => { let s = toBuf(d).toString(o.urlSafe ? 'base64url' : 'base64'); if (o.pad === false) s = s.replace(/=+$/, ''); return s; },
      base64Decode: t => new Uint8Array(Buffer.from(t.replace(/-/g, '+').replace(/_/g, '/'), 'base64')),
      hexEncode: d => toBuf(d).toString('hex'),
      hexDecode: t => new Uint8Array(Buffer.from(t, 'hex')),
      decodeText: (d) => Buffer.from(d).toString('utf8'),
    },
    crypto: {
      digest: (alg, d) => new Uint8Array(crypto.createHash(alg.toLowerCase().replace('-', '')).update(toBuf(d)).digest()),
      hmac: (alg, k, d) => new Uint8Array(crypto.createHmac(alg.toLowerCase().replace('-', ''), toBuf(k)).update(toBuf(d)).digest()),
      aesDecrypt: (p, d) => { const n = `aes-${p.key.length * 8}-${p.mode}`; const c = crypto.createDecipheriv(n, Buffer.from(p.key), p.mode === 'ecb' ? null : Buffer.from(p.iv)); c.setAutoPadding(p.padding !== 'none'); return new Uint8Array(Buffer.concat([c.update(Buffer.from(d)), c.final()])); },
      aesEncrypt: (p, d) => { const n = `aes-${p.key.length * 8}-${p.mode}`; const c = crypto.createCipheriv(n, Buffer.from(p.key), p.mode === 'ecb' ? null : Buffer.from(p.iv)); c.setAutoPadding(p.padding !== 'none'); return new Uint8Array(Buffer.concat([c.update(Buffer.from(d)), c.final()])); },
      randomUUID: () => crypto.randomUUID(),
      randomBytes: n => new Uint8Array(crypto.randomBytes(n)),
    },
  };
}
