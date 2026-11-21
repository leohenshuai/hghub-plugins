// 全面体检：每个源 → 分类(第1/2页+翻页重复) → 首页 → 搜索 → 详情 → 播放地址 → 实际请求视频流
// 用法：DIR=插件目录 node audit.mjs id1 id2 ...   输出 JSON 行到 stdout，人类可读摘要到 stderr
import { makeHost } from './host.mjs';
import { execFileSync } from 'node:child_process';

const ids = process.argv.slice(2);
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const DIR = process.env.DIR || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../plugins');
// 定时体检里分类只抽样（MAX_CATS），手动全面体检不设上限
const MAX_CATS = Number(process.env.MAX_CATS || 0);
const ctx = { signal: new AbortController().signal };
const T = (p, ms = 45000) => Promise.race([p, new Promise((_, r) => setTimeout(() => r(Object.assign(new Error('超时 ' + ms / 1000 + 's'), { code: 'TIMEOUT' })), ms))]);
const errStr = e => `${e.code || 'ERR'} ${String(e.message || e).slice(0, 140)}`;
const log = (...a) => process.stderr.write(a.join(' ') + '\n');

function probeStream(s) {
  if (!s || !s.url) return 'no-url';
  if (s.kind === 'page' || s.kind === 'external') return 'page:' + s.url.slice(0, 80);
  const args = ['-s', '-L', '-m', '20', '-r', '0-2047', '-o', (process.env.TMPDIR||'/tmp')+'/mh_'+process.pid+'_stream.bin', '-w', '%{http_code} %{content_type}'];
  for (const [k, v] of Object.entries(s.headers || {})) args.push('-H', `${k}: ${v}`);
  args.push(s.url);
  let out = '000';
  try { out = execFileSync('curl', args, { encoding: 'utf8' }); } catch (e) { out = e.stdout || '000'; }
  let head = '';
  try { head = execFileSync('head', ['-c', '200', (process.env.TMPDIR||'/tmp')+'/mh_'+process.pid+'_stream.bin'], { encoding: 'latin1' }); } catch {}
  const isM3u8 = head.startsWith('#EXTM3U');
  const isHtml = /<html|<!doctype/i.test(head);
  return `${out.trim()}${isM3u8 ? ' [m3u8]' : ''}${isHtml ? ' [HTML!]' : ''}`;
}

const SEARCH_WORDS = { default: ['爱', '的'], mature: ['麻豆', 'jav'] };

for (const id of ids) {
  const r = { id, problems: [] };
  let api, meta;
  try {
    const mod = await import(`${DIR}/${id}.js?t=${Date.now()}`);
    meta = mod.meta; api = await mod.default(makeHost());
  } catch (e) { r.problems.push('加载失败 ' + errStr(e)); console.log(JSON.stringify(r)); continue; }
  r.name = meta.name; r.version = meta.version;
  r.caps = Object.keys(api).filter(k => typeof api[k] === 'object');
  log(`\n## ${id} (${meta.name} ${meta.version}) 能力: ${r.caps.join(',')}`);

  let sample = null; // 用于详情测试的作品
  const pick = items => { if (!sample && items && items.length) sample = items[Math.min(1, items.length - 1)]; };

  // 1) 分类
  if (api.catalog) {
    let cats = [];
    try { cats = await T(api.catalog.getCategories({}, ctx)); } catch (e) { r.problems.push('分类列表失败 ' + errStr(e)); }
    const leaves = [];
    for (const c of cats) { if (c.children && c.children.length) for (const s of c.children) leaves.push([c, s]); else leaves.push([null, c]); }
    r.categories = leaves.length;
    log(`  分类 ${leaves.length} 个`);
    const bad = [];
    const sampled = MAX_CATS && leaves.length > MAX_CATS ? leaves.filter((_, i) => i % Math.ceil(leaves.length / MAX_CATS) === 0) : leaves;
    if (sampled.length < leaves.length) log(`  （抽样 ${sampled.length}/${leaves.length} 个分类）`);
    for (const [p, c] of sampled) {
      const name = (p ? (p.title || p.label) + '/' : '') + (c.title || c.label || c.id);
      if (!(c.title || c.label)) bad.push(`${name}: 无标题`);
      try {
        const a = await T(api.catalog.list({ categoryId: c.id, limit: 20 }, ctx));
        const n = (a.items || []).length;
        if (!n) { bad.push(`${name}: 空`); continue; }
        pick(a.items);
        const noCover = a.items.filter(i => !i.cover).length;
        if (noCover > n / 2) bad.push(`${name}: ${noCover}/${n} 无封面`);
        const dupIds = n - new Set(a.items.map(i => i.id)).size;
        if (dupIds) bad.push(`${name}: 同页重复 ${dupIds} 条`);
        if (a.next) {
          try {
            const b = await T(api.catalog.list({ categoryId: c.id, cursor: a.next, limit: 20 }, ctx));
            const m = (b.items || []).length;
            const ida = new Set(a.items.map(i => i.id));
            const overlap = (b.items || []).filter(i => ida.has(i.id)).length;
            if (!m) bad.push(`${name}: 第2页空(却声明有下一页)`);
            else if (overlap === m) bad.push(`${name}: 第2页与第1页完全相同(翻页无效)`);
            else if (overlap > m / 2) bad.push(`${name}: 第2页重复 ${overlap}/${m}`);
          } catch (e) { bad.push(`${name}: 第2页失败 ${errStr(e)}`); }
        }
      } catch (e) { bad.push(`${name}: ${errStr(e)}`); }
    }
    for (const b of bad) { r.problems.push('分类 ' + b); log('    ✗ ' + b); }
    if (!bad.length && leaves.length) log('    ✓ 全部分类有内容且翻页正常');
  }

  // 2) 首页
  if (api.home) {
    try {
      const h = await T(api.home.getSections({}, ctx));
      const n = (h.items || []).reduce((s, x) => s + ((x.items || []).length), 0);
      r.home = n; log(`  首页 ${h.items ? h.items.length : 0} 区 ${n} 条`);
      if (!n) r.problems.push('首页为空');
      for (const s of h.items || []) pick(s.items);
    } catch (e) { r.problems.push('首页失败 ' + errStr(e)); log('  ✗ 首页 ' + errStr(e)); }
  }
  if (api.feed) {
    try { const f = await T(api.feed.list({}, ctx)); const n = (f.items || []).length; log(`  信息流 ${n} 条`); if (!n) r.problems.push('信息流为空'); }
    catch (e) { r.problems.push('信息流失败 ' + errStr(e)); log('  ✗ 信息流 ' + errStr(e)); }
  }

  // 3) 搜索
  if (api.search) {
    const words = meta.mature ? SEARCH_WORDS.mature : SEARCH_WORDS.default;
    let ok = false, last = '';
    for (const q of words) {
      try {
        const t0 = Date.now();
        const s = await T(api.search.search({ query: q, limit: 20 }, ctx), 30000);
        const n = (s.items || []).length, sec = ((Date.now() - t0) / 1000).toFixed(1);
        log(`  搜索「${q}」${n} 条 ${sec}s`);
        if (n) { ok = true; pick(s.items); if (Number(sec) > 10) r.problems.push(`搜索慢 ${sec}s（影响聚合搜索）`); break; }
        last = `「${q}」0 条`;
      } catch (e) { last = errStr(e); log('  ✗ 搜索 ' + last); }
    }
    if (!ok) r.problems.push('搜索无结果/失败 ' + last);
  }

  // 4) 详情 + 播放
  if (api.media && sample) {
    try {
      const d = await T(api.media.getDetail({ id: sample.id }, ctx));
      const pls = d.playlists || [];
      const eps = pls.reduce((s, p) => s + (p.episodes || []).length, 0);
      log(`  详情「${(d.title || '').slice(0, 20)}」线路 ${pls.length} 集数 ${eps}`);
      if (!d.title) r.problems.push('详情无标题');
      if (!eps) r.problems.push('详情无分集');
      const pl = pls.find(p => (p.episodes || []).length);
      if (pl) {
        const ep = pl.episodes[0];
        try {
          const pb = await T(api.media.resolvePlayback({ mediaId: d.id || sample.id, episodeId: ep.id, playlistId: pl.id, reason: 'play', codecs: ['h264', 'hevc'] }, ctx));
          const st = (pb.streams || [])[0];
          if (!st) { r.problems.push('播放无流'); log('  ✗ 播放无流'); }
          else {
            const res = probeStream(st);
            log(`  播放 ${st.format || st.kind} → ${res}`);
            r.stream = res;
            if (/^(000|4\d\d|5\d\d)/.test(res) || res.includes('[HTML!]')) r.problems.push('视频流不可用 ' + res);
          }
        } catch (e) { r.problems.push('播放解析失败 ' + errStr(e)); log('  ✗ 播放 ' + errStr(e)); }
      }
    } catch (e) { r.problems.push('详情失败 ' + errStr(e)); log('  ✗ 详情 ' + errStr(e)); }
  } else if (api.media) { r.problems.push('没有可用样本，未测详情/播放'); }

  log(r.problems.length ? `  => ${r.problems.length} 个问题` : '  => 全部通过');
  console.log(JSON.stringify(r));
}
