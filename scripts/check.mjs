// Local gate replica for token-radar-01 v2: the same seven checks the sealed
// scorer runs, plus two extras the gate cannot see — the dashboard's farm
// steps must match board.json exactly, and two runs must be byte-identical.
// Usage: node scripts/check.mjs [outDir] [snapshot.json]
// Exit 0 when every check passes, 1 otherwise.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { runInNewContext } from 'node:vm';
import { buildDossier } from '../vendor/makefun-board.ts';

const outDir = process.argv[2] ?? 'out';
const snapPath = process.argv[3] ?? '/home/hatch/workspace/makefun/kits/token-radar-01-kit/token-radar-01-kit/input/snapshot.json';
const snap = JSON.parse(readFileSync(snapPath, 'utf8'));
const results = [];
function check(name, ok, detail) {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

// ---- helpers
function pngSize(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47 || buf.readUInt32BE(4) !== 0x0d0a1a0a) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}
const PLAIN_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

// ---- 1. dashboard_files
{
  const dir = join(outDir, 'dashboard');
  const files = [];
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) {
        if (e.name.startsWith('.')) { check('dashboard_files', false, `dot-directory ${p}`); }
        walk(join(d, e.name), p);
      } else if (e.isFile()) {
        if (!PLAIN_NAME.test(e.name)) { check('dashboard_files', false, `bad name ${p}`); }
        files.push({ path: p, size: statSync(join(d, e.name)).size });
      }
    }
  };
  walk(dir, '');
  const total = files.reduce((n, f) => n + f.size, 0);
  const hasHtml = files.some((f) => f.path === 'index.html');
  const hasCss = files.some((f) => f.path.endsWith('.css'));
  const hasJs = files.some((f) => f.path.endsWith('.js'));
  let bad = null;
  for (const f of files) {
    const text = readFileSync(join(dir, f.path), 'utf8');
    if (f.path.endsWith('.html')) {
      const attrs = [...text.matchAll(/(?:href|src|action|poster|data)\s*=\s*["']([^"']*)["']/gi)].map((m) => m[1]);
      if (attrs.some((a) => /^https?:\/\//i.test(a))) { bad = `${f.path}: http(s) in an attribute`; break; }
    } else if (f.path.endsWith('.css')) {
      if (/https?:\/\//i.test(text)) { bad = `${f.path}: http(s) in CSS`; break; }
    } else if (f.path.endsWith('.js')) {
      const specs = [...text.matchAll(/(?:import\s+[^'"]*?from\s*|export\s+[^'"]*?from\s*|require\s*\(|import\s*\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1]);
      if (specs.some((s) => /^https?:\/\//i.test(s))) { bad = `${f.path}: http(s) import`; break; }
    }
  }
  check(
    'dashboard_files',
    hasHtml && hasCss && hasJs && files.length <= 400 && total <= 4 * 1024 * 1024 && !bad,
    `${files.length} files, ${total} bytes${bad ? ` — ${bad}` : ''}`,
  );
}

// ---- 2-5. board
const board = JSON.parse(readFileSync(join(outDir, 'board.json'), 'utf8'));
const rows = board.rows ?? board;
{
  const slugs = new Set(snap.protocols.map((p) => p.slug));
  const badRow = rows.find(
    (r) =>
      typeof r.slug !== 'string' || !slugs.has(r.slug) ||
      typeof r.name !== 'string' || r.name.length === 0 ||
      !Number.isInteger(r.rank) || r.rank <= 0 ||
      !Number.isInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 1e14 ||
      !Array.isArray(r.farm_steps),
  );
  const size = statSync(join(outDir, 'board.json')).size;
  check('board_file', rows.length >= 100 && rows.length <= 4000 && size <= 8 * 1024 * 1024 && !badRow, `${rows.length} rows, ${size} bytes${badRow ? ` — bad row ${badRow.slug ?? '?'}` : ''}`);
}
{
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  const ranksOk = ranks.every((r, i) => r === i + 1);
  const byRank = [...rows].sort((a, b) => a.rank - b.rank);
  const nonIncreasing = byRank.every((r, i) => i === 0 || r.implied_value_usd <= byRank[i - 1].implied_value_usd);
  const allSame = byRank.every((r) => r.implied_value_usd === byRank[0].implied_value_usd);
  check('sorted_by_value', ranksOk && nonIncreasing && !allSame, `ranks 1..${rows.length}, non-increasing: ${nonIncreasing}`);
}
{
  const have = new Set(rows.map((r) => r.slug));
  const missing = snap.watchlist.filter((s) => !have.has(s));
  check('coverage', missing.length === 0, `${snap.watchlist.length}/${snap.watchlist.length} watchlist covered${missing.length ? ` — missing ${missing.slice(0, 3).join(', ')}` : ''}`);
}
{
  const bad = rows.find((r) => r.farm_steps.length < 3 || r.farm_steps.length > 12 || r.farm_steps.some((s) => typeof s !== 'string' || s.trim().length < 20 || s.trim().length > 600));
  check('farm_steps', !bad, bad ? `bad steps on ${bad.slug}` : `all ${rows.length} rows carry 3-12 steps of 20-600 chars`);
}

// ---- 6. screenshots
{
  const dir = join(outDir, 'screenshots');
  const names = readdirSync(dir).filter((n) => !n.startsWith('.')).sort();
  let bad = null;
  for (const n of names) {
    const buf = readFileSync(join(dir, n));
    const size = pngSize(buf);
    if (!size) { bad = `${n}: not a PNG`; break; }
    if (buf.length > 512 * 1024) { bad = `${n}: ${buf.length} bytes over 512 KiB`; break; }
    const long = Math.max(size.w, size.h);
    const short = Math.min(size.w, size.h);
    if (long > 1440 || short < 800) { bad = `${n}: ${size.w}x${size.h}`; break; }
  }
  check('screenshots', names.length >= 3 && names.length <= 4 && !bad, `${names.length} images${bad ? ` — ${bad}` : ''}`);
}

// ---- 7. dossier_matches
{
  const mine = readFileSync(join(outDir, 'dossier.json'));
  const rebuilt = Buffer.from(buildDossier(outDir, { text_max_bytes: 65536 }));
  check('dossier_matches', mine.equals(rebuilt) && mine.length <= 1.5 * 1024 * 1024, `${mine.length} bytes, byte-identical to buildDossier: ${mine.equals(rebuilt)}`);
}

// ---- extra: dashboard steps match board.json
{
  const appJs = readFileSync(join(outDir, 'dashboard', 'app.js'), 'utf8');
  const dataJs = readFileSync(join(outDir, 'dashboard', 'data.js'), 'utf8');
  const sandbox = { window: {} };
  runInNewContext(dataJs, sandbox);
  runInNewContext(`${appJs}\nthis.__stepsFor = stepsFor; this.__rowFromArray = rowFromArray;`, sandbox);
  const band = sandbox.window.META.band;
  let mismatches = 0;
  let firstBad = null;
  for (const r of rows) {
    const arr = sandbox.window.BOARD.find((a) => a[0] === r.slug);
    if (!arr) { mismatches++; firstBad ??= `${r.slug}: not in data.js`; continue; }
    const row = sandbox.__rowFromArray(arr, band);
    const shown = sandbox.__stepsFor(row);
    if (JSON.stringify(shown) !== JSON.stringify(r.farm_steps)) {
      mismatches++;
      firstBad ??= `${r.slug}: step mismatch`;
    }
  }
  check('dashboard_steps_match_board', mismatches === 0, mismatches === 0 ? `all ${rows.length} rows match` : `${mismatches} mismatches, first: ${firstBad}`);
}

const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} passed`);
process.exit(failed === 0 ? 0 : 1);
