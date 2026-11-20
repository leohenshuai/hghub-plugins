export const meta = {
  id: 'duobo',
  name: '多播 duobo',
  version: '1.0.0',
  protocol: 1,
  description: '多播 duobo.vip（草老板）：站内文章按日期与主播名匹配到对象存储里的 mp4，直接播放；分类、主播聚合、搜索。首次进入要建索引（约 10 秒），之后缓存 12 小时。',
  author: 'community',
  kind: 'source',
  mature: true,
  linkDomains: ['duobo.vip', 'sgp1.vultrobjects.com'],
  defaultHeaders: {
    Referer: 'https://duobo.vip/',
    'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
  },
  timeouts: { read: 30, playback: 30 },
};

const SITE = 'https://duobo.vip';
const BUCKET = 'https://sgp1.vultrobjects.com/pan.duobo.vip';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';
const PAGE = 30;
const TTL_MS = 12 * 3600 * 1000;
const CHUNK = 200 * 1024;   // hg.storage 单值上限 256 KiB

// ---- 匹配模块：移植自用户的 duobo userscript v4.9（DuoboMatcher），逻辑不变 ----
const Matcher = (function () {
  'use strict';
const PLAT = ['斗鱼', '虎牙', '网易CC', 'CC', '快手', '抖音', '花椒', 'YY', '来秀', '小心心',
    '维拉', '乐嗨', '漂漂', 'VV星球', 'CSM', 'bilibili', 'B站', '福利', '会员免费',
    '注册免费试看', '注册免费观看', '畅聊', 'XX'];

  const DEFAULTS = {
    confStrong: 0.60,
    confMid: 0.40,
    minGrams: 2,
    rareRatio: 0.04,
    wHit: 0.56,
    wCov: 0.44,
    bonusSameDay: 0.05,
    penaltyPerDay: 0.01,
    spanDays: 3
  };

  const Matcher = {
    PLAT,
    DEFAULTS,
    cfg: Object.assign({}, DEFAULTS),

    clean(s) {
      return String(s).replace(/\.(mp4|mov|m4v|ts)$/i, '').replace(/^[0-9A-Za-z]{5,}_/, '');
    },

    grams(s) {
      const out = new Set();
      for (const t of this.clean(s).match(/[\u4e00-\u9fff]+/g) || []) {
        const a = Array.from(t);
        for (let i = 0; i < a.length - 1; i++) out.add(a[i] + a[i + 1]);
      }
      return out;
    },

    anchors(title) {
      const NOISE = ['平台', '主播', '女主播', '御姐', '美女', '女神', '大尺度', '精选'];
      const out = [];
      for (const m of String(title).matchAll(/【([^】]+)】/g)) {
        let s = m[1];
        PLAT.forEach((p) => { s = s.split(p).join(''); });
        s = s.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '');
        if (s.length >= 2) out.push(s);
        let t = s;
        NOISE.forEach((w) => { t = t.split(w).join(''); });
        t = t.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '');
        if (t.length >= 2 && t !== s) out.push(t);
      }
      // 兜底：主播名写在【】之外的常见写法，如「虎牙美女主播车老板 12月热舞合集」
      const re = /(?:虎牙|斗鱼|快手|抖音|网易CC|CC|花椒|来秀|小心心|漂漂|畅聊|b站|bilibili)[丨|\s]*(?:美女主播|女主播|主播)?[丨|\s]*([\u4e00-\u9fffA-Za-z0-9]{2,8})/g;
      let mm;
      while ((mm = re.exec(String(title)))) {
        let t = mm[1].replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, '');
        if (t.length >= 2) out.push(t);
      }
      return [...new Set(out)];
    },

    /** 预计算：给每篇 post 挂 _g/_n，并建 IDF 表 */
    prepare(posts) {
      const df = new Map();
      posts.forEach((p) => {
        const g = this.grams(p.t);
        p._g = g;
        p._n = this.anchors(p.t);
        g.forEach((x) => df.set(x, (df.get(x) || 0) + 1));
      });
      // 按日期分桶，避免每个文件都全表扫描
      this._byDate = new Map();
      posts.forEach((p) => {
        p._ts = Date.parse(p.d + 'T00:00:00');
        const arr = this._byDate.get(p.d);
        if (arr) arr.push(p); else this._byDate.set(p.d, [p]);
      });
      const N = posts.length || 1;
      this._idf = new Map();
      this._dfr = new Map();
      df.forEach((c, x) => {
        this._idf.set(x, Math.log((N + 1) / (c + 1)));
        this._dfr.set(x, c / N);
      });
      this._max = Math.log(N + 1);
      return posts;
    },

    idf(g) {
      if (this._idf && this._idf.has(g)) return this._idf.get(g);
      return this._max || 1;
    },

    /** 单文件匹配：fileKey 形如 uploads/2026/03/19/xxx.mp4 */
    match(fileKey, posts, opts) {
      const cfg = Object.assign({}, this.cfg, opts || {});
      const parts = String(fileKey).split('/');
      const fd = parts.slice(1, 4).join('-');
      const fts = Date.parse(fd + 'T00:00:00');
      if (!fts) return { conf: 'none', score: 0 };
      const fn = parts[parts.length - 1];
      const fg = this.grams(fn);
      const tw = [...fg].reduce((a, g) => a + this.idf(g), 0);

      let best = null, bs = -9, bhit = 0;
      const pool = [];
      if (this._byDate) {
        const base = new Date(fd + 'T00:00:00');
        for (let i = -cfg.spanDays; i <= cfg.spanDays; i++) {
          const dt = new Date(base.getTime() + i * 86400000);
          const key = dt.getFullYear() + '-' + String(dt.getMonth() + 1).padStart(2, '0') + '-' + String(dt.getDate()).padStart(2, '0');
          const arr = this._byDate.get(key);
          if (arr) pool.push(...arr);
        }
      } else {
        pool.push(...posts);
      }
      for (const p of pool) {
        const d = Math.abs((p._ts || Date.parse(p.d + 'T00:00:00')) - fts) / 86400000;
        if (!(d <= cfg.spanDays)) continue;
        let hit = 0;
        for (const n of p._n) { if (n && fn.includes(n)) { hit = 1; break; } }
        let mw = 0;
        fg.forEach((g) => { if (p._g.has(g)) mw += this.idf(g); });
        const cov = tw > 1e-9 ? mw / tw : 0;
        let sc = cfg.wHit * hit + cfg.wCov * cov + (d === 0 ? cfg.bonusSameDay : 0) - cfg.penaltyPerDay * d;
        const dayCount = this._byDate ? (this._byDate.get(fd) || []).length : 0;
        const preferBoost = (dayCount === 1) || hit === 1 || cov >= 0.3;
        if (cfg.preferId && p.id === cfg.preferId && preferBoost) sc += 0.15;   // 同日唯一或确有关联才优先
        if (sc > bs) { bs = sc; best = p; bhit = hit; }
      }
      if (!best) return { conf: 'none', score: 0 };

      const rare = [...fg].some((g) => (this._dfr ? (this._dfr.get(g) || 0) : 0) < cfg.rareRatio);
      const informative = fg.size >= cfg.minGrams && rare;
      // 文件名信息不足，但当天只有这一篇文章 → 按同日唯一处理
      const sameDayOnly = fg.size >= 1 && !!(this._byDate && best && best.d === fd &&
        (this._byDate.get(fd) || []).length === 1);
      let conf = 'none';
      if (bhit && bs >= cfg.confMid) conf = 'strong';
      else if (informative && bs >= cfg.confStrong) conf = 'strong';
      else if (informative && bs >= cfg.confMid) conf = 'mid';
      else if (bhit && bs >= 0.25) conf = 'mid';
      else if (sameDayOnly) conf = 'mid';

      return { conf, score: +bs.toFixed(3), pid: best.id, title: best.t, date: best.d, hit: bhit, grams: fg.size, rare, sameDayOnly };
    }
  };


  return Matcher;
})();

export default function (hg) {
  function fail(code, message) { throw new hg.PluginError(code, message); }
  function clean(s) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim(); }
  function pageOf(c) { const n = parseInt(c || '1', 10); return Number.isFinite(n) && n > 0 ? n : 1; }
  function dec(s) { return String(s).replace(/&#(\d+);/g, function (_, n) { return String.fromCharCode(+n); }).replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#8211;|&ndash;/g, '–').replace(/&hellip;/g, '…'); }
  function hash32(s) { let x = 5381; for (let i = 0; i < s.length; i++) x = ((x * 33) ^ s.charCodeAt(i)) >>> 0; return x.toString(36); }
  function qk(k) { return k.split('/').map(encodeURIComponent).join('/'); }

  async function getText(url, headers, ctx) {
    const res = await hg.http.fetch({ url, headers: Object.assign({ 'User-Agent': UA }, headers || {}), responseType: 'text', timeoutMs: 25000, retry: 1, maxBytes: 8 * 1024 * 1024, signal: ctx && ctx.signal });
    if (!res.ok) fail('UPSTREAM_ERROR', '站点暂时不可用（HTTP ' + res.status + '）');
    return res;
  }

  // ---------- 索引：桶清单 + 文章 ----------
  async function listPrefix(prefix, ctx) {
    const items = [];
    let token = null, guard = 0;
    do {
      let url = BUCKET + '/?list-type=2&max-keys=1000&prefix=' + encodeURIComponent(prefix);
      if (token) url += '&continuation-token=' + encodeURIComponent(token);
      const xml = (await getText(url, { Referer: SITE + '/' }, ctx)).data;
      const keys = [], sizes = [];
      let m;
      const rk = /<Key>([\s\S]*?)<\/Key>/g, rs = /<Size>(\d+)<\/Size>/g;
      while ((m = rk.exec(xml))) keys.push(dec(m[1]));
      while ((m = rs.exec(xml))) sizes.push(+m[1]);
      for (let i = 0; i < keys.length; i++) if (/\.(mp4|mov|m4v|ts)$/i.test(keys[i])) items.push({ k: keys[i], s: sizes[i] || 0 });
      const t = /<NextContinuationToken>([\s\S]*?)<\/NextContinuationToken>/.exec(xml);
      token = t ? dec(t[1]) : null;
    } while (token && ++guard < 12);
    return items;
  }
  async function fetchPostPage(p, ctx) {
    const url = SITE + '/wp-json/wp/v2/posts?per_page=100&_fields=id,date,title,featured_media,categories&page=' + p;
    const res = await hg.http.fetch({ url, headers: { 'User-Agent': UA }, responseType: 'json', timeoutMs: 25000, retry: 1, signal: ctx && ctx.signal });
    if (res.status === 400) return { arr: [], total: 0 };         // 越界页
    if (!res.ok || !Array.isArray(res.data)) fail('UPSTREAM_ERROR', '文章接口暂时不可用（HTTP ' + res.status + '）');
    const tp = (res.headers && (res.headers['x-wp-totalpages'] || res.headers['X-WP-TotalPages'])) || 0;
    return { arr: res.data, total: +tp || 0 };
  }
  async function pool(list, n, fn) {
    const out = new Array(list.length); let i = 0;
    async function worker() { while (i < list.length) { const my = i++; try { out[my] = await fn(list[my]); } catch (e) { out[my] = null; } } }
    await Promise.all(Array.from({ length: Math.min(n, list.length) }, worker));
    return out;
  }

  // 存储：把大 JSON 切块写入（单值 ≤ 256 KiB，总 ≤ 5 MiB）
  async function saveBlob(name, obj) {
    const s = JSON.stringify(obj);
    const n = Math.ceil(s.length / CHUNK) || 1;
    for (let i = 0; i < n; i++) await hg.storage.set(name + ':' + i, s.slice(i * CHUNK, (i + 1) * CHUNK));
    await hg.storage.set(name + ':n', n);
    const old = await hg.storage.keys(name + ':');
    for (const k of old) { const m = k.match(/:(\d+)$/); if (m && +m[1] >= n) await hg.storage.delete(k); }
  }
  async function loadBlob(name) {
    const n = await hg.storage.get(name + ':n');
    if (!n) return null;
    let s = '';
    for (let i = 0; i < n; i++) { const c = await hg.storage.get(name + ':' + i); if (typeof c !== 'string') return null; s += c; }
    try { return JSON.parse(s); } catch (_) { return null; }
  }

  let mem = null;     // 本次运行时内的索引
  let building = null;

  async function build(ctx) {
    // 桶清单与文章并行：桶按年拆分并发（实测按月拆更慢，服务端会限速）
    const prefixes = []; const ny = new Date().getFullYear();
    for (let y = 2022; y <= ny; y++) prefixes.push('uploads/' + y + '/');
    const filesP = pool(prefixes, 5, function (p) { return listPrefix(p, ctx); });
    const postsP = (async function () {
      const first = await fetchPostPage(1, ctx);
      const totalPages = first.total || 1;
      const pages = []; for (let p = 2; p <= totalPages; p++) pages.push(p);
      const rest = await pool(pages, 4, function (p) { return fetchPostPage(p, ctx).then(function (r) { return r.arr; }); });
      return [first.arr].concat(rest);
    })();
    const both = await Promise.all([filesP, postsP]);
    const files = [].concat.apply([], both[0].map(function (l) { return l || []; }));
    if (!files.length) fail('UPSTREAM_ERROR', '读不到文件清单（对象存储暂不可用）');
    const posts = [];
    function take(arr) {
      for (const a of arr || []) {
        posts.push({ id: a.id, d: String(a.date || '').slice(0, 10), t: dec(((a.title && a.title.rendered) || '').replace(/<[^>]+>/g, '')), fm: a.featured_media || 0, c: a.categories || [] });
      }
    }
    both[1].forEach(take);
    if (!posts.length) fail('UPSTREAM_ERROR', '读不到文章索引');
    // 3) 匹配。已匹配过的文件复用上次结果（日期早于最近 10 天的文件，匹配结果不会再变）；只对新增文件跑算法
    Matcher.prepare(posts);
    const old = (mem && mem.map) || {};
    const prevByKey = {};
    for (const pid in old) for (const f of old[pid]) prevByKey[f[0]] = { pid: +pid, f };
    const prevNone = {}; ((mem && mem.none) || []).forEach(function (h) { prevNone[h] = 1; });
    const cutoff = Date.now() - 10 * 86400000;
    const postIds = {}; posts.forEach(function (p) { postIds[p.id] = 1; });
    const map = {}; const none = [];
    for (const f of files) {
      const key = f.k.slice(8);
      const parts = f.k.split('/');
      const fts = Date.parse(parts.slice(1, 4).join('-') + 'T00:00:00') || 0;
      const stable = fts && fts < cutoff;
      const hit = prevByKey[key];
      if (stable && hit && postIds[hit.pid]) { (map[hit.pid] = map[hit.pid] || []).push(hit.f); continue; }
      const hk = hash32(key);
      if (stable && prevNone[hk]) { none.push(hk); continue; }              // 上次判过没有对应文章
      const r = Matcher.match(f.k, posts, {});
      if (r.conf === 'none') { if (stable) none.push(hk); continue; }
      (map[r.pid] = map[r.pid] || []).push([key, f.s, r.conf === 'strong' ? 1 : 0]);
    }
    const slim = posts.filter(function (p) { return map[p.id]; }).map(function (p) { return [p.id, p.d, p.t, p.fm, p.c]; });
    slim.sort(function (a, b) { return a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : b[0] - a[0]; });
    for (const id in map) map[id].sort(function (a, b) { return a[0] < b[0] ? -1 : 1; });
    const matchedN = Object.keys(map).reduce(function (n, id) { return n + map[id].length; }, 0);
    return { ts: Date.now(), posts: slim, map, none, stat: { files: files.length, posts: posts.length, matchedPosts: slim.length, unmatched: files.length - matchedN } };
  }

  async function index(ctx, force) {
    if (mem && !force && Date.now() - mem.ts < TTL_MS) return mem;
    if (!force) {
      const saved = await loadBlob('idx');
      if (saved && saved.ts && Date.now() - saved.ts < TTL_MS) { mem = saved; return mem; }
      if (saved && saved.ts) mem = saved;     // 过期的先留着，建失败时兜底
    }
    if (!building) {
      building = build(ctx).then(async function (idx) { mem = idx; try { await saveBlob('idx', idx); } catch (_) {} return idx; })
        .finally(function () { building = null; });
    }
    // 首次建索引可能超过一次调用的时限：与时限竞速，超时给出明确提示；构建在后台继续，稍后重试即可
    if (mem) { try { return await building; } catch (e) { return mem; } }
    const limit = new Promise(function (_, rej) { setTimeout(function () { rej(new hg.PluginError('UNAVAILABLE', '正在首次建立索引（需要约 20～40 秒），请稍后下拉刷新重试')); }, 24000); });
    return await Promise.race([building, limit]);
  }

  // ---------- 主播聚合 ----------
  function anchorOf(title) { const a = Matcher.anchors(title); return a[0] || ''; }
  function platformOf(title) {
    for (const p of Matcher.PLAT) { if (title.indexOf(p) >= 0 && ['福利', '会员免费', '注册免费试看', '注册免费观看', '畅聊', 'XX'].indexOf(p) < 0) return p; }
    return '';
  }
  const CATS = { 27: 'CC定制', 614: '会员免费', 25: '虎牙定制', 618: '付费资源', 14: '极品定制', 26: '斗鱼定制', 197: '抖音定制', 175: '快手定制', 1741: '来秀', 1148: '漂漂定制', 463: 'bilibili', 1580: '注册试看福利', 580: '花椒定制', 96: 'CSM', 1153: '畅聊平台', 414: 'YY定制', 1651: 'VV星球' };

  function coverOf(mediaId) {
    return undefined;
  }
  // 封面：先用 featured_media id 取 source_url（批量接口，一次最多 100 个），缓存进内存
  const coverCache = {};
  async function loadCovers(ids, ctx) {
    const need = ids.filter(function (i, k) { return i && !coverCache[i] && ids.indexOf(i) === k; });
    for (let off = 0; off < need.length; off += 40) {
      const batch = need.slice(off, off + 40);
      const url = SITE + '/wp-json/wp/v2/media?per_page=100&_fields=id,source_url,media_details&include=' + batch.join(',');
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await hg.http.fetch({ url, headers: { 'User-Agent': UA }, responseType: 'json', timeoutMs: 20000, retry: 1, signal: ctx && ctx.signal });
          if (res.ok && Array.isArray(res.data)) {
            for (const m of res.data) {
              const sz = m.media_details && m.media_details.sizes;
              const u = (sz && sz.medium_large && sz.medium_large.source_url) || m.source_url || '';
              if (u) coverCache[m.id] = u;       // 只缓存成功的；失败/缺失下次还会再取
            }
            break;
          }
        } catch (_) {}
      }
    }
  }
  function toDur(title) {
    const m = String(title).match(/[（(](\d+)\s*V\s*[\/／]\s*([^）)]*)/);
    if (!m) return undefined;
    const rest = m[2]; let sec = 0;
    const hm = rest.match(/(\d+)\s*小时/); if (hm) sec += +hm[1] * 3600;
    const mm = rest.match(/(\d+)\s*分\s*(\d+)?/); if (mm) sec += +mm[1] * 60 + (mm[2] ? +mm[2] : 0);
    return sec || undefined;
  }

  async function toItems(rows, ctx) {
    await loadCovers(rows.map(function (r) { return r[3]; }), ctx);
    return rows.map(function (r) {
      const files = (mem && mem.map[r[0]]) || [];
      const it = { id: String(r[0]), title: clean(r[2]).slice(0, 120), type: 'movie', publishedAt: Date.parse(r[1] + 'T00:00:00') || undefined, year: +r[1].slice(0, 4) };
      const c = coverCache[r[3]]; if (c) { it.cover = c; it.backdrop = c; }
      if (files.length > 1) it.badge = files.length + ' 个视频';
      const d = toDur(r[2]); if (d) it.durationSec = d;
      return it;
    });
  }
  function slice(rows, cursor) {
    const page = pageOf(cursor); const a = rows.slice((page - 1) * PAGE, page * PAGE);
    return { rows: a, next: rows.length > page * PAGE ? String(page + 1) : null };
  }

  function rowsFor(idx, categoryId) {
    const id = String(categoryId || 'all');
    if (id === 'all') return idx.posts;
    if (id.indexOf('c:') === 0) { const cid = +id.slice(2); return idx.posts.filter(function (p) { return p[4].indexOf(cid) >= 0; }); }
    if (id.indexOf('a:') === 0) { const name = id.slice(2); return idx.posts.filter(function (p) { return anchorOf(p[2]) === name; }); }
    return idx.posts;
  }
  function topAnchors(idx, n) {
    const cnt = {};
    for (const p of idx.posts) { const a = anchorOf(p[2]); if (a && a.length <= 8) cnt[a] = (cnt[a] || 0) + 1; }
    return Object.keys(cnt).filter(function (k) { return cnt[k] >= 3; }).sort(function (a, b) { return cnt[b] - cnt[a]; }).slice(0, n).map(function (k) { return { id: 'a:' + k, label: k + ' (' + cnt[k] + ')' }; });
  }

  return {
    home: {
      async getSections(params, ctx) {
        const idx = await index(ctx);
        const sections = [];
        const latest = idx.posts.slice(0, 24);
        sections.push({ id: 'latest', title: '最新', layout: 'grid', imageAspect: 'landscape', items: await toItems(latest, ctx), more: idx.posts.length > 24 });
        const cats = [[614, '会员免费'], [25, '虎牙定制'], [27, 'CC定制']];
        for (const [cid, label] of cats) {
          const rows = rowsFor(idx, 'c:' + cid).slice(0, 12);
          if (rows.length) sections.push({ id: 'c' + cid, title: label, layout: 'row', imageAspect: 'landscape', items: await toItems(rows, ctx), more: true });
        }
        return { items: sections, next: null };
      },
      async listSection(params, ctx) {
        const idx = await index(ctx);
        const sid = String(params.sectionId || 'latest');
        const rows = sid === 'latest' ? idx.posts : rowsFor(idx, 'c:' + sid.slice(1));
        const s = slice(rows, params.cursor);
        return { items: await toItems(s.rows, ctx), next: s.next };
      },
    },

    catalog: {
      async getCategories(params, ctx) {
        const idx = await index(ctx);
        const tree = [{ id: 'all', label: '全部（按日期）' }];
        const cats = []; const have = {};
        for (const p of idx.posts) for (const c of p[4]) have[c] = (have[c] || 0) + 1;
        Object.keys(CATS).forEach(function (cid) { if (have[cid]) cats.push({ id: 'c:' + cid, label: CATS[cid] + ' (' + have[cid] + ')' }); });
        tree.push({ id: 'cat', label: '站内分类', children: cats });
        const an = topAnchors(idx, 60);
        if (an.length) tree.push({ id: 'anchor', label: '热门主播', children: an });
        return tree;
      },
      async list(params, ctx) {
        const idx = await index(ctx);
        const s = slice(rowsFor(idx, params.categoryId), params.cursor);
        return { items: await toItems(s.rows, ctx), next: s.next };
      },
    },

    search: {
      async search(params, ctx) {
        const q = clean(params && params.query).toLowerCase();
        if (!q) return { items: [], next: null };
        const idx = await index(ctx);
        const rows = idx.posts.filter(function (p) {
          if (p[2].toLowerCase().indexOf(q) >= 0) return true;
          const fs = idx.map[p[0]] || [];
          return fs.some(function (f) { return f[0].toLowerCase().indexOf(q) >= 0; });
        });
        const s = slice(rows, params.cursor);
        return { items: await toItems(s.rows, ctx), next: s.next };
      },
    },

    media: {
      async getDetail(params, ctx) {
        const id = String((params && params.id) || '');
        if (!/^\d+$/.test(id)) fail('INVALID_ARGUMENT', '作品 ID 无效');
        const idx = await index(ctx);
        const row = idx.posts.find(function (p) { return String(p[0]) === id; });
        const files = idx.map[id] || [];
        if (!row || !files.length) fail('NOT_FOUND', '这篇文章没有匹配到视频文件');
        const detail = { id, title: clean(row[2]), type: 'movie', publishedAt: Date.parse(row[1] + 'T00:00:00') || undefined, year: +row[1].slice(0, 4) };
        await loadCovers([row[3]], ctx);
        const c = coverCache[row[3]]; if (c) { detail.cover = c; detail.backdrop = c; }
        const plat = platformOf(row[2]), who = anchorOf(row[2]);
        const tags = []; if (plat) tags.push(plat); if (who) tags.push(who);
        row[4].forEach(function (cid) { if (CATS[cid]) tags.push(CATS[cid]); });
        if (tags.length) detail.tags = tags.filter(function (t, i) { return tags.indexOf(t) === i; });
        const sureAll = files.every(function (f) { return f[2] === 1; });
        detail.description = '文件由发布日期与主播名自动匹配到本篇' + (sureAll ? '。' : '，其中带「推测」的文件匹配把握较低，可能不是本篇内容。');
        detail.playlists = [{ id: 'main', label: '视频', episodes: files.map(function (f, i) {
          const base = f[0].split('/').pop().replace(/\.(mp4|mov|m4v|ts)$/i, '').replace(/^[0-9A-Za-z]{5,}_/, '');
          return { id: String(i), index: i + 1, episodeNumber: i + 1, label: String(i + 1), title: (f[2] === 1 ? '' : '推测 · ') + (base || ('视频 ' + (i + 1))).slice(0, 60) };
        }) }];
        detail.episodeCount = files.length;
        return detail;
      },

      async resolvePlayback(params, ctx) {
        const id = String((params && params.mediaId) || '');
        const idx = await index(ctx);
        const files = idx.map[id] || [];
        const i = parseInt((params && params.episodeId) || '0', 10) || 0;
        const f = files[i];
        if (!f) fail('NOT_FOUND', '没有这个视频文件');
        return {
          streams: [{ url: BUCKET + '/uploads/' + qk(f[0]), kind: 'media', format: 'progressive', label: '原始视频',
            headers: { Referer: SITE + '/', 'User-Agent': UA } }],
        };
      },

      matchUrl(params) {
        const m = String((params && params.url) || '').match(/duobo\.vip\/(\d+)\.html/);
        return m ? { mediaId: m[1] } : null;
      },
    },

    ui: {
      async getActions() {
        return [{ id: 'rebuild', label: '重建索引', description: '重新读取文件清单与文章并重新匹配（约 10 秒）', form: { fields: [] } }];
      },
      async submit(params, ctx) {
        const idx = await index(ctx, true);
        return { status: 'ok', message: '已重建：文件 ' + idx.stat.files + '，文章 ' + idx.stat.posts + '，匹配到 ' + idx.stat.matchedPosts + ' 篇，未匹配文件 ' + idx.stat.unmatched };
      },
    },
  };
}
