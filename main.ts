/**
 * Token Radar — entrypoint. Reads the sealed snapshot, fits the value
 * model on the tokens that already trade, ranks every rankable pre-token
 * protocol by its implied launch value, and writes the board, the
 * dashboard's data, the dashboard itself, the screenshots and the
 * dossier into the output directory.
 *
 *   node main.ts [--input <snapshot.json>]
 *
 * The snapshot defaults to /input/snapshot.json (the grader's path) and
 * the output to $MAKEFUN_OUTPUT_DIR or ./out. Standard library only,
 * no network, deterministic: two runs write byte-identical output.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildDossier } from './vendor/makefun-board.ts';
import { loadSnapshot } from './lib/snapshot.ts';
import { fitModel } from './lib/model.ts';
import { validateModel } from './lib/validate.ts';
import { buildBoard } from './lib/board.ts';
import { renderProof } from './lib/proof.ts';
import type { BoardRow } from './lib/types.ts';

const ROOT = dirname(fileURLToPath(import.meta.url));

function argValue(flag: string): string | null {
  const at = process.argv.indexOf(flag);
  return at >= 0 && at + 1 < process.argv.length ? process.argv[at + 1] : null;
}

/** The board as the gate reads it: the rows with the fields the gate
 * checks, plus the fields the dashboard's own page reads. */
function boardJson(rows: BoardRow[]): string {
  const out = {
    rows: rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      age_days: r.age_days,
      age_known: r.age_known,
      rank: r.rank,
      implied_value_usd: r.implied_value_usd,
      multiple: r.multiple,
      growth: r.growth,
      readiness: r.readiness,
      watchlist: r.watchlist,
      verdict: r.farm.verdict,
      net_usd: Math.round(r.farm.net_usd),
      capital_usd: r.farm.capital_usd,
      gas_usd: r.farm.gas_usd,
      tbill_usd: Math.round(r.farm.tbill_usd * 100) / 100,
      hold_days: r.farm.hold_days,
      slice_usd: Math.round(r.farm.slice_usd * 100) / 100,
      farm_steps: r.farm_steps,
    })),
  };
  return JSON.stringify(out, null, 2) + '\n';
}

function main(): void {
  const input = argValue('--input') ?? process.env.MAKEFUN_INPUT ?? '/input/snapshot.json';
  const outDir = process.env.MAKEFUN_OUTPUT_DIR ?? join(ROOT, 'out');
  const snap = loadSnapshot(input);

  // Validation first: its leave-one-out spread is the farm band.
  const validation = validateModel(snap);
  const { model } = fitModel(snap, validation.band);
  const data = buildBoard(snap, model, validation.band, validation);

  mkdirSync(outDir, { recursive: true });
  const dashOut = join(outDir, 'dashboard');
  const shotsOut = join(outDir, 'screenshots');

  // The dashboard's generated files: the proof and the validation numbers.
  mkdirSync(dashOut, { recursive: true });
  cpSync(join(ROOT, 'dashboard'), dashOut, { recursive: true });
  writeFileSync(join(dashOut, '00-proof.md'), renderProof(data), 'utf8');
  writeFileSync(
    join(dashOut, 'validation.json'),
    JSON.stringify(data.validation, null, 2) + '\n',
    'utf8',
  );

  // The board and the page's data.
  writeFileSync(join(outDir, 'board.json'), boardJson(data.rows), 'utf8');
  const liveTop = [...snap.protocols]
    .filter((p) => p.mcap_usd !== null && p.mcap_usd > 0)
    .sort((a, b) => b.mcap_usd! - a.mcap_usd!)
    .slice(0, 24)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category ?? 'Unknown',
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      multiple: Math.round((p.mcap_usd! / p.tvl_usd) * 100) / 100,
    }));
  const comps = (() => {
    const best = new Map<string, { tvl: number; mcap: number }>();
    for (const p of snap.protocols) {
      if (!p.mcap_usd || p.mcap_usd <= 0) continue;
      const key = p.gecko_id ?? p.symbol ?? p.slug;
      const cur = best.get(key);
      if (!cur || p.tvl_usd > cur.tvl) best.set(key, { tvl: p.tvl_usd, mcap: p.mcap_usd });
    }
    return [...best.values()]
      .filter((c) => c.mcap / c.tvl >= 0.02 && c.mcap / c.tvl <= 20)
      .sort((a, b) => a.tvl - b.tvl);
  })();
  const pageData = {
    asOf: data.asOf,
    floorUsd: data.floorUsd,
    counts: data.counts,
    model: data.model,
    validation: data.validation,
    categories: data.categories,
    live: liveTop,
    comps,
    rows: data.rows.map((r) => ({
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      age_days: r.age_days,
      age_known: r.age_known,
      rank: r.rank,
      implied_value_usd: r.implied_value_usd,
      multiple: r.multiple,
      growth: r.growth,
      readiness: r.readiness,
      watchlist: r.watchlist,
      verdict: r.farm.verdict,
      net_usd: Math.round(r.farm.net_usd),
      capital_usd: r.farm.capital_usd,
      gas_usd: r.farm.gas_usd,
      tbill_usd: Math.round(r.farm.tbill_usd * 100) / 100,
      hold_days: r.farm.hold_days,
      slice_usd: Math.round(r.farm.slice_usd * 100) / 100,
      farm_steps: r.farm_steps,
    })),
  };
  writeFileSync(
    join(outDir, 'data.js'),
    'window.RADAR_DATA = ' + JSON.stringify(pageData) + ';\n',
    'utf8',
  );

  // Screenshots and the dossier. The dossier is built twice and must
  // match byte for byte, so a partial write can never slip through.
  if (existsSync(join(ROOT, 'screenshots'))) {
    rmSync(shotsOut, { recursive: true, force: true });
    cpSync(join(ROOT, 'screenshots'), shotsOut, { recursive: true });
  }
  const caps = {
    text_max_bytes: 65536,
    screenshots: { max: 4, max_bytes: 512 * 1024 },
    dashboard: { max_files: 400, max_bytes: 4 * 1024 * 1024 },
  };
  const dossier = buildDossier(outDir, caps);
  const again = buildDossier(outDir, caps);
  if (Buffer.compare(Buffer.from(dossier), Buffer.from(again)) !== 0) {
    throw new Error('main: the dossier does not rebuild identically');
  }
  writeFileSync(join(outDir, 'dossier.json'), dossier);
  const dossierText = JSON.parse(readFileSync(join(outDir, 'dossier.json'), 'utf8')) as {
    text: string;
  };
  console.log(
    `token-radar: ${data.rows.length} rows (${data.counts.farm} FARM / ${data.counts.thin} THIN / ${data.counts.skip} SKIP), ` +
      `LOO ${validation.looMedian.toFixed(2)}x, dossier ${dossier.length} bytes, text ${Buffer.byteLength(dossierText.text, 'utf8')} bytes`,
  );
}

main();
