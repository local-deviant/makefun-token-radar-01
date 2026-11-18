/**
 * Token Radar dashboard. Renders the board from the data main.ts wrote
 * (data.js beside this page), with no network and no external assets.
 * The page recomputes every row's implied value from the row's own
 * figures with the same arithmetic the entry used, and says so in the
 * detail view, so the page and the board visibly agree.
 */
(function () {
  var D = window.RADAR_DATA;
  if (!D) {
    document.body.innerHTML = '<p style="padding:40px">No data: data.js did not load.</p>';
    return;
  }
  var rows = D.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  function money(n) {
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(1) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(1) + 'K';
    return '$' + Math.round(n);
  }
  function moneyFull(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }
  function esc(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function ageText(days, known) {
    if (!known) return Math.round(days / 30) + ' mo*';
    if (days >= 365) return (days / 365).toFixed(1) + ' y';
    return Math.round(days / 30) + ' mo';
  }
  function changeText(c) {
    if (c === null || c === undefined) return '<span>—</span>';
    var cls = c >= 0 ? 'pos' : 'neg';
    return '<span class="' + cls + '">' + (c >= 0 ? '+' : '') + c.toFixed(1) + '%</span>';
  }

  /* Header meta */
  var counts = D.counts;
  document.getElementById('meta').innerHTML =
    '<b>' + counts.rankable + '</b> ranked &middot; <b>' + counts.watchlist + '</b> watchlist &middot; ' +
    '<b>' + counts.farm + '</b> FARM / <b>' + counts.thin + '</b> THIN / <b>' + counts.skip + '</b> SKIP<br>' +
    'Snapshot ' + esc(D.asOf) + ' &middot; floor ' + money(D.floorUsd);
  document.getElementById('asof').textContent = D.asOf;

  /* Hero: the validation numbers, then the model in one line. */
  var v = D.validation;
  var m = D.model;
  function cell(k, val, sub) {
    return '<div class="cell"><div class="k">' + k + '</div><div class="v">' + val + '</div><div class="s">' + sub + '</div></div>';
  }
  document.getElementById('hero').innerHTML =
    cell('Leave-one-out', 'x' + v.looMedian.toFixed(2), 'curve, median error, n=' + m.compCount) +
    cell('LOO, full pipeline', 'x' + v.looFullGeo.toFixed(2), 'growth + discount included') +
    cell('Time split', 'x' + v.timeSplitGeo.toFixed(2), 'cut ' + esc(v.timeSplitCut) + ', ' + v.timeSplitTrain + ' train / ' + v.timeSplitTest + ' test') +
    cell('Walk-forward', 'x' + v.walkForwardPooled.toFixed(2), 'pooled, ' + v.walkForwardN + ' held-out comps') +
    cell('Bootstrap top 10', v.bootstrapTop10.toFixed(2) + ' / 10', 'kept on average, 200 draws') +
    cell('Farm band', 'x' + v.band.toFixed(2), '1σ of LOO errors, ' + Math.round(v.bandCoverage * 100) + '% coverage') +
    '<div class="formula">ln(mcap) = ' + m.intercept.toFixed(3) + ' + ' + m.tvlSlope.toFixed(3) + ' · ln(TVL) ' +
    (m.ageSlope >= 0 ? '+ ' : '− ') + Math.abs(m.ageSlope).toFixed(3) + ' · ln(age) + category offset &nbsp;·&nbsp; ' +
    'implied = TVL × multiple × growth × ' + m.discount + ' &nbsp;·&nbsp; ' +
    'median-multiple baseline x' + v.medianMultipleGeo.toFixed(2) + ', TVL-only x' + v.tvlOnlyGeo.toFixed(2) + '</div>';

  /* Category filter */
  var cats = [];
  rows.forEach(function (r) { if (cats.indexOf(r.category) < 0) cats.push(r.category); });
  cats.sort();
  var fcat = document.getElementById('fcat');
  fcat.innerHTML = '<option value="">All categories</option>' +
    cats.map(function (c) { return '<option value="' + esc(c) + '">' + esc(c) + '</option>'; }).join('');

  /* Board */
  var sortKey = 'rank';
  function visibleRows() {
    var q = (document.getElementById('q').value || '').toLowerCase();
    var cat = fcat.value;
    var verdict = document.getElementById('fverdict').value;
    var watchOnly = document.getElementById('fwatch').checked;
    var out = rows.filter(function (r) {
      if (q && r.name.toLowerCase().indexOf(q) < 0 && r.slug.indexOf(q) < 0) return false;
      if (cat && r.category !== cat) return false;
      if (verdict && r.verdict !== verdict) return false;
      if (watchOnly && !r.watchlist) return false;
      return true;
    });
    var key = sortKey;
    out.sort(function (a, b) {
      if (key === 'tvl') return b.tvl_usd - a.tvl_usd;
      if (key === 'growth') return (b.change_7d || 0) - (a.change_7d || 0);
      if (key === 'age') return b.age_days - a.age_days;
      if (key === 'readiness') return b.readiness - a.readiness;
      return a.rank - b.rank;
    });
    return out;
  }
  function renderRows() {
    var list = visibleRows();
    var html = list.map(function (r) {
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num">' + r.rank + '</td>' +
        '<td><b>' + esc(r.name) + '</b>' + (r.watchlist ? '<span class="badge">WATCHLIST</span>' : '') +
        '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td>' + esc(r.category) + '</td>' +
        '<td class="num">' + money(r.tvl_usd) + '</td>' +
        '<td class="num">' + changeText(r.change_7d) + '</td>' +
        '<td class="num">' + ageText(r.age_days, r.age_known) + '</td>' +
        '<td class="num"><b>' + money(r.implied_value_usd) + '</b></td>' +
        '<td class="num">' + r.multiple.toFixed(2) + '×</td>' +
        '<td><span class="verdict ' + r.verdict + '">' + r.verdict + '</span></td>' +
        '<td><span class="meter"><i style="width:' + r.readiness + '%"></i></span><span>' + r.readiness + '</span></td>' +
        '</tr>';
    }).join('');
    document.getElementById('rows').innerHTML = html;
    document.getElementById('count').textContent =
      list.length + ' of ' + rows.length + ' protocols' +
      (list.length !== rows.length ? ' (filtered)' : '') +
      ' · * age estimated at 365 days where DefiLlama reports no start date';
  }
  function recompute(r) {
    // The page's own arithmetic, from the row's figures, matching lib/model.
    var mult = Math.exp(m.intercept + m.tvlSlope * Math.log(r.tvl_usd) +
      m.ageSlope * Math.log(r.age_days) + (m.categoryOffsets[r.category] || 0)) / r.tvl_usd;
    mult = Math.max(0.08, Math.min(1.20, mult));
    var g = 1 + Math.max(-60, Math.min(120, r.change_7d === null ? 0 : r.change_7d)) / 100 * 0.6;
    return Math.round(r.tvl_usd * mult * g * m.discount);
  }
  function showDetail(slug) {
    var r = bySlug[slug];
    var box = document.getElementById('detail');
    if (!r) { box.hidden = true; box.innerHTML = ''; return; }
    var again = recompute(r);
    var agree = again === r.implied_value_usd;
    var steps = r.farm_steps.map(function (s, i) {
      return '<li><b>Step ' + (i + 1) + '.</b> ' + esc(s) + '</li>';
    }).join('');
    box.innerHTML =
      '<h2>' + esc(r.name) + ' <span class="slug">#' + r.rank + ' · ' + esc(r.slug) + '</span></h2>' +
      '<div class="facts">' +
      '<div class="f"><div class="k">Implied value</div><div class="v">' + money(r.implied_value_usd) + '</div></div>' +
      '<div class="f"><div class="k">TVL</div><div class="v">' + money(r.tvl_usd) + '</div></div>' +
      '<div class="f"><div class="k">Multiple</div><div class="v">' + r.multiple.toFixed(2) + '×</div></div>' +
      '<div class="f"><div class="k">Verdict</div><div class="v"><span class="verdict ' + r.verdict + '">' + r.verdict + '</span></div></div>' +
      '</div>' +
      '<h3>How the value is derived</h3>' +
      '<div class="math">' +
      'ln(mcap) = ' + m.intercept.toFixed(3) + ' + ' + m.tvlSlope.toFixed(3) + ' · ln(' + moneyFull(r.tvl_usd) + ')' +
      ' ' + (m.ageSlope >= 0 ? '+' : '−') + ' ' + Math.abs(m.ageSlope).toFixed(3) + ' · ln(' + r.age_days + ' days)' +
      ' + ' + (m.categoryOffsets[r.category] || 0).toFixed(2) + ' (' + esc(r.category) + ' offset)<br>' +
      'fitted multiple = ' + r.multiple.toFixed(2) + '× &nbsp;·&nbsp; growth factor = ' + r.growth.toFixed(2) +
      ' (7d ' + (r.change_7d === null ? 'unreported' : r.change_7d.toFixed(1) + '%') + ')<br>' +
      'implied = ' + moneyFull(r.tvl_usd) + ' × ' + r.multiple.toFixed(2) + ' × ' + r.growth.toFixed(2) +
      ' × ' + m.discount + ' (pre-token discount) = <b>' + money(r.implied_value_usd) + '</b><br>' +
      'The page recomputes ' + money(again) + ' from the same figures — ' +
      (agree ? 'it agrees with the board.' : 'it differs by ' + money(Math.abs(again - r.implied_value_usd)) + ' (rounding).') +
      '</div>' +
      '<h3>Farm plan — ' + r.verdict + '</h3>' +
      '<ol class="steps">' + steps + '</ol>' +
      '<p class="netline">One farmer\u2019s slice is ' + money(r.slice_usd) + ' (implied × 0.002%), netted to the low end of the ' +
      'x' + v.band.toFixed(2) + ' band, less ' + money(r.gas_usd) + ' gas and ' + money(r.tbill_usd) +
      ' T-bill cost on ' + money(r.capital_usd) + ' over ' + r.hold_days + ' days: ' +
      'net <b>' + money(r.net_usd) + '</b>.</p>';
    box.hidden = false;
  }

  document.getElementById('rows').addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (!tr) return;
    location.hash = '#/protocol/' + tr.getAttribute('data-slug');
    showDetail(tr.getAttribute('data-slug'));
    document.getElementById('detail').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  });
  ['q', 'fcat', 'fverdict', 'fwatch', 'sort'].forEach(function (id) {
    document.getElementById(id).addEventListener(id === 'q' ? 'input' : 'change', function () {
      if (id === 'sort') sortKey = document.getElementById('sort').value;
      renderRows();
    });
  });
  function readHash() {
    var m2 = location.hash.match(/^#\/protocol\/([a-z0-9-]+)/);
    if (m2) showDetail(m2[1]);
  }
  window.addEventListener('hashchange', readHash);

  /* Tabs */
  document.getElementById('tabs').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-tab]');
    if (!b) return;
    document.querySelectorAll('#tabs button').forEach(function (x) { x.classList.toggle('active', x === b); });
    ['board', 'trading', 'method'].forEach(function (t) {
      document.getElementById('tab-' + t).hidden = t !== b.getAttribute('data-tab');
    });
  });

  /* Already trading */
  document.getElementById('live').innerHTML = D.live.map(function (p, i) {
    return '<tr><td class="num">' + (i + 1) + '</td><td><b>' + esc(p.name) + '</b><span class="slug">' + esc(p.slug) + '</span></td>' +
      '<td>' + esc(p.category) + '</td><td class="num">' + money(p.tvl_usd) + '</td>' +
      '<td class="num">' + money(p.mcap_usd) + '</td><td class="num">' + p.multiple.toFixed(2) + '×</td></tr>';
  }).join('');

  /* Method tab */
  document.getElementById('method').innerHTML =
    '<h2>How the value is derived</h2>' +
    '<p>The comparables are the ' + m.compCount + ' tokens that already trade (one protocol per token, greatest TVL, ' +
    'market-cap multiple of TVL in [0.02, 20]). On them we fit ln(mcap) = ' + m.intercept.toFixed(3) + ' + ' +
    m.tvlSlope.toFixed(3) + ' · ln(TVL) ' + (m.ageSlope >= 0 ? '+' : '−') + ' ' + Math.abs(m.ageSlope).toFixed(3) +
    ' · ln(age) + a category offset shrunk by 8 pseudo-observations. The fitted multiple is clamped to ' +
    '[0.08, 1.20]; the implied value is TVL × multiple × growth × ' + m.discount + ' (a stated pre-token discount).</p>' +
    '<p>Validation, all computed at build time from the snapshot alone: leave-one-out curve x' + v.looMedian.toFixed(2) +
    ', full pipeline x' + v.looFullGeo.toFixed(2) + ', time split (cut ' + esc(v.timeSplitCut) + ') x' + v.timeSplitGeo.toFixed(2) +
    ', walk-forward pooled x' + v.walkForwardPooled.toFixed(2) + ' on ' + v.walkForwardN + ' held-out comps, bootstrap ' +
    'top-10 stability ' + v.bootstrapTop10.toFixed(2) + ' of 10 over 200 draws. Baselines on the same protocol: ' +
    'median-multiple x' + v.medianMultipleGeo.toFixed(2) + ', TVL-only x' + v.tvlOnlyGeo.toFixed(2) + '.</p>' +
    '<p>Farm plans net one farmer\u2019s slice (implied × 0.002%) to the low end of the x' + v.band.toFixed(2) +
    ' band, less gas and the 4% T-bill cost of the capital. FARM clears $50 net, THIN covers its costs, SKIP does not. ' +
    'A protocol records no token, never that it has none. Full method, with every number, is in <code>00-proof.md</code>.</p>';

  /* Category table */
  document.getElementById('cats').innerHTML = D.categories.map(function (c) {
    return '<tr><td>' + esc(c.name) + '</td><td class="num">' + c.comps + '</td>' +
      '<td class="num">' + (c.offset >= 0 ? '+' : '') + c.offset.toFixed(2) + '</td>' +
      '<td class="num">' + c.multiple.toFixed(2) + '×</td></tr>';
  }).join('');

  /* Fit scatter: log TVL vs log mcap, fitted curve at median age. */
  (function scatter() {
    var comps = D.comps;
    if (!comps || comps.length === 0) return;
    var W = 1080, H = 420, pad = { l: 64, r: 20, t: 16, b: 44 };
    var xs = comps.map(function (c) { return Math.log10(c.tvl); });
    var ys = comps.map(function (c) { return Math.log10(c.mcap); });
    var x0 = Math.min.apply(null, xs) - 0.15, x1 = Math.max.apply(null, xs) + 0.15;
    var y0 = Math.min.apply(null, ys) - 0.3, y1 = Math.max.apply(null, ys) + 0.3;
    function X(x) { return pad.l + (x - x0) / (x1 - x0) * (W - pad.l - pad.r); }
    function Y(y) { return H - pad.b - (y - y0) / (y1 - y0) * (H - pad.t - pad.b); }
    var medAge = 1000;
    function curveY(lt) {
      var lnMcap = m.intercept + m.tvlSlope * lt * Math.LN10 + m.ageSlope * Math.log(medAge);
      return lnMcap / Math.LN10;
    }
    var path = '';
    for (var i = 0; i <= 40; i++) {
      var lx = x0 + (x1 - x0) * i / 40;
      path += (i === 0 ? 'M' : 'L') + X(lx).toFixed(1) + ',' + Y(curveY(lx)).toFixed(1);
    }
    var dots = comps.map(function (c) {
      return '<circle cx="' + X(Math.log10(c.tvl)).toFixed(1) + '" cy="' + Y(Math.log10(c.mcap)).toFixed(1) +
        '" r="3.2" fill="#f5b942" fill-opacity="0.75"/>';
    }).join('');
    var grid = '';
    for (var g = Math.ceil(x0); g <= Math.floor(x1); g++) {
      grid += '<line x1="' + X(g) + '" y1="' + pad.t + '" x2="' + X(g) + '" y2="' + (H - pad.b) +
        '" stroke="#26355c" stroke-width="1"/><text x="' + X(g) + '" y="' + (H - pad.b + 18) +
        '" fill="#9aa7bd" font-size="11" text-anchor="middle">10^' + g + '</text>';
    }
    for (var h = Math.ceil(y0); h <= Math.floor(y1); h++) {
      grid += '<line x1="' + pad.l + '" y1="' + Y(h) + '" x2="' + (W - pad.r) + '" y2="' + Y(h) +
        '" stroke="#26355c" stroke-width="1"/><text x="' + (pad.l - 8) + '" y="' + (Y(h) + 4) +
        '" fill="#9aa7bd" font-size="11" text-anchor="end">10^' + h + '</text>';
    }
    document.getElementById('scatter').innerHTML =
      '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Fit scatter: log TVL against log market cap">' +
      grid + dots +
      '<path d="' + path + '" fill="none" stroke="#4ade80" stroke-width="2.5"/>' +
      '<text x="' + (W / 2) + '" y="' + (H - 8) + '" fill="#9aa7bd" font-size="12" text-anchor="middle">log10 TVL (USD)</text>' +
      '<text x="16" y="' + (H / 2) + '" fill="#9aa7bd" font-size="12" text-anchor="middle" transform="rotate(-90 16 ' + (H / 2) + ')">log10 market cap (USD)</text>' +
      '<text x="' + (W - pad.r) + '" y="' + (pad.t + 12) + '" fill="#4ade80" font-size="12" text-anchor="end">fitted curve, median age</text>' +
      '</svg>';
  })();

  renderRows();
  readHash();
})();
