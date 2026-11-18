/**
 * Local replica of the sealed 7-row gate. Reads an /output directory and
 * the sealed snapshot, prints one line per row, exits 1 on any failure.
 *
 *   node scripts/check.mjs <output-dir> [--input <snapshot.json>]
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { buildDossier } from '../vendor/makefun-board.ts';

const outDir = process.argv[2] ?? 'out';
let input = '/input/snapshot.json';
const at = process.argv.indexOf('--input');
if (at >= 0 && process.argv[at + 1]) input = process.argv[at + 1];

const snap = JSON.parse(readFileSync(input, 'utf8'));
const slugs = new Set(snap.protocols.map((p) => p.slug));
const watchlist = snap.watchlist;

let failures = 0;
function row(name, ok, detail) {
  console.log(`${ok ? 'pass' : 'FAIL'}  ${name}${detail ? ': ' + detail : ''}`);
  if (!ok) failures++;
}

function pngSize(buf) {
  if (buf.length < 24 || buf[0] !== 0x89 || buf[1] !== 0x50) return null;
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20), kind: 'PNG' };
}
function jpegSize(buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null;
  let i = 2;
  while (i < buf.length - 1) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) { i += 2; continue; }
    if (marker === 0xda) break;
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xc0 || marker === 0xc2) {
      return { w: buf.readUInt16BE(i + 7), h: buf.readUInt16BE(i + 5), kind: 'JPEG' };
    }
    i += 2 + len;
  }
  return null;
}

// 1. dashboard_files
{
  const dir = join(outDir, 'dashboard');
  const files = [];
  const walk = (d, rel) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const p = rel ? rel + '/' + e.name : e.name;
      if (e.isDirectory()) {
        if (e.name.startsWith('.')) throw new Error('dot-directory ' + p);
        walk(join(d, e.name), p);
      } else if (e.isFile()) files.push(p);
    }
  };
  let ok = true;
  let detail = '';
  try {
    walk(dir, '');
    const hasHtml = files.includes('index.html');
    const hasCss = files.some((f) => f.endsWith('.css'));
    const hasJs = files.some((f) => f.endsWith('.js'));
    const bytes = files.reduce((a, f) => a + statSync(join(dir, f)).size, 0);
    const badName = files.find((f) => !/^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/.test(f.split('/').pop()));
    let net = null;
    for (const f of files) {
      if (!/\.(html|css|js)$/.test(f)) continue;
      const text = readFileSync(join(dir, f), 'utf8');
      if (f.endsWith('.html')) {
        const m = text.match(/<[^>]+(href|src|action)\s*=\s*["']https?:\/\//i);
        if (m) { net = f + ': ' + m[0].slice(0, 60); break; }
      }
      if (f.endsWith('.css')) {
        const m = text.match(/https?:\/\//);
        if (m) { net = f + ': css names a URL'; break; }
      }
      if (f.endsWith('.js')) {
        const m = text.match(/(import|from|require)\s*\(?\s*["']https?:\/\//);
        if (m) { net = f + ': js imports a URL'; break; }
      }
    }
    ok = hasHtml && hasCss && hasJs && files.length <= 400 && bytes <= 4 * 1024 * 1024 && !badName && !net;
    detail = `${files.length} files, ${bytes} bytes` + (net ? ', ' + net : '') + (badName ? ', bad name ' + badName : '');
  } catch (e) {
    ok = false;
    detail = String(e.message);
  }
  row('dashboard_files', ok, detail);
}

// 2-5. board
let board = null;
{
  const raw = readFileSync(join(outDir, 'board.json'));
  const sizeOk = raw.length <= 8 * 1024 * 1024;
  let parsed = null;
  try {
    parsed = JSON.parse(raw.toString('utf8'));
  } catch { /* fall through */ }
  const rows = parsed && Array.isArray(parsed.rows) ? parsed.rows : Array.isArray(parsed) ? parsed : null;
  let ok = sizeOk && rows !== null && rows.length >= 100 && rows.length <= 4000;
  let detail = rows ? `${rows.length} rows` : 'unparsable';
  if (rows) {
    const bad = rows.find((r) =>
      typeof r.slug !== 'string' || !slugs.has(r.slug) ||
      typeof r.name !== 'string' || r.name.length === 0 ||
      !Number.isInteger(r.rank) || r.rank < 1 ||
      !Number.isInteger(r.implied_value_usd) || r.implied_value_usd < 1 ||
      r.implied_value_usd > 100_000_000_000_000 ||
      !Array.isArray(r.farm_steps));
    if (bad) { ok = false; detail = 'bad row: ' + JSON.stringify(bad).slice(0, 120); }
  }
  row('board_file', ok, detail);
  board = rows;

  if (rows) {
    const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
    const exact = ranks.length > 0 && ranks.every((v, i) => v === i + 1);
    const sorted = rows.every((r, i) => i === 0 || rows[i - 1].implied_value_usd >= r.implied_value_usd);
    const allSame = rows.length >= 2 && rows.every((r) => r.implied_value_usd === rows[0].implied_value_usd);
    row('sorted_by_value', exact && sorted && !allSame, exact ? '' : 'ranks not 1..N or values rise');
  } else {
    row('sorted_by_value', false, 'no board');
  }

  if (rows) {
    const have = new Set(rows.map((r) => r.slug));
    const missing = watchlist.filter((s) => !have.has(s));
    row('coverage', missing.length === 0, missing.length ? 'missing ' + missing.slice(0, 5).join(', ') : `${watchlist.length}/${watchlist.length} watchlist`);
  } else {
    row('coverage', false, 'no board');
  }

  if (rows) {
    const bad = rows.find((r) => {
      if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) return true;
      return r.farm_steps.some((s) => typeof s !== 'string' || s.trim().length < 20 || s.trim().length > 600);
    });
    row('farm_steps', !bad, bad ? 'bad steps on ' + bad.slug : 'all rows 3-12 steps, 20-600 chars');
  } else {
    row('farm_steps', false, 'no board');
  }
}

// 6. screenshots
{
  const dir = join(outDir, 'screenshots');
  let files = [];
  try {
    files = readdirSync(dir).filter((f) => !f.startsWith('.')).sort();
  } catch { /* none */ }
  let ok = files.length >= 3 && files.length <= 4;
  let detail = files.length + ' images';
  for (const f of files) {
    const buf = readFileSync(join(dir, f));
    const dim = pngSize(buf) ?? jpegSize(buf);
    if (!dim) { ok = false; detail = f + ' is not a whole PNG/JPEG'; break; }
    const long = Math.max(dim.w, dim.h);
    const short = Math.min(dim.w, dim.h);
    if (buf.length > 512 * 1024 || long > 1440 || short < 800) {
      ok = false;
      detail = `${f}: ${dim.kind} ${dim.w}x${dim.h}, ${buf.length} bytes`;
      break;
    }
    detail += ` ${f} ${dim.w}x${dim.h} ${Math.round(buf.length / 1024)}KB`;
  }
  row('screenshots', ok, detail);
}

// 7. dossier_matches
{
  let ok = false;
  let detail = '';
  try {
    const raw = readFileSync(join(outDir, 'dossier.json'));
    const rebuilt = buildDossier(outDir, {
      text_max_bytes: 65536,
      screenshots: { max: 4, max_bytes: 512 * 1024 },
      dashboard: { max_files: 400, max_bytes: 4 * 1024 * 1024 },
    });
    ok = raw.length <= 1.5 * 1024 * 1024 && Buffer.compare(raw, Buffer.from(rebuilt)) === 0;
    detail = `${raw.length} bytes` + (ok ? '' : ' (mismatch or over cap)');
  } catch (e) {
    detail = String(e.message);
  }
  row('dossier_matches', ok, detail);
}

console.log(failures === 0 ? 'gate: 7/7' : `gate: ${7 - failures}/7, ${failures} failed`);
process.exit(failures === 0 ? 0 : 1);
