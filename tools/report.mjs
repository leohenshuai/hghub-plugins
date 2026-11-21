#!/usr/bin/env node
// 把体检与卡死检查的结果汇总成 STATUS.md（提交进仓库）和 issue.md（有问题时开 issue）。
// 用法：node tools/report.mjs audit.jsonl guard.log
import { readFileSync, writeFileSync, existsSync, appendFileSync } from 'node:fs';

const [auditFile, guardFile] = process.argv.slice(2);
const read = f => (f && existsSync(f) ? readFileSync(f, 'utf8') : '');

const audits = read(auditFile).split('\n').filter(l => l.trim().startsWith('{')).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
let guards = [];
const gline = read(guardFile).split('\n').find(l => l.startsWith('JSON '));
if (gline) { try { guards = JSON.parse(gline.slice(5)); } catch {} }
const guardOf = id => guards.find(g => g.id === id);

// 问题分级：播放不了 > 分类/搜索坏 > 轻微
function severity(r, g) {
  if (g && g.verdict === 'STUCK') return 2;
  if (!r || r.problems === undefined) return 2;
  const p = r.problems || [];
  if (p.some(x => /加载失败|视频流不可用|播放解析失败|播放无流|首页失败|分类列表失败/.test(x))) return 2;
  if (p.length) return 1;
  return 0;
}
const icon = s => (s === 2 ? '🔴' : s === 1 ? '🟡' : '🟢');

const rows = audits.map(r => {
  const g = guardOf(r.id);
  const s = severity(r, g);
  return { id: r.id, name: r.name || r.id, version: r.version || '', problems: r.problems || [], stream: r.stream || '', cats: r.categories, home: r.home, g, s };
}).sort((a, b) => b.s - a.s || a.id.localeCompare(b.id));

const failed = rows.filter(r => r.s === 2).length;
const warn = rows.filter(r => r.s === 1).length;
const now = new Date().toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

const head = `# 片源状态

更新于 ${now} · 共 ${rows.length} 个源 · 🔴 ${failed} 不可用 · 🟡 ${warn} 有小问题 · 🟢 ${rows.length - failed - warn} 正常

> 由 GitHub Actions 每天自动体检：分类（抽样）→ 首页 → 搜索 → 详情 → 实际请求视频流，
> 另在 QuickJS 里测「最长连续同步执行」（App 超过 1 秒会强行中断插件）。
> 服务器在境外机房，个别站点可能因地区限制或风控误报，以手机实测为准。

| | 源 | 版本 | 分类 | 首页 | 视频流 | 同步段 | 问题 |
|---|---|---|---|---|---|---|---|
`;
const body = rows.map(r => {
  const g = r.g;
  const gTxt = !g ? '-' : g.verdict === 'STUCK' ? `**卡死**` : g.ms !== undefined ? `${g.ms}ms` : '-';
  const probs = r.problems.length ? r.problems.slice(0, 3).map(x => x.replace(/\|/g, '/')).join('；') + (r.problems.length > 3 ? ` 等 ${r.problems.length} 项` : '') : '';
  return `| ${icon(r.s)} | ${r.name} \`${r.id}\` | ${r.version} | ${r.cats ?? '-'} | ${r.home ?? '-'} | ${(r.stream || '-').slice(0, 24)} | ${gTxt} | ${probs} |`;
}).join('\n');
writeFileSync('STATUS.md', head + body + '\n');

const broken = rows.filter(r => r.s >= 1);
if (broken.length) {
  const md = [`体检时间：${now}\n`, `🔴 ${failed} 个不可用，🟡 ${warn} 个有小问题。完整状态见 [STATUS.md](../blob/main/STATUS.md)。\n`];
  for (const r of broken) {
    md.push(`### ${icon(r.s)} ${r.name} \`${r.id}\` ${r.version}`);
    if (r.g && r.g.verdict === 'STUCK') md.push(`- **卡死**：${r.g.note || ''}（App 里会报「运行时连续故障」）`);
    else if (r.g && r.g.ms > 300) md.push(`- 同步执行偏长：${r.g.ms}ms @ ${r.g.at || ''}`);
    for (const p of r.problems) md.push(`- ${p}`);
    md.push('');
  }
  writeFileSync('issue.md', md.join('\n'));
}
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `failed=${failed + warn}\n`);
console.log(`汇总：${rows.length} 个源，🔴 ${failed}，🟡 ${warn}`);
