#!/usr/bin/env node
// 卡死检查的外层：对每个插件在 QuickJS 里跑一遍，超时未出结果即判定卡死
// （QuickJS 卡在同步循环时自身的定时器也不会触发，所以超时必须由外部施加）。
// 用法：node tools/guard.mjs [插件id...]    不传则检查全部
// 退出码：0 全部通过；1 有插件卡死
import { execFileSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PLUGINS = path.join(root, 'plugins');
const LIMIT = Number(process.env.GUARD_SEC || 150);        // 单个插件的总时长上限
const WARN_MS = Number(process.env.GUARD_WARN_MS || 300);  // 最长连续同步执行的告警线（App 的硬上限是 1000ms）
const ids = process.argv.slice(2).length ? process.argv.slice(2) : readdirSync(PLUGINS).filter(f => f.endsWith('.js')).map(f => f.replace(/\.js$/, ''));

let qjs = true;
try { execFileSync('qjs', ['-e', '1'], { stdio: 'ignore' }); } catch { qjs = false; }
if (!qjs) { console.error('未找到 qjs（QuickJS）。Alpine: apk add quickjs；Ubuntu: apt-get install -y quickjs'); process.exit(2); }

const rows = [];
for (const id of ids) {
  const file = path.join(PLUGINS, id + '.js');
  if (!existsSync(file)) { rows.push({ id, verdict: 'missing' }); continue; }
  let out = '', timedOut = false;
  try {
    out = execFileSync('qjs', ['--module', path.join(root, 'tools/qjs-guard.mjs'), file, String(LIMIT)],
      { encoding: 'utf8', timeout: (LIMIT + 20) * 1000, maxBuffer: 1 << 22 });
  } catch (e) {
    out = (e.stdout || '').toString();
    if (e.killed || e.signal) timedOut = true;
  }
  const line = out.trim().split('\n').filter(l => l.startsWith('{')).pop();
  let r = null; try { r = JSON.parse(line); } catch {}
  if (!r) {
    // 没有任何结果 = 卡在同步执行里出不来，正是 App 中「运行时连续故障」的成因
    rows.push({ id, verdict: 'STUCK', note: timedOut ? `${LIMIT}s 内无结果（卡在同步执行中）` : '无输出' });
  } else {
    const ms = r.maxSliceMs || 0;
    rows.push({ id, verdict: ms > 1000 ? 'STUCK' : ms > WARN_MS ? 'WARN' : 'ok', ms, at: r.at, steps: (r.steps || []).join(' / '), note: r.error });
  }
  const last = rows[rows.length - 1];
  console.log(`${last.verdict.padEnd(6)} ${id.padEnd(12)} ${last.ms !== undefined ? String(last.ms) + 'ms' : ''} ${last.at || ''} ${last.note || ''}`);
}
const bad = rows.filter(r => r.verdict === 'STUCK');
console.log(`\n合计 ${rows.length} 个：卡死 ${bad.length}，偏慢 ${rows.filter(r => r.verdict === 'WARN').length}`);
if (process.env.GUARD_JSON) console.log('JSON ' + JSON.stringify(rows));
process.exit(bad.length ? 1 : 0);
