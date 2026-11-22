(function () {
  "use strict";

  const DATA = window.GOSIL_SHOWCASE_DATA;
  if (!DATA) return;

  const TROY_GRAMS = 31.1034768;

  const STATE = {
    tab: "overview",
    tierMetal: "gold",
    decompPreset: "gold_combined",
    p0: "2400.00",
    p1: "2640.00",
    e0: "32.0000",
    e1: "35.2000",
    voidApplied: true,
    spreadMetal: "gold",
    bidStr: "2940.00",
    askStr: "3045.00",
    quoteAgeSec: 420,
    forecastSeriesIdx: 0,
    forecastHorizon: "6",
  };

  function esc(val) {
    if (val === null || val === undefined) return "";
    return String(val)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function fmtUgToGrams(ug) {
    const sign = ug < 0 ? "-" : "";
    const abs = Math.abs(Math.trunc(ug));
    const whole = Math.floor(abs / 1_000_000);
    const frac = String(abs % 1_000_000).padStart(6, "0");
    return sign + whole.toLocaleString("en-US") + "." + frac + " g";
  }

  function fmtE4ToTry(e4) {
    const sign = e4 < 0 ? "-" : "";
    const abs = Math.abs(Math.trunc(e4));
    const whole = Math.floor(abs / 10_000);
    const frac = String(abs % 10_000).padStart(4, "0");
    return sign + whole.toLocaleString("en-US") + "." + frac + " TRY";
  }

  function parseScaledInt(str, decimals) {
    const clean = String(str || "").trim();
    if (!/^(?:0|[1-9]\d*)(?:\.\d+)?$/.test(clean)) return null;
    const parts = clean.split(".");
    const whole = parts[0];
    const frac = (parts[1] || "").slice(0, decimals).padEnd(decimals, "0");
    try {
      return BigInt(whole + frac);
    } catch (_e) {
      return null;
    }
  }

  function formatBigScaled(bi, scaleDecimals, outDecimals) {
    const neg = bi < 0n;
    const abs = neg ? -bi : bi;
    const shift = scaleDecimals - outDecimals;
    let rounded = abs;
    if (shift > 0) {
      const div = 10n ** BigInt(shift);
      const q = abs / div;
      const r = abs % div;
      const half = div / 2n;
      rounded = r > half || (r === half && q % 2n === 1n) ? q + 1n : q;
    } else if (shift < 0) {
      rounded = abs * 10n ** BigInt(-shift);
    }
    const base = 10n ** BigInt(outDecimals);
    const w = rounded / base;
    const f = String(rounded % base).padStart(outDecimals, "0");
    return (neg ? "-" : "") + w.toString() + "." + f;
  }

  // Exact integer/BigInt currency decomposition using exact TROY_GRAMS = 311034768 / 10_000_000
  function computeExactDecomposition(p0Str, p1Str, e0Str, e1Str) {
    const p0 = parseScaledInt(p0Str, 4);
    const p1 = parseScaledInt(p1Str, 4);
    const e0 = parseScaledInt(e0Str, 4);
    const e1 = parseScaledInt(e1Str, 4);
    if (p0 === null || p1 === null || e0 === null || e1 === null || p0 <= 0n || p1 <= 0n || e0 <= 0n || e1 <= 0n) {
      return { valid: false, error: "Enter positive decimal values for P0, P1, E0, and E1." };
    }
    // Scale numerator by 10^7 (for TROY_GRAMS denominator) * 10^6 extra precision -> total scale 10^14
    const TROY_NUM = 311034768n;
    const MULT = 10n ** 13n; // (p * e) has scale 10^8; * 10^7 for TROY_GRAMS * 10^6 precision => / 311034768 gives scale 10^14
    const toTryG = (num1) => (num1 * MULT) / TROY_NUM; // scale 10^14

    const g0 = toTryG(p0 * e0);
    const g1 = toTryG(p1 * e1);
    const dp = p1 - p0;
    const de = e1 - e0;
    const usdC = toTryG(dp * e0);
    const fxC = toTryG(p0 * de);
    const interC = toTryG(dp * de);
    const totalDelta = g1 - g0;

    // Exact percent returns (scale 10^6 -> 2 decimals)
    const pctScale = 10n ** 8n;
    const rUsd = (dp * pctScale) / p0;
    const rFx = (de * pctScale) / e0;
    const rTot = ((g1 - g0) * pctScale) / g0;

    return {
      valid: true,
      g0Str: formatBigScaled(g0, 14, 4),
      g1Str: formatBigScaled(g1, 14, 4),
      totalStr: formatBigScaled(totalDelta, 14, 4),
      usdStr: formatBigScaled(usdC, 14, 4),
      fxStr: formatBigScaled(fxC, 14, 4),
      interStr: formatBigScaled(interC, 14, 4),
      rUsdStr: formatBigScaled(rUsd, 6, 2),
      rFxStr: formatBigScaled(rFx, 6, 2),
      rTotStr: formatBigScaled(rTot, 6, 2),
      g0Num: Number(formatBigScaled(g0, 14, 4)),
      g1Num: Number(formatBigScaled(g1, 14, 4)),
      usdNum: Number(formatBigScaled(usdC, 14, 4)),
      fxNum: Number(formatBigScaled(fxC, 14, 4)),
      interNum: Number(formatBigScaled(interC, 14, 4)),
      totalNum: Number(formatBigScaled(totalDelta, 14, 4)),
    };
  }

  // Exact ledger computation using integer ug and e4 TRY
  function computeLedgerSummary(voidApplied) {
    const entries = DATA.synthetic_ledger.financial_entries;
    const byInst = {
      gold: { balance_ug: 0, total_cost_e4: 0, fees_tax_e4: 0, active_count: 0, voided_count: 0 },
      silver: { balance_ug: 0, total_cost_e4: 0, fees_tax_e4: 0, active_count: 0, voided_count: 0 },
    };
    entries.forEach((tx) => {
      const bucket = byInst[tx.instrument];
      const isVoided = voidApplied && tx.voidable_demo;
      if (isVoided) {
        bucket.voided_count += 1;
        return;
      }
      bucket.active_count += 1;
      if (tx.side === "buy") {
        bucket.balance_ug += tx.quantity_ug;
        bucket.total_cost_e4 += tx.total_cost_e4;
        bucket.fees_tax_e4 += tx.fee_e4 + tx.tax_e4;
      } else if (tx.side === "sell" && bucket.balance_ug > 0) {
        // Proportional integer weighted-average cost reduction (exact integer floor)
        const removedCost = Math.floor((bucket.total_cost_e4 * tx.quantity_ug) / bucket.balance_ug);
        bucket.total_cost_e4 -= removedCost;
        bucket.balance_ug -= tx.quantity_ug;
      }
    });
    Object.values(byInst).forEach((b) => {
      b.avg_cost_e4_per_g = b.balance_ug > 0 ? Math.round((b.total_cost_e4 * 1_000_000) / b.balance_ug) : 0;
    });
    return byInst;
  }

  // Exact GoSil spread formulas from spread.py
  function computeSpreadMetrics(bidStr, askStr) {
    const bid = parseScaledInt(bidStr, 4);
    const ask = parseScaledInt(askStr, 4);
    if (bid === null || ask === null || bid <= 0n || ask <= 0n) {
      return { valid: false, code: "INVALID_INPUT", error: "Bid and Ask must be positive decimal numbers." };
    }
    if (ask < bid) {
      return { valid: false, code: "MALFORMED_PRICES", error: "Ask price (" + askStr + ") is below Bid price (" + bidStr + ") — rejected fail-closed (MALFORMED_PRICES)." };
    }
    const diff = ask - bid;
    // mid_relative_spread = 2 * (ask - bid) / (ask + bid)
    const midSpreadPct = (2n * diff * 10n ** 8n) / (ask + bid);
    // immediate_spread_drag = (ask - bid) / ask
    const dragPct = (diff * 10n ** 8n) / ask;
    return {
      valid: true,
      bidE4: bid,
      askE4: ask,
      diffStr: formatBigScaled(diff, 4, 4),
      midSpreadStr: formatBigScaled(midSpreadPct, 6, 2) + "%",
      dragStr: formatBigScaled(dragPct, 6, 2) + "%",
    };
  }

  // ---------- Tab Navigation ----------
  function switchTab(tabName) {
    STATE.tab = tabName;
    const tabs = Array.from(document.querySelectorAll("#gosil-tablist .rail-btn"));
    tabs.forEach((btn) => {
      const active = btn.dataset.tab === tabName;
      btn.setAttribute("aria-selected", active ? "true" : "false");
      btn.tabIndex = active ? 0 : -1;
    });
    document.querySelectorAll(".view-panel").forEach((p) => {
      p.hidden = p.id !== "panel-" + tabName;
    });
    renderActiveTab();
  }

  function setupTabs() {
    const tabs = Array.from(document.querySelectorAll("#gosil-tablist .rail-btn"));
    tabs.forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
      btn.addEventListener("keydown", (ev) => {
        const idx = tabs.indexOf(btn);
        let next = null;
        if (ev.key === "ArrowDown" || ev.key === "ArrowRight") next = tabs[(idx + 1) % tabs.length];
        else if (ev.key === "ArrowUp" || ev.key === "ArrowLeft") next = tabs[(idx - 1 + tabs.length) % tabs.length];
        else if (ev.key === "Home") next = tabs[0];
        else if (ev.key === "End") next = tabs[tabs.length - 1];
        if (next) {
          ev.preventDefault();
          next.focus();
          switchTab(next.dataset.tab);
        }
      });
    });
  }

  // ---------- Original SVG Visuals ----------
  function renderTierBridgeSvg(metalKey) {
    const isGold = metalKey === "gold";
    const accent = isGold ? "#d8b25c" : "#b8c4d4";
    const bars = isGold
      ? [
          { lbl: "Tier 3: Parity", val: 2939.38, col: "#7c8ea6" },
          { lbl: "Tier 4: Retail", val: 2995.00, col: "#b8c4d4" },
          { lbl: "Tier 5: Bank Bid", val: 2910.00, col: "#e06363" },
          { lbl: "Tier 5: Bank Ask", val: 3025.00, col: accent },
          { lbl: "Tier 6: Net Exec", val: 3031.05, col: "#4dc28a" },
        ]
      : [
          { lbl: "Tier 3: Parity", val: 34.61, col: "#7c8ea6" },
          { lbl: "Tier 4: Retail", val: 36.10, col: "#b8c4d4" },
          { lbl: "Tier 5: Bank Bid", val: 33.90, col: "#e06363" },
          { lbl: "Tier 5: Bank Ask", val: 36.80, col: accent },
          { lbl: "Tier 6: Net Exec", val: 36.87, col: "#4dc28a" },
        ];
    const W = 740, H = 220, padL = 62, padR = 24, padT = 26, padB = 38;
    const minV = isGold ? 2850 : 32.5;
    const maxV = isGold ? 3060 : 37.6;
    const range = maxV - minV;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const yOf = (v) => padT + ((maxV - v) / range) * plotH;
    const slotW = plotW / bars.length;

    let grid = "";
    for (let i = 0; i <= 4; i++) {
      const gv = minV + (range * i) / 4;
      const y = yOf(gv);
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#242430" stroke-width="1" />';
      grid += '<text x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" fill="#8a8fa0" font-size="10.5" text-anchor="end" font-family="monospace">' + gv.toFixed(isGold ? 0 : 1) + "</text>";
    }

    let rects = "";
    bars.forEach((b, i) => {
      const cx = padL + i * slotW + slotW / 2;
      const y = yOf(b.val);
      const h = Math.max(4, H - padB - y);
      rects += '<rect x="' + (cx - 32).toFixed(1) + '" y="' + y.toFixed(1) + '" width="64" height="' + h.toFixed(1) + '" rx="4" fill="' + b.col + '" fill-opacity="0.82"><title>SYNTHETIC ' + esc(b.lbl + ": " + b.val + " TRY/g") + "</title></rect>";
      rects += '<text x="' + cx.toFixed(1) + '" y="' + (y - 6).toFixed(1) + '" fill="#eeeff2" font-size="11" text-anchor="middle" font-family="monospace">' + b.val.toFixed(2) + "</text>";
      rects += '<text x="' + cx.toFixed(1) + '" y="' + (H - 12) + '" fill="#9b9fae" font-size="10.5" text-anchor="middle">' + esc(b.lbl) + "</text>";
    });

    return (
      '<div class="chart-box">' +
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Synthetic ' + esc(metalKey) + ' TRY per gram price tier comparison">' +
      grid + rects +
      "</svg>" +
      '<div class="chart-legend"><span class="muted">SYNTHETIC ILLUSTRATION (TRY/g) — Theoretical parity (Tier 3) never equals executable bank bid (Tier 5) or net cost (Tier 6).</span></div></div>'
    );
  }

  function renderDecompositionWaterfallSvg(res) {
    const items = [
      { lbl: "USD Metal", val: res.usdNum, col: "#d8b25c" },
      { lbl: "USD/TRY FX", val: res.fxNum, col: "#b8c4d4" },
      { lbl: "Cross-Inter.", val: res.interNum, col: "#7d93c4" },
      { lbl: "Total Δ TRY/g", val: res.totalNum, col: res.totalNum >= 0 ? "#4dc28a" : "#e06363" },
    ];
    const W = 680, H = 225, padL = 64, padR = 24, padT = 26, padB = 38;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const maxV = Math.max(1, ...items.map((x) => x.val), 0);
    const minV = Math.min(-1, ...items.map((x) => x.val), 0);
    const range = maxV - minV || 1;
    const yOf = (v) => padT + ((maxV - v) / range) * plotH;
    const zeroY = yOf(0);
    const slotW = plotW / items.length;

    let grid = '<line x1="' + padL + '" y1="' + zeroY.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + zeroY.toFixed(1) + '" stroke="#4b4b60" stroke-width="1.3" />';
    for (let i = 0; i <= 4; i++) {
      const gv = minV + (range * i) / 4;
      const y = yOf(gv);
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#22222d" stroke-width="1" />';
      grid += '<text x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" fill="#8a8fa0" font-size="10.5" text-anchor="end" font-family="monospace">' + gv.toFixed(1) + "</text>";
    }

    let bars = "";
    items.forEach((it, idx) => {
      const cx = padL + idx * slotW + slotW / 2;
      const y = it.val >= 0 ? yOf(it.val) : zeroY;
      const h = Math.max(2.5, Math.abs(yOf(it.val) - zeroY));
      const sign = it.val > 0 ? "+" : "";
      bars += '<rect x="' + (cx - 34).toFixed(1) + '" y="' + y.toFixed(1) + '" width="68" height="' + h.toFixed(1) + '" rx="4" fill="' + it.col + '" fill-opacity="0.85"><title>SYNTHETIC ' + esc(it.lbl + ": " + sign + it.val.toFixed(4) + " TRY/g") + "</title></rect>";
      const lblY = it.val >= 0 ? y - 6 : y + h + 13;
      bars += '<text x="' + cx.toFixed(1) + '" y="' + lblY.toFixed(1) + '" fill="#eeeff2" font-size="11" text-anchor="middle" font-family="monospace">' + sign + it.val.toFixed(2) + "</text>";
      bars += '<text x="' + cx.toFixed(1) + '" y="' + (H - 10) + '" fill="#9b9fae" font-size="11" text-anchor="middle">' + esc(it.lbl) + "</text>";
    });

    return (
      '<div class="chart-box">' +
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Synthetic currency decomposition waterfall chart showing USD metal, FX, and interaction contributions">' +
      grid + bars +
      "</svg>" +
      '<div class="chart-legend"><span class="muted">SYNTHETIC ALGEBRAIC IDENTITY: USD Metal + USD/TRY FX + Cross-Interaction = Exact Total Δ TRY/g (31.1034768 g/oz).</span></div></div>'
    );
  }

  function renderForecastSvg(series, horizonObj) {
    const vals = series.values.map(Number);
    const selKey = horizonObj.selected_model;
    const sel = horizonObj.models[selKey];
    const naive = horizonObj.models.naive;
    const h = horizonObj.horizon_months;
    const W = 740, H = 250, padL = 58, padR = 36, padT = 24, padB = 34;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const allV = vals.concat([Number(sel.band_lower), Number(sel.band_upper), Number(sel.final_point), Number(naive.final_point)]);
    const minV = Math.min(...allV) * 0.98;
    const maxV = Math.max(...allV) * 1.02;
    const range = maxV - minV || 1;
    const totalPts = vals.length + h;
    const xOf = (i) => padL + (i / (totalPts - 1)) * plotW;
    const yOf = (v) => padT + ((maxV - v) / range) * plotH;

    let grid = "";
    for (let i = 0; i <= 4; i++) {
      const gv = minV + (range * i) / 4;
      const y = yOf(gv);
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#22222d" stroke-width="1" />';
      grid += '<text x="' + (padL - 8) + '" y="' + (y + 4).toFixed(1) + '" fill="#8a8fa0" font-size="10.5" text-anchor="end" font-family="monospace">' + gv.toFixed(0) + "</text>";
    }

    const histPath = vals.map((v, i) => (i === 0 ? "M" : "L") + xOf(i).toFixed(1) + "," + yOf(v).toFixed(1)).join(" ");
    const origIdx = vals.length - 1;
    const targIdx = totalPts - 1;
    const origX = xOf(origIdx), origY = yOf(vals[origIdx]);
    const targX = xOf(targIdx);
    const bandPoly =
      origX.toFixed(1) + "," + origY.toFixed(1) + " " +
      targX.toFixed(1) + "," + yOf(Number(sel.band_upper)).toFixed(1) + " " +
      targX.toFixed(1) + "," + yOf(Number(sel.band_lower)).toFixed(1);

    const naiveLine = '<line x1="' + origX.toFixed(1) + '" y1="' + origY.toFixed(1) + '" x2="' + targX.toFixed(1) + '" y2="' + yOf(Number(naive.final_point)).toFixed(1) + '" stroke="#9b9fae" stroke-width="1.8" stroke-dasharray="4 4" />';
    const selLine = '<line x1="' + origX.toFixed(1) + '" y1="' + origY.toFixed(1) + '" x2="' + targX.toFixed(1) + '" y2="' + yOf(Number(sel.final_point)).toFixed(1) + '" stroke="#d8b25c" stroke-width="2.4" />';
    const sepLine = '<line x1="' + origX.toFixed(1) + '" y1="' + padT + '" x2="' + origX.toFixed(1) + '" y2="' + (H - padB) + '" stroke="#3e3e4f" stroke-width="1.2" stroke-dasharray="3 3" />';

    return (
      '<div class="chart-box">' +
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Synthetic 36-month series with ' + h + '-month walk-forward forecast and non-probabilistic sensitivity band">' +
      grid + sepLine +
      '<polygon points="' + bandPoly + '" fill="rgba(216,178,92,0.16)" />' +
      '<path d="' + histPath + '" fill="none" stroke="#b8c4d4" stroke-width="2.1" />' +
      naiveLine + selLine +
      '<circle cx="' + targX.toFixed(1) + '" cy="' + yOf(Number(sel.final_point)).toFixed(1) + '" r="4.2" fill="#d8b25c"><title>SYNTHETIC Selected (' + esc(selKey) + "): " + esc(sel.final_point) + " [Band: " + esc(sel.band_lower) + " .. " + esc(sel.band_upper) + ", probability=null]</title></circle>" +
      '<text x="' + xOf(0).toFixed(1) + '" y="' + (H - 10) + '" fill="#9b9fae" font-size="10.5" font-family="monospace">Y1-M01</text>' +
      '<text x="' + origX.toFixed(1) + '" y="' + (H - 10) + '" fill="#9b9fae" font-size="10.5" text-anchor="middle" font-family="monospace">Origin (Y3-M12)</text>' +
      '<text x="' + targX.toFixed(1) + '" y="' + (H - 10) + '" fill="#d8b25c" font-size="10.5" text-anchor="end" font-family="monospace">+' + h + "m</text>" +
      "</svg>" +
      '<div class="chart-legend">' +
      '<span><i class="dot" style="background:#b8c4d4"></i>Synthetic History (36m)</span>' +
      '<span><i class="dot" style="background:#d8b25c"></i>Selected Model (' + esc(selKey) + ")</span>" +
      '<span><i class="dot" style="background:#9b9fae"></i>Naive Baseline</span>' +
      '<span><i class="dot" style="background:rgba(216,178,92,0.4)"></i>Empirical Error Sensitivity Band (probability = null)</span>' +
      "</div></div>"
    );
  }

  // ---------- Module 1: Overview ----------
  function renderOverview() {
    const m = DATA.meta;
    const el = document.getElementById("panel-overview");
    el.innerHTML =
      '<div class="view-head"><div><h2>GoSil — Precious Metals Accounting &amp; Statistical Research</h2>' +
      "<p>Frozen historical portfolio showcase built around exact fixed-point accounting, 6-tier price separation, currency decomposition, and disciplined statistical evaluation.</p></div></div>" +

      '<div class="notice notice-gold"><strong>FROZEN — 100% SYNTHETIC SHOWCASE:</strong> ' + esc(m.disclaimer) + "</div>" +

      '<div class="kpi-grid">' +
      '<div class="kpi"><div class="kpi-label">Fixed-Point Precision</div><div class="kpi-val">e4 / ug</div><div class="kpi-sub">0.0001 TRY &amp; 0.000001 g exact integers · 0 floats</div></div>' +
      '<div class="kpi"><div class="kpi-label">Troy Ounce Constant</div><div class="kpi-val">31.1034768</div><div class="kpi-sub">Exact grams per troy oz for TRY/g parity</div></div>' +
      '<div class="kpi"><div class="kpi-label">Price Separation</div><div class="kpi-val">6 Tiers</div><div class="kpi-sub">Spot, FX, Parity, Retail, Bank Spread, Realized Cost</div></div>' +
      '<div class="kpi"><div class="kpi-label">Private Test Suite</div><div class="kpi-val">' + esc(m.private_pytest_count) + ' / 739</div><div class="kpi-sub">Plus ' + esc(m.private_ui3_checks) + ' UI3 contract &amp; security checks verified</div></div>' +
      "</div>" +

      '<div class="grid-3">' +
      '<div class="card"><h3 class="gold-txt">6-Tier Market Structure</h3><p class="muted">Demonstrates why international USD/oz spot and theoretical TRY/g parity must never be conflated with local retail premiums, bank spreads, or realized transaction costs.</p><button class="btn btn-sm" data-jump="structure">Inspect 6 Tiers →</button></div>' +
      '<div class="card"><h3 class="silver-txt">Currency Decomposition</h3><p class="muted">Interactive exact-arithmetic calculator splitting TRY/g moves into USD metal price, USD/TRY exchange rate, and cross-interaction using <code>31.1034768 g/oz</code>.</p><button class="btn btn-sm" data-jump="decomp">Open Calculator →</button></div>' +
      '<div class="card"><h3>Append-Only Fixed-Point Ledger</h3><p class="muted">Synthetic gold &amp; silver lots with integer <code>ug</code>/<code>e4</code> accounting, live Alternative-B void toggling, and strict physical-holding isolation.</p><button class="btn btn-sm" data-jump="ledger">Explore Ledger →</button></div>' +
      "</div>" +

      '<div class="grid-2">' +
      '<div class="card"><h3>Spread &amp; 900s Freshness Gate</h3><p class="muted">Interactive generic bank bid/ask spread calculator demonstrating exact <code>mid_relative_spread</code>, <code>immediate_spread_drag</code>, and fail-closed withholding beyond <code>900s</code>.</p><button class="btn btn-sm" data-jump="spread">Test Freshness Gate →</button></div>' +
      '<div class="card"><h3>Statistical Forecast Evaluation</h3><p class="muted">Walk-forward <code>naive</code> vs <code>drift</code> vs <code>damped_trend</code> comparison showing the 5% development-MAE promotion rule, challenger withholding, and non-probabilistic sensitivity bands.</p><button class="btn btn-sm" data-jump="forecast">Inspect Models →</button></div>' +
      "</div>";

    el.querySelectorAll("[data-jump]").forEach((b) => b.addEventListener("click", () => switchTab(b.dataset.jump)));
  }

  // ---------- Module 2: Market Structure (6 Tiers) ----------
  function renderStructure() {
    const el = document.getElementById("panel-structure");
    const bucket = DATA.six_price_tiers[STATE.tierMetal];
    el.innerHTML =
      '<div class="view-head"><div><h2>Gold &amp; Silver Market Structure (6 Separate Price Tiers)</h2>' +
      "<p>GoSil enforces strict semantic boundaries so theoretical parity ratios are never treated as executable bank or dealer quotations.</p></div></div>" +

      '<div class="controls">' +
      '<button class="btn" id="tier-gold" aria-pressed="' + (STATE.tierMetal === "gold" ? "true" : "false") + '">Gold (Au) — Synthetic Example</button>' +
      '<button class="btn" id="tier-silver" aria-pressed="' + (STATE.tierMetal === "silver" ? "true" : "false") + '">Silver (Ag) — Synthetic Example</button>' +
      "</div>" +

      '<div class="card"><h3>' + esc(bucket.unit_label) + ' <span class="badge ' + (STATE.tierMetal === "gold" ? "b-gold" : "b-silver") + '">100% SYNTHETIC</span></h3>' +
      '<div class="tier-list">' +
      bucket.tiers.map((t) => (
        '<div class="tier-card">' +
        '<div class="tier-top"><span class="badge ' + (t.tier === 3 ? "b-amber" : (t.tier >= 5 ? "b-green" : "b-silver")) + '">TIER ' + t.tier + '</span><span class="mono muted">' + esc(t.unit) + "</span></div>" +
        '<div style="font-weight:700;margin-bottom:4px">' + esc(t.name) + "</div>" +
        '<div class="tier-val ' + (STATE.tierMetal === "gold" ? "gold-txt" : "silver-txt") + '">' + esc(t.value) + "</div>" +
        '<p class="muted" style="margin:6px 0 0;font-size:12.5px">' + esc(t.note) + "</p>" +
        "</div>"
      )).join("") +
      "</div></div>" +

      '<div class="card"><h3>Visual Price-Layer Divergence (TRY / Gram — Synthetic)</h3>' +
      renderTierBridgeSvg(STATE.tierMetal) +
      "</div>";

    document.getElementById("tier-gold").addEventListener("click", () => { STATE.tierMetal = "gold"; renderStructure(); });
    document.getElementById("tier-silver").addEventListener("click", () => { STATE.tierMetal = "silver"; renderStructure(); });
  }

  // ---------- Module 3: Currency Decomposition Calculator ----------
  function renderDecomp() {
    const el = document.getElementById("panel-decomp");
    const res = computeExactDecomposition(STATE.p0, STATE.p1, STATE.e0, STATE.e1);
    const presets = DATA.decomposition_presets;

    el.innerHTML =
      '<div class="view-head"><div><h2>Exact Currency &amp; Metal Decomposition Calculator</h2>' +
      "<p>Splits theoretical TRY/gram changes into USD metal contribution, USD/TRY FX contribution, and cross-interaction using exact <code>31.1034768 g/oz</code> arithmetic.</p></div></div>" +

      '<div class="card"><h3>Synthetic Scenario Presets &amp; Custom Inputs</h3>' +
      '<div class="controls">' +
      presets.map((pr) => '<button class="btn btn-sm" data-preset="' + esc(pr.id) + '" aria-pressed="' + (STATE.decompPreset === pr.id ? "true" : "false") + '">' + esc(pr.label) + "</button>").join("") +
      "</div>" +
      '<div class="controls">' +
      '<div class="field"><label for="inp-p0">Start Metal (USD/oz)</label><input id="inp-p0" type="number" step="0.01" value="' + esc(STATE.p0) + '" /></div>' +
      '<div class="field"><label for="inp-p1">End Metal (USD/oz)</label><input id="inp-p1" type="number" step="0.01" value="' + esc(STATE.p1) + '" /></div>' +
      '<div class="field"><label for="inp-e0">Start USD/TRY</label><input id="inp-e0" type="number" step="0.0001" value="' + esc(STATE.e0) + '" /></div>' +
      '<div class="field"><label for="inp-e1">End USD/TRY</label><input id="inp-e1" type="number" step="0.0001" value="' + esc(STATE.e1) + '" /></div>' +
      "</div>" +
      (!res.valid
        ? '<div class="notice notice-red"><strong>Input Validation Error:</strong> ' + esc(res.error) + "</div>"
        : '<div class="kpi-grid" style="margin-bottom:14px">' +
          '<div class="kpi"><div class="kpi-label">Theoretical Start → End</div><div class="kpi-val" style="font-size:16px">' + esc(res.g0Str) + " → " + esc(res.g1Str) + '</div><div class="kpi-sub">Total Δ: ' + esc(res.totalStr) + " TRY/g (" + esc(res.rTotStr) + "%)</div></div>" +
          '<div class="kpi"><div class="kpi-label">USD Metal Contribution</div><div class="kpi-val gold-txt">' + esc(res.usdStr) + '</div><div class="kpi-sub">TRY/g · Metal return: ' + esc(res.rUsdStr) + "%</div></div>" +
          '<div class="kpi"><div class="kpi-label">USD/TRY FX Contribution</div><div class="kpi-val silver-txt">' + esc(res.fxStr) + '</div><div class="kpi-sub">TRY/g · FX return: ' + esc(res.rFxStr) + "%</div></div>" +
          '<div class="kpi"><div class="kpi-label">Cross-Interaction Term</div><div class="kpi-val">' + esc(res.interStr) + '</div><div class="kpi-sub">((P1−P0)×(E1−E0)) ÷ 31.1034768</div></div>' +
          "</div>" +
          renderDecompositionWaterfallSvg(res)) +
      "</div>";

    el.querySelectorAll("[data-preset]").forEach((b) => {
      b.addEventListener("click", () => {
        const pr = presets.find((x) => x.id === b.dataset.preset);
        if (!pr) return;
        STATE.decompPreset = pr.id;
        STATE.p0 = pr.p0; STATE.p1 = pr.p1; STATE.e0 = pr.e0; STATE.e1 = pr.e1;
        renderDecomp();
      });
    });
    [["inp-p0", "p0"], ["inp-p1", "p1"], ["inp-e0", "e0"], ["inp-e1", "e1"]].forEach(([id, key]) => {
      const inp = document.getElementById(id);
      if (inp) {
        inp.addEventListener("input", () => {
          STATE.decompPreset = "custom";
          STATE[key] = inp.value;
          renderDecomp();
        });
      }
    });
  }

  // ---------- Module 4: Synthetic Portfolio Ledger ----------
  function renderLedger() {
    const el = document.getElementById("panel-ledger");
    const summary = computeLedgerSummary(STATE.voidApplied);
    const entries = DATA.synthetic_ledger.financial_entries;
    const physicals = DATA.synthetic_ledger.physical_holdings;

    el.innerHTML =
      '<div class="view-head"><div><h2>Synthetic Fixed-Point Portfolio Ledger</h2>' +
      "<p>Exact integer accounting (<code>ug</code> = 10⁻⁶ g, <code>e4</code> = 10⁻⁴ TRY), append-only Alternative-B voids, and strict physical-lot separation.</p></div></div>" +

      '<div class="notice notice-silver"><strong>100% SYNTHETIC LEDGER:</strong> All quantities, costs, and timestamps below are fabricated educational entries. Zero real owner balances, receipts, or account IDs exist in this showcase.</div>' +

      '<div class="controls">' +
      '<button class="btn" id="toggle-void" aria-pressed="' + (STATE.voidApplied ? "true" : "false") + '">' +
      (STATE.voidApplied ? "Alternative-B Void Active (TX-003 Typo Voided)" : "Alternative-B Void Removed (TX-003 50g Typo Active)") +
      "</button>" +
      "</div>" +

      '<div class="kpi-grid">' +
      '<div class="kpi"><div class="kpi-label">Synthetic Gold (995‰)</div><div class="kpi-val gold-txt">' + esc(fmtUgToGrams(summary.gold.balance_ug)) + '</div><div class="kpi-sub">Exact integer: ' + esc(summary.gold.balance_ug.toLocaleString("en-US")) + " ug</div></div>" +
      '<div class="kpi"><div class="kpi-label">Gold Weighted-Avg Cost</div><div class="kpi-val">' + esc(fmtE4ToTry(summary.gold.avg_cost_e4_per_g)) + '/g</div><div class="kpi-sub">Total Cost: ' + esc(fmtE4ToTry(summary.gold.total_cost_e4)) + "</div></div>" +
      '<div class="kpi"><div class="kpi-label">Synthetic Silver (999‰)</div><div class="kpi-val silver-txt">' + esc(fmtUgToGrams(summary.silver.balance_ug)) + '</div><div class="kpi-sub">Exact integer: ' + esc(summary.silver.balance_ug.toLocaleString("en-US")) + " ug</div></div>" +
      '<div class="kpi"><div class="kpi-label">Silver Weighted-Avg Cost</div><div class="kpi-val">' + esc(fmtE4ToTry(summary.silver.avg_cost_e4_per_g)) + '/g</div><div class="kpi-sub">Total Cost: ' + esc(fmtE4ToTry(summary.silver.total_cost_e4)) + "</div></div>" +
      "</div>" +

      '<div class="card"><h3>Append-Only Financial Transaction Journal (UPDATE / DELETE Blocked)</h3>' +
      '<p class="card-sub">Toggle the Alternative-B void above to observe how a decimal typo (<code>TX-003</code>) is reversed strictly by appending <code>TX-003-VOID</code> without mutating historical rows.</p>' +
      '<div class="table-wrap"><table><thead><tr><th>Entry ID</th><th>Timestamp (UTC)</th><th>Instrument</th><th>Side</th><th class="num">Mass (g)</th><th class="num">Unit Price</th><th class="num">Net Total (e4 TRY)</th><th>State</th></tr></thead><tbody>' +
      entries.map((tx) => {
        const isVoided = STATE.voidApplied && tx.voidable_demo;
        return (
          '<tr class="' + (isVoided ? "voided" : "") + '">' +
          '<td class="mono"><strong>' + esc(tx.entry_id) + "</strong></td>" +
          '<td class="mono muted">' + esc(tx.timestamp_utc) + "</td>" +
          '<td><span class="badge ' + (tx.instrument === "gold" ? "b-gold" : "b-silver") + '">' + esc(tx.instrument.toUpperCase() + " " + tx.fineness_milli + "‰") + "</span></td>" +
          '<td class="mono">' + esc(tx.side.toUpperCase()) + "</td>" +
          '<td class="num">' + esc(fmtUgToGrams(tx.quantity_ug)) + "</td>" +
          '<td class="num">' + esc(fmtE4ToTry(tx.unit_price_e4)) + "</td>" +
          '<td class="num">' + esc(fmtE4ToTry(tx.total_cost_e4)) + "</td>" +
          "<td>" + (isVoided ? '<span class="badge b-red">VOIDED (' + esc(tx.void_entry_id) + ")</span>" : '<span class="badge b-green">ACTIVE</span>') + "</td>" +
          "</tr>"
        );
      }).join("") +
      "</tbody></table></div></div>" +

      '<div class="card"><h3>Isolated Physical Holdings Ledger (Bank Quotes Never Applied)</h3>' +
      '<p class="card-sub">Physical coins and bars track exact remaining gross mass and fine mass (<code>(gross_ug × fineness_milli) // 1000</code>) and remain strictly isolated from bank quotes.</p>' +
      '<div class="table-wrap"><table><thead><tr><th>Lot ID</th><th>Synthetic Description</th><th class="num">Remaining Pieces</th><th class="num">Remaining Gross</th><th class="num">Exact Fine Mass</th><th>Bank Quote Applied?</th><th>Valuation Status</th></tr></thead><tbody>' +
      physicals.map((ph) => {
        const remPieces = ph.pieces_total - ph.pieces_disposed;
        const remGrossUg = remPieces * ph.gross_weight_per_piece_ug;
        const fineUg = Math.floor((remGrossUg * ph.fineness_milli) / 1000);
        return (
          "<tr>" +
          '<td class="mono"><strong>' + esc(ph.holding_id) + "</strong></td>" +
          "<td>" + esc(ph.label) + " (" + esc(ph.fineness_milli) + "‰)</td>" +
          '<td class="num">' + remPieces + " / " + ph.pieces_total + "</td>" +
          '<td class="num">' + esc(fmtUgToGrams(remGrossUg)) + "</td>" +
          '<td class="num">' + esc(fmtUgToGrams(fineUg)) + "</td>" +
          '<td><span class="badge b-amber">FALSE</span></td>' +
          '<td class="muted">' + esc(ph.dealer_valuation_status) + "</td>" +
          "</tr>"
        );
      }).join("") +
      "</tbody></table></div></div>";

    document.getElementById("toggle-void").addEventListener("click", () => {
      STATE.voidApplied = !STATE.voidApplied;
      renderLedger();
    });
  }

  // ---------- Module 5: Spread & Quote Freshness ----------
  function renderSpread() {
    const el = document.getElementById("panel-spread");
    const sp = computeSpreadMetrics(STATE.bidStr, STATE.askStr);
    const isFresh = STATE.quoteAgeSec <= 900;
    const isEligible = sp.valid && isFresh;
    const sampleGrams = DATA.quote_defaults[STATE.spreadMetal].sample_grams;
    const sampleUg = parseScaledInt(sampleGrams, 6) || 0n;

    let grossBidStr = "WITHHELD";
    let roundTripCostStr = "WITHHELD";
    if (isEligible) {
      const grossBidE4 = (sp.bidE4 * sampleUg) / 1_000_000n;
      const grossAskE4 = (sp.askE4 * sampleUg) / 1_000_000n;
      grossBidStr = formatBigScaled(grossBidE4, 4, 2) + " TRY";
      roundTripCostStr = formatBigScaled(grossAskE4 - grossBidE4, 4, 2) + " TRY";
    }

    el.innerHTML =
      '<div class="view-head"><div><h2>Generic Bank Spread &amp; 900s Quote Freshness Gate</h2>' +
      "<p>Demonstrates GoSil's exact spread drag formulas and fail-closed withholding when quotes exceed the 900-second (15-minute) eligibility window or fail price sanity checks.</p></div></div>" +

      '<div class="card"><h3>Interactive Synthetic Quote Controls</h3>' +
      '<div class="controls">' +
      '<button class="btn btn-sm" id="sp-gold" aria-pressed="' + (STATE.spreadMetal === "gold" ? "true" : "false") + '">Synthetic Gold Preset</button>' +
      '<button class="btn btn-sm" id="sp-silver" aria-pressed="' + (STATE.spreadMetal === "silver" ? "true" : "false") + '">Synthetic Silver Preset</button>' +
      '<button class="btn btn-sm" id="sp-stale">Test Stale (901s)</button>' +
      '<button class="btn btn-sm" id="sp-boundary">Test Exact Boundary (900s)</button>' +
      '<button class="btn btn-sm" id="sp-malformed">Test Malformed (Ask &lt; Bid)</button>' +
      "</div>" +
      '<div class="controls">' +
      '<div class="field"><label for="inp-bid">Generic Bank Bid (TRY/g)</label><input id="inp-bid" type="number" step="0.01" value="' + esc(STATE.bidStr) + '" /></div>' +
      '<div class="field"><label for="inp-ask">Generic Bank Ask (TRY/g)</label><input id="inp-ask" type="number" step="0.01" value="' + esc(STATE.askStr) + '" /></div>' +
      '<div class="field" style="flex:1;min-width:220px"><label for="inp-age">Quote Age: <strong class="mono">' + STATE.quoteAgeSec + 's</strong> (Limit: 900s)</label><input id="inp-age" type="range" min="0" max="1800" step="1" value="' + STATE.quoteAgeSec + '" /></div>' +
      "</div>" +

      (!sp.valid
        ? '<div class="notice notice-red"><strong>' + esc(sp.code) + ":</strong> " + esc(sp.error) + " All downstream decision comparisons are strictly <strong>WITHHELD</strong>.</div>"
        : (isFresh
            ? '<div class="notice notice-green"><strong>ELIGIBLE (' + STATE.quoteAgeSec + 's &lt;= 900s):</strong> Generic bank quote passes freshness and <code>ask &gt;= bid</code> invariants. Calculations below are descriptive gross comparisons (before tax) — never BUY/SELL instructions.</div>'
            : '<div class="notice notice-red"><strong>STALE — WITHHELD (' + STATE.quoteAgeSec + 's &gt; 900s):</strong> Quote exceeds the 900-second eligibility cutoff. Executable gross valuation and decision comparisons are fail-closed <strong>WITHHELD</strong>.</div>')) +

      '<div class="kpi-grid" style="margin-bottom:0">' +
      '<div class="kpi"><div class="kpi-label">Eligibility Status</div><div class="kpi-val">' + (isEligible ? '<span class="pos">ELIGIBLE</span>' : '<span class="neg">WITHHELD</span>') + '</div><div class="kpi-sub">Cutoff: &lt;= 900s &amp; ask &gt;= bid</div></div>' +
      '<div class="kpi"><div class="kpi-label">Mid-Relative Spread</div><div class="kpi-val">' + esc(sp.valid ? sp.midSpreadStr : "WITHHELD") + '</div><div class="kpi-sub">2 × (ask − bid) ÷ (ask + bid)</div></div>' +
      '<div class="kpi"><div class="kpi-label">Immediate Spread Drag</div><div class="kpi-val">' + esc(sp.valid ? sp.dragStr : "WITHHELD") + '</div><div class="kpi-sub">(ask − bid) ÷ ask (instant buy→sell loss)</div></div>' +
      '<div class="kpi"><div class="kpi-label">Synthetic Gross Bid (' + esc(sampleGrams.split(".")[0]) + 'g)</div><div class="kpi-val" style="font-size:17px">' + esc(grossBidStr) + '</div><div class="kpi-sub">Spread friction: ' + esc(roundTripCostStr) + " (before tax)</div></div>" +
      "</div></div>";

    document.getElementById("sp-gold").addEventListener("click", () => {
      STATE.spreadMetal = "gold"; STATE.bidStr = DATA.quote_defaults.gold.bid_try_g; STATE.askStr = DATA.quote_defaults.gold.ask_try_g; STATE.quoteAgeSec = 420; renderSpread();
    });
    document.getElementById("sp-silver").addEventListener("click", () => {
      STATE.spreadMetal = "silver"; STATE.bidStr = DATA.quote_defaults.silver.bid_try_g; STATE.askStr = DATA.quote_defaults.silver.ask_try_g; STATE.quoteAgeSec = 420; renderSpread();
    });
    document.getElementById("sp-stale").addEventListener("click", () => { STATE.quoteAgeSec = 901; renderSpread(); });
    document.getElementById("sp-boundary").addEventListener("click", () => { STATE.quoteAgeSec = 900; renderSpread(); });
    document.getElementById("sp-malformed").addEventListener("click", () => { STATE.bidStr = "3050.00"; STATE.askStr = "2990.00"; STATE.quoteAgeSec = 120; renderSpread(); });
    document.getElementById("inp-bid").addEventListener("input", (ev) => { STATE.bidStr = ev.target.value; renderSpread(); });
    document.getElementById("inp-ask").addEventListener("input", (ev) => { STATE.askStr = ev.target.value; renderSpread(); });
    document.getElementById("inp-age").addEventListener("input", (ev) => { STATE.quoteAgeSec = Number(ev.target.value); renderSpread(); });
  }

  // ---------- Module 6: Statistical Forecast Evaluation ----------
  function renderForecast() {
    const el = document.getElementById("panel-forecast");
    const list = DATA.forecast_evaluation.synthetic_series;
    const series = list[STATE.forecastSeriesIdx] || list[0];
    const hObj = series.horizons[STATE.forecastHorizon] || series.horizons["6"];
    const models = ["naive", "drift", "damped_trend"].map((k) => hObj.models[k]);

    el.innerHTML =
      '<div class="view-head"><div><h2>Statistical Forecast Evaluation (Walk-Forward Methodology)</h2>' +
      "<p>Illustrates GoSil's purged chronological validation, 5% development-MAE challenger promotion gate, and non-probabilistic sensitivity bands (<code>probability: null</code>).</p></div></div>" +

      '<div class="notice notice-gold"><strong>METHODOLOGY DEMONSTRATION ONLY:</strong> Charts and tables below run GoSil\'s exact classical formulas over <strong>100% synthetic 36-month sequences</strong>. They do not predict real gold or silver prices and contain zero IMF/BIS observations.</div>' +

      '<div class="card">' +
      '<div class="controls">' +
      list.map((s, i) => '<button class="btn btn-sm" data-fseries="' + i + '" aria-pressed="' + (STATE.forecastSeriesIdx === i ? "true" : "false") + '">' + esc(s.name) + "</button>").join("") +
      '<button class="btn btn-sm" data-fhor="3" aria-pressed="' + (STATE.forecastHorizon === "3" ? "true" : "false") + '">Horizon: 3 Months</button>' +
      '<button class="btn btn-sm" data-fhor="6" aria-pressed="' + (STATE.forecastHorizon === "6" ? "true" : "false") + '">Horizon: 6 Months</button>' +
      "</div>" +
      '<p class="muted" style="margin:0 0 12px">' + esc(series.description) + " · Selected model: <strong class=\"gold-txt mono\">" + esc(hObj.selected_model) + "</strong></p>" +
      renderForecastSvg(series, hObj) +
      '<div class="table-wrap" style="margin-top:16px"><table><thead><tr><th>Model</th><th class="num">Dev MAE</th><th class="num">Test MAE</th><th class="num">Final Point</th><th class="num">Sensitivity Band (p = null)</th><th>Promotion Gate (≥ 5% vs Naive)</th></tr></thead><tbody>' +
      models.map((m) => (
        "<tr>" +
        '<td class="mono"><strong>' + esc(m.model) + "</strong></td>" +
        '<td class="num">' + esc(m.dev_mae) + "</td>" +
        '<td class="num">' + esc(m.test_mae) + "</td>" +
        '<td class="num">' + (m.promoted ? esc(m.final_point) : '<span class="muted">WITHHELD</span>') + "</td>" +
        '<td class="num">' + (m.promoted ? esc(m.band_lower + " .. " + m.band_upper) : '<span class="muted">WITHHELD</span>') + "</td>" +
        "<td>" + (m.promoted ? '<span class="badge b-green">' + (m.model === "naive" ? "BASELINE" : "PROMOTED") + "</span> " : '<span class="badge b-amber">WITHHELD</span> ') + '<span class="muted">' + esc(m.status_reason) + "</span></td>" +
        "</tr>"
      )).join("") +
      "</tbody></table></div></div>" +

      '<div class="card"><h3>Qualitative Summary of Private Historical Research Findings</h3>' +
      '<p class="card-sub">Reported honestly from GoSil\'s frozen retrospective evaluations — zero external dataset values are retained or redistributed here.</p>' +
      '<ul class="muted" style="margin:0;padding-left:18px">' +
      DATA.forecast_evaluation.historical_qualitative_findings.map((f) => '<li style="margin-bottom:6px">' + esc(f) + "</li>").join("") +
      "</ul></div>";

    el.querySelectorAll("[data-fseries]").forEach((b) => b.addEventListener("click", () => { STATE.forecastSeriesIdx = Number(b.dataset.fseries); renderForecast(); }));
    el.querySelectorAll("[data-fhor]").forEach((b) => b.addEventListener("click", () => { STATE.forecastHorizon = b.dataset.fhor; renderForecast(); }));
  }

  // ---------- Module 7: Architecture & Evidence ----------
  function renderArch() {
    const el = document.getElementById("panel-arch");
    el.innerHTML =
      '<div class="view-head"><div><h2>Local-First Architecture, Security Controls &amp; Evidence</h2>' +
      "<p>High-level system boundaries of the frozen private GoSil engine and its isolated 100% synthetic showcase.</p></div></div>" +

      '<div class="card"><h3>System &amp; Privacy Boundary Diagram (Original Vector Artwork)</h3>' +
      '<div class="chart-box">' +
      '<svg viewBox="0 0 900 250" role="img" aria-label="GoSil local-first architecture showing Private SQLite Vault outside Git, Fixed-Point Core Engine, Locked Read-Only Bridge, and 100% Synthetic Public Showcase">' +
      '<defs><marker id="garr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" fill="#d8b25c" /></marker></defs>' +
      '<rect x="16" y="24" width="250" height="200" rx="8" fill="#181820" stroke="#e06363" stroke-width="1.5" stroke-dasharray="5 3" />' +
      '<text x="30" y="50" fill="#f79999" font-size="13" font-weight="700">Private Local Vault (Outside Git)</text>' +
      '<text x="30" y="72" fill="#9b9fae" font-size="11.5">• Mode 0700 dir / 0600 SQLite DB</text>' +
      '<text x="30" y="92" fill="#9b9fae" font-size="11.5">• STRICT Append-Only Schema v1</text>' +
      '<text x="30" y="112" fill="#9b9fae" font-size="11.5">• Triggers block UPDATE / DELETE</text>' +
      '<text x="30" y="132" fill="#9b9fae" font-size="11.5">• SHA-256 Verified Online Backups</text>' +
      '<text x="30" y="164" fill="#e06363" font-size="11" font-weight="700">HARD LOCKED: First-Read = False</text>' +
      '<text x="30" y="184" fill="#737788" font-size="10.5">Never accessed by public showcase</text>' +

      '<rect x="322" y="24" width="260" height="200" rx="8" fill="#181820" stroke="#d8b25c" stroke-width="1.6" />' +
      '<text x="336" y="50" fill="#d8b25c" font-size="13" font-weight="700">Frozen Private Engine (Python 3.11+)</text>' +
      '<text x="336" y="72" fill="#eeeff2" font-size="11.5">Zero Runtime Third-Party Dependencies</text>' +
      '<text x="336" y="94" fill="#9b9fae" font-size="11.5">• Exact e4 TRY / ug Mass / Fraction</text>' +
      '<text x="336" y="114" fill="#9b9fae" font-size="11.5">• 6-Tier Price &amp; 900s Freshness Gate</text>' +
      '<text x="336" y="134" fill="#9b9fae" font-size="11.5">• Purged Walk-Forward Forecast Core</text>' +
      '<text x="336" y="154" fill="#9b9fae" font-size="11.5">• 127.0.0.1 Loopback + CSRF + No-Store</text>' +
      '<text x="336" y="188" fill="#4dc28a" font-size="11">Verified: 739 pytest + 205 UI3 PASS</text>' +

      '<rect x="638" y="24" width="246" height="200" rx="8" fill="#141419" stroke="#b8c4d4" stroke-width="1.6" />' +
      '<text x="652" y="50" fill="#b8c4d4" font-size="13" font-weight="700">Public Showcase (This Site)</text>' +
      '<text x="652" y="72" fill="#eeeff2" font-size="11.5">100% Synthetic · Zero Backend</text>' +
      '<text x="652" y="94" fill="#9b9fae" font-size="11.5">• Exact 31.1034768 Decomposition</text>' +
      '<text x="652" y="114" fill="#9b9fae" font-size="11.5">• Synthetic Ledger &amp; Void Toggle</text>' +
      '<text x="652" y="134" fill="#9b9fae" font-size="11.5">• Spread &amp; 900s Freshness Lab</text>' +
      '<text x="652" y="154" fill="#9b9fae" font-size="11.5">• Zero IMF/BIS · Zero Bank Names</text>' +
      '<text x="652" y="188" fill="#d8b25c" font-size="11">Standalone Unit Tests Verified</text>' +

      '<line x1="266" y1="124" x2="320" y2="124" stroke="#e06363" stroke-width="1.8" stroke-dasharray="4 3" />' +
      '<line x1="582" y1="124" x2="636" y2="124" stroke="#d8b25c" stroke-width="1.8" marker-end="url(#garr)" />' +
      "</svg></div></div>" +

      '<div class="grid-2">' +
      '<div class="card"><h3>Historical &amp; Showcase Test Evidence</h3>' +
      '<div class="table-wrap"><table><thead><tr><th>Suite</th><th>Scope</th><th>Status</th></tr></thead><tbody>' +
      '<tr><td>Private Python + Hypothesis</td><td>Fixed-point math, SQLite triggers, security, CORE1–D23</td><td><span class="badge b-green">739/739 PASS</span></td></tr>' +
      '<tr><td>Private UI3 Contract Suite</td><td>Offline prototype rendering &amp; contract security</td><td><span class="badge b-green">205/205 PASS</span></td></tr>' +
      '<tr><td>Public Standalone Suite</td><td>Synthetic math identities, voids, 900s gate, privacy</td><td><span class="badge b-green">VERIFIED</span></td></tr>' +
      '<tr><td>Live Bank / LLM Prediction</td><td>Bank APIs, live quotes, LLM/AI forecasting</td><td><span class="badge b-red">NOT IMPLEMENTED</span></td></tr>' +
      "</tbody></table></div></div>" +

      '<div class="card"><h3>Known Limitations &amp; Frozen Scope</h3>' +
      '<ul class="muted" style="margin:0;padding-left:18px">' +
      '<li style="margin-bottom:6px"><strong>Frozen Project:</strong> Active development is discontinued; deferred real-owner gates remain permanently closed in this archive.</li>' +
      '<li style="margin-bottom:6px"><strong>No LLM / AI Prediction Engine:</strong> Implements exact fixed-point accounting and classical statistical baselines only.</li>' +
      '<li style="margin-bottom:6px"><strong>Zero Live Market Data:</strong> No external APIs are contacted; every numeric figure here is synthetic.</li>' +
      '<li><strong>Non-Advisory:</strong> Gross comparisons omit after-tax liquidation calculations and never constitute investment advice.</li>' +
      "</ul></div></div>";
  }

  function renderActiveTab() {
    if (STATE.tab === "overview") renderOverview();
    else if (STATE.tab === "structure") renderStructure();
    else if (STATE.tab === "decomp") renderDecomp();
    else if (STATE.tab === "ledger") renderLedger();
    else if (STATE.tab === "spread") renderSpread();
    else if (STATE.tab === "forecast") renderForecast();
    else if (STATE.tab === "arch") renderArch();
  }

  setupTabs();
  renderOverview();
})();
