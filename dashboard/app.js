/* Token Radar v2 — board rendering, filters, detail view, farm-step generator.
   The step generator below mirrors lib/model.ts exactly: the page shows the
   same six steps board.json carries for each row. Pure functions first (they
   run in node too, for the gate check); DOM wiring is guarded at the bottom. */

var VERDICTS = ['FARM', 'THIN', 'SKIP'];

var NATIVE = {
  Ethereum: 'ETH', Solana: 'SOL', Binance: 'BNB', Avalanche: 'AVAX',
  Polygon: 'MATIC', Sui: 'SUI', Tron: 'TRX', Bitcoin: 'BTC',
  Arbitrum: 'ETH', Base: 'ETH', Optimism: 'ETH', Linea: 'ETH',
  Sonic: 'S', Fantom: 'FTM', Mantle: 'MNT',
};

function gasUsd(chain) {
  if (chain === 'Ethereum') return 12;
  if (chain === 'Solana') return 0.05;
  if (chain === 'Bitcoin') return 2;
  if (chain === 'Tron') return 1;
  if (['Arbitrum', 'Base', 'Optimism', 'Linea', 'Polygon', 'Sonic', 'Mantle'].indexOf(chain) >= 0) return 0.5;
  return 1;
}

function positionUsd(tvl) {
  if (tvl >= 1000000000) return 10000;
  if (tvl >= 500000000) return 5000;
  if (tvl >= 200000000) return 2000;
  if (tvl >= 100000000) return 1000;
  return 500;
}

function money(n) {
  if (n >= 1000) return '$' + (n / 1000).toFixed(n % 1000 === 0 ? 0 : 1) + 'k';
  if (n >= 1) return '$' + Math.round(n);
  return '$' + n.toFixed(2);
}

function fmtUsd(n) {
  if (n >= 1000000000) return '$' + (n / 1000000000).toFixed(2) + 'B';
  if (n >= 1000000) return '$' + (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return '$' + (n / 1000).toFixed(1) + 'k';
  return '$' + Math.round(n);
}

function fmtAge(days) {
  if (days == null) return '—';
  if (days >= 365) return (days / 365).toFixed(1) + 'y';
  return days + 'd';
}

function fmtPct(x) {
  if (x == null) return '—';
  return (x >= 0 ? '+' : '') + x.toFixed(1) + '%';
}

/* The core action and its weekly repeat, by category. Mirrors lib/model.ts. */
function categoryPlay(category, name, pos, chain) {
  switch (category) {
    case 'Lending':
      return [
        'Supply ' + pos + ' of USDC on ' + name + ' and borrow 40% of it back in a stablecoin, so the supply leg earns yield while the borrow leg counts as real usage.',
        'Top the supply up by 10% each week and keep the health factor above 1.5, so the position stays open and active for the full 8 weeks.',
      ];
    case 'Dexs':
      return [
        'Add ' + pos + ' of liquidity to the main ' + name + ' pool on ' + chain + ' and swap $100 through the pool, so you are both a maker and a taker.',
        'Swap $100 through ' + name + ' every week and add the fees you earn back into the pool, keeping the position live.',
      ];
    case 'Yield':
    case 'Yield Aggregator':
      return [
        'Deposit ' + pos + ' into the ' + name + ' vault on ' + chain + ' and let it auto-compound; the vault receipt is the proof of your deposit.',
        'Compound the vault yield back in every week and add $100 of fresh capital, so the balance grows steadily.',
      ];
    case 'RWA':
      return [
        'Buy ' + pos + ' of tokenized exposure through ' + name + ' on ' + chain + ' and hold it in the same wallet for the whole plan.',
        'Add $100 of exposure every week, so the holding grows and the wallet shows a steady accumulation pattern.',
      ];
    case 'Liquid Staking':
    case 'Staking Pool':
      return [
        'Stake ' + pos + ' of ' + (NATIVE[chain] || 'the chain token') + ' on ' + name + ' and keep the receipt token, then use that receipt as collateral somewhere once.',
        'Stake another $100 every week and never unstake early, so the stake ages without interruption.',
      ];
    case 'Liquid Restaking':
    case 'Restaking':
      return [
        'Restake ' + pos + ' of ' + (NATIVE[chain] || 'the chain token') + ' through ' + name + ' and hold the restaking receipt for the full plan.',
        'Restake $100 more each week, so the restaked balance climbs and the wallet shows continued commitment.',
      ];
    case 'Bridge':
    case 'Canonical Bridge':
    case 'Cross Chain Bridge':
      return [
        'Bridge ' + pos + ' to ' + chain + ' through ' + name + ' and back once, paying the bridge fee, so the wallet records a real crossing.',
        'Bridge $100 every week on a different route, so the history shows repeated, varied use rather than one transfer.',
      ];
    case 'Basis Trading':
      return [
        'Open a ' + pos + ' delta-neutral position on ' + name + ', long spot and short perps in equal size, and hold it for the plan.',
        'Rebalance the hedge weekly so it stays neutral, and log the funding you collect as the position\'s yield.',
      ];
    case 'CDP':
    case 'CDP Manager':
      return [
        'Lock ' + pos + ' of collateral in ' + name + '\'s vault on ' + chain + ' and mint stablecoins against at most half of it.',
        'Adjust the collateral ratio weekly to stay above the liquidation line, and repay a little of the debt each time.',
      ];
    case 'Derivatives':
      return [
        'Open a ' + pos + ' hedged position on ' + name + ' on ' + chain + ', with a stop set so a bad week costs at most 5% of the position.',
        'Roll the position weekly and keep the hedge on, so the account stays active without taking directional risk.',
      ];
    case 'Risk Curators':
    case 'Onchain Capital Allocator':
      return [
        'Deposit ' + pos + ' into a ' + name + ' curated vault on ' + chain + ' and leave it allocated for the whole plan.',
        'Add $100 to the vault every week and review the curator\'s allocation note, so the deposit keeps growing.',
      ];
    case 'Chain':
      return [
        'Bridge ' + pos + ' onto ' + name + ' and use it daily: swap once, hold the native token for gas, and keep a balance on the chain.',
        'Transact on ' + name + ' at least three times a week, so the wallet shows sustained activity on the chain itself.',
      ];
    case 'Indexes':
      return [
        'Buy ' + pos + ' of the ' + name + ' index on ' + chain + ' and hold it; the index receipt is the position.',
        'Add $100 to the index every week, so the holding compounds and the wallet ages with it.',
      ];
    case 'Farm':
      return [
        'Stake LP tokens worth ' + pos + ' on ' + name + '\'s farm on ' + chain + ' and start earning the farm rewards.',
        'Harvest the rewards weekly and restake them, so the farmed balance grows instead of sitting idle.',
      ];
    case 'Launchpad':
      return [
        'Stake ' + pos + ' on ' + name + ' to qualify for its launches, and join the next sale the stake unlocks.',
        'Keep the stake locked and join every sale that opens during the 8 weeks, so the account shows launch activity.',
      ];
    case 'Payments':
      return [
        'Route ' + pos + ' of real payments through ' + name + ' on ' + chain + ', splitting it across at least three separate transfers.',
        'Send one payment a week through ' + name + ', so the account shows regular payment volume.',
      ];
    case 'Insurance':
      return [
        'Buy ' + pos + ' of cover on ' + name + ' for a position you already hold, and keep the policy active for the plan.',
        'Review the cover weekly and top it up when the underlying position grows, so the policy never lapses.',
      ];
    case 'Prediction Market':
      return [
        'Place ' + pos + ' of prediction trades on ' + name + ' across at least three markets, sized so no single market risks more than a third.',
        'Trade one market a week and settle promptly, so the account shows steady prediction volume.',
      ];
    default:
      return [
        'Use ' + name + '\'s main ' + (category || 'protocol') + ' product on ' + chain + ' with ' + pos + ', and keep the position open for the whole plan.',
        'Repeat the core use weekly for 8 weeks, adding $100 each time, so the wallet shows sustained, growing usage.',
      ];
  }
}

/* Six concrete farm steps for a row object {name, category, chain, tvl, implied, band}.
   Mirrors lib/model.ts farmSteps exactly. */
function stepsFor(row) {
  var chain = row.chain || 'Ethereum';
  var native = NATIVE[chain] || 'the chain token';
  var pos = positionUsd(row.tvl);
  var gas = gasUsd(chain);
  var posStr = money(pos);
  var gasStr = money(gas);
  var bridgeFee = money(Math.max(5, gas * 2));
  var play = categoryPlay(row.category, row.name, posStr, chain);
  var low = row.low;
  var steps = [
    'Open a fresh wallet on ' + chain + ' and fund it with ' + posStr + ' in USDC plus ' + gasStr + ' of ' + native + ' for gas; the whole 8-week plan costs about ' + money(gas * 12) + ' in fees.',
    'Move ' + posStr + ' of USDC to ' + chain + ' (bridge fee about ' + bridgeFee + ', 10-20 minutes) and keep a ' + gasStr + ' gas reserve untouched.',
    play[0],
    play[1],
    'Check ' + row.name + '\'s announcements and points page every week; snapshots are unannounced, so leave the position open and do not withdraw early.',
    'When the token launches, unwind in 3 tranches over 2 weeks and claim within the 90-day window; the low end of the value band is about $' + low.toLocaleString('en-US') + ', so size the exit on that, not the headline.',
  ];
  return steps.map(function (s) { return s.length > 600 ? s.slice(0, 597) + '...' : s; });
}

/* A data.js array row -> a named row object. Columns:
   [slug, name, implied, verdict(0/1/2), category, tvl, change7d, ageDays, multiple, growth, onWatchlist, chain, bandLow] */
function rowFromArray(a, band) {
  return {
    slug: a[0], name: a[1], implied: a[2], verdict: VERDICTS[a[3]],
    category: a[4], tvl: a[5], change7d: a[6], age: a[7],
    multiple: a[8], growth: a[9], watch: a[10] === 1, chain: a[11], band: band,
    low: a[12],
  };
}

/* ---------------------------------------------------------------- DOM wiring */
if (typeof document !== 'undefined') {
  (function () {
    var BOARD = (window.BOARD || []).map(function (a) { return rowFromArray(a, window.META.band); });
    var META = window.META || {};
    var LIVE = window.LIVE || [];

    document.getElementById('asof').textContent = META.as_of || '—';
    document.getElementById('loo').textContent = 'x' + (META.loo_median || '—') + ' median';
    document.getElementById('method-text').textContent =
      'ln(mcap) = ' + (META.beta ? META.beta[0] + ' + ' + META.beta[1] + '·ln(TVL) − ' + Math.abs(META.beta[2]) + '·ln(age)' : '—') +
      ', fitted on ' + (META.n_comps || '—') +
      ' live tokens, with a category offset shrunk by 8. A protocol\'s implied value is its TVL times its fitted ' +
      'multiple (clamped 0.08–1.20) times its growth (1 + its 7-day TVL change, clamped −60%…+120%, times 0.3). ' +
      'Checked three ways: leave-one-out median error x' + (META.loo_median || '—') + ', time split x' +
      (META.ts_median || '—') + ', walk-forward x' + (META.wf_median || '—') +
      ' — against a median-multiple baseline of x' + (META.base_median_multiple || '—') +
      ' and a TVL-only baseline of x' + (META.base_tvl_only || '—') +
      '. The farm band is x' + (META.band || '—') + ' (one sigma of the leave-one-out errors).';
    document.getElementById('total').textContent = BOARD.length;
    document.getElementById('counts').textContent =
      (META.counts ? META.counts.FARM + ' FARM · ' + META.counts.THIN + ' THIN · ' + META.counts.SKIP + ' SKIP' : '');

    var catSel = document.getElementById('cat');
    var cats = [];
    BOARD.forEach(function (r) { if (r.category && cats.indexOf(r.category) < 0) cats.push(r.category); });
    cats.sort().forEach(function (c) {
      var o = document.createElement('option');
      o.value = c; o.textContent = c;
      catSel.appendChild(o);
    });

    var liveList = document.getElementById('live-list');
    LIVE.forEach(function (l) {
      var li = document.createElement('li');
      var b = document.createElement('b'); b.textContent = l[0];
      var s = document.createElement('span'); s.textContent = l[1] + ' · token trades';
      li.appendChild(b); li.appendChild(s);
      liveList.appendChild(li);
    });

    var state = { q: '', cat: '', v: '', sort: 'implied', sel: null };

    function filtered() {
      var rows = BOARD.filter(function (r) {
        if (state.v !== '' && VERDICTS.indexOf(r.verdict) !== Number(state.v)) return false;
        if (state.cat && r.category !== state.cat) return false;
        if (state.q) {
          var q = state.q.toLowerCase();
          if (r.name.toLowerCase().indexOf(q) < 0 && r.slug.toLowerCase().indexOf(q) < 0) return false;
        }
        return true;
      });
      var key = state.sort;
      rows.sort(function (a, b) {
        if (key === 'tvl') return b.tvl - a.tvl;
        if (key === 'growth') return (b.change7d || 0) - (a.change7d || 0);
        if (key === 'age') return (b.age || 0) - (a.age || 0);
        return b.implied - a.implied;
      });
      return rows;
    }

    function render() {
      var rows = filtered();
      var tb = document.getElementById('rows');
      tb.innerHTML = '';
      rows.forEach(function (r, i) {
        var tr = document.createElement('tr');
        if (state.sel === r.slug) tr.className = 'sel';
        var cells = [
          ['rank', String(i + 1)],
          ['name', ''],
          ['cat', r.category || '—'],
          ['chain', r.chain],
          ['num', fmtUsd(r.tvl)],
          ['num', fmtPct(r.change7d)],
          ['num', fmtAge(r.age)],
          ['num', fmtUsd(r.implied)],
          ['v', ''],
        ];
        cells.forEach(function (c, j) {
          var td = document.createElement('td');
          td.className = c[0] === 'num' ? 'num' : c[0];
          if (j === 0) td.className = 'rank';
          if (j === 1) {
            td.className = 'name';
            td.textContent = r.name;
            if (r.watch) {
              var w = document.createElement('span');
              w.className = 'watch'; w.textContent = 'WATCHLIST';
              td.appendChild(w);
            }
          } else if (j === 8) {
            var badge = document.createElement('span');
            badge.className = 'badge v' + VERDICTS.indexOf(r.verdict);
            badge.textContent = r.verdict;
            td.appendChild(badge);
          } else {
            td.textContent = c[1];
          }
          tr.appendChild(td);
        });
        tr.addEventListener('click', function () { showDetail(r.slug); });
        tb.appendChild(tr);
      });
      document.getElementById('shown').textContent = rows.length;
    }

    function showDetail(slug) {
      var r = null;
      BOARD.forEach(function (x) { if (x.slug === slug) r = x; });
      if (!r) return;
      state.sel = slug;
      var d = document.getElementById('detail');
      d.hidden = false;
      document.getElementById('d-name').textContent = r.name;
      var badge = document.getElementById('d-verdict');
      badge.className = 'badge v' + VERDICTS.indexOf(r.verdict);
      badge.textContent = r.verdict;
      document.getElementById('d-line').textContent =
        (r.category || 'Protocol') + ' · ' + r.chain + ' · TVL ' + fmtUsd(r.tvl) +
        ' · 7d ' + fmtPct(r.change7d) + ' · age ' + fmtAge(r.age) +
        (r.watch ? ' · on the watchlist' : '') + ' · records no token';
      var nums = document.getElementById('d-nums');
      nums.innerHTML = '';
      [
        ['Implied value', fmtUsd(r.implied)],
        ['TVL × multiple', fmtUsd(r.tvl) + ' × ' + r.multiple.toFixed(2)],
        ['Growth factor', '×' + r.growth.toFixed(2)],
        ['Value band (x' + META.band + ')', fmtUsd(r.implied / META.band) + ' – ' + fmtUsd(r.implied * META.band)],
      ].forEach(function (kv) {
        var div = document.createElement('div');
        var k = document.createElement('div'); k.className = 'k'; k.textContent = kv[0];
        var v = document.createElement('div'); v.className = 'v'; v.textContent = kv[1];
        div.appendChild(k); div.appendChild(v);
        nums.appendChild(div);
      });
      var ol = document.getElementById('d-steps');
      ol.innerHTML = '';
      stepsFor(r).forEach(function (s) {
        var li = document.createElement('li');
        li.textContent = s;
        ol.appendChild(li);
      });
      document.getElementById('d-note').textContent =
        'The farm plan nets to the low end of the value band: size the position on ' +
        fmtUsd(r.implied / META.band) + ', not on the headline ' + fmtUsd(r.implied) + '.';
      render();
      d.scrollIntoView({ block: 'nearest' });
    }

    document.getElementById('q').addEventListener('input', function (e) { state.q = e.target.value; render(); });
    catSel.addEventListener('change', function (e) { state.cat = e.target.value; render(); });
    document.getElementById('sort').addEventListener('change', function (e) { state.sort = e.target.value; render(); });
    var vbtns = document.querySelectorAll('.verdicts button');
    vbtns.forEach(function (b) {
      b.addEventListener('click', function () {
        vbtns.forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        state.v = b.getAttribute('data-v');
        render();
      });
    });
    document.getElementById('d-close').addEventListener('click', function () {
      document.getElementById('detail').hidden = true;
      state.sel = null;
      render();
    });

    // Deep links for screenshots: #detail=<slug>, #verdict=FARM|THIN|SKIP, #category=<name>
    var hash = (location.hash || '').slice(1);
    var params = {};
    hash.split('&').forEach(function (kv) {
      var p = kv.split('=');
      if (p[0]) params[decodeURIComponent(p[0])] = decodeURIComponent(p[1] || '');
    });
    if (params.verdict && VERDICTS.indexOf(params.verdict) >= 0) {
      state.v = String(VERDICTS.indexOf(params.verdict));
      vbtns.forEach(function (x) { x.classList.toggle('on', x.getAttribute('data-v') === state.v); });
    }
    if (params.category) { state.cat = params.category; catSel.value = params.category; }
    render();
    if (params.detail) {
      document.body.classList.add('detail-mode');
      showDetail(params.detail);
    }
  })();
}
