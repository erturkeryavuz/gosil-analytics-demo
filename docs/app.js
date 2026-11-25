(function () {
  "use strict";

  const DATA = window.GOSIL_SHOWCASE_DATA;
  if (!DATA) return;

  const STATE = {
    tab: "overview",
    overviewPreset: "gold_combined",
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

  function cloneState() {
    return Object.assign({}, STATE);
  }

  function restoreState(snap) {
    if (!snap) return;
    Object.keys(STATE).forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(snap, k)) STATE[k] = snap[k];
    });
  }

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

  function parseNum(str) {
    const clean = String(str || "").replace(/,/g, "").trim();
    const v = Number(clean);
    return Number.isFinite(v) ? v : null;
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
    const TROY_NUM = 311034768n;
    const MULT = 10n ** 13n;
    const toTryG = (num1) => (num1 * MULT) / TROY_NUM;

    const g0 = toTryG(p0 * e0);
    const g1 = toTryG(p1 * e1);
    const dp = p1 - p0;
    const de = e1 - e0;
    const usdC = toTryG(dp * e0);
    const fxC = toTryG(p0 * de);
    const interC = toTryG(dp * de);
    const totalDelta = g1 - g0;

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
    const midSpreadPct = (2n * diff * 10n ** 8n) / (ask + bid);
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
    const tabs = Array.from(document.querySelectorAll("#gosil-tablist .nav-tab"));
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
    const tabs = Array.from(document.querySelectorAll("#gosil-tablist .nav-tab"));
    tabs.forEach((btn) => {
      btn.addEventListener("click", () => switchTab(btn.dataset.tab));
      btn.addEventListener("keydown", (ev) => {
        const idx = tabs.indexOf(btn);
        let next = null;
        if (ev.key === "ArrowRight") next = tabs[(idx + 1) % tabs.length];
        else if (ev.key === "ArrowLeft") next = tabs[(idx - 1 + tabs.length) % tabs.length];
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

  // ---------- Data-Grounded SVG Visualizations ----------
  function computeNiceScale(minVal, maxVal, approxTicks, forceZero) {
    let lo = minVal;
    let hi = maxVal;
    if (forceZero) {
      if (lo > 0) lo = 0;
      if (hi < 0) hi = 0;
    }
    const rawSpan = Math.max(1e-6, hi - lo);
    const roughStep = rawSpan / Math.max(2, (approxTicks || 4) - 1);
    const mag = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const norm = roughStep / mag;
    let niceNorm;
    if (norm <= 1.15) niceNorm = 1;
    else if (norm <= 1.65) niceNorm = 1.5;
    else if (norm <= 2.4) niceNorm = 2;
    else if (norm <= 3.2) niceNorm = 2.5;
    else if (norm <= 5.5) niceNorm = 5;
    else niceNorm = 10;
    const step = niceNorm * mag;
    const niceMin = Math.floor(lo / step) * step;
    const niceMax = Math.ceil(hi / step) * step;
    const ticks = [];
    const decimals = step < 1 ? Math.min(2, Math.ceil(-Math.log10(step))) : (Math.abs(step - Math.round(step)) > 1e-6 ? 1 : 0);
    for (let v = niceMin; v <= niceMax + step * 0.001; v += step) {
      ticks.push(Math.abs(v) < step * 1e-6 ? 0 : Number(v.toFixed(6)));
      if (ticks.length > 9) break;
    }
    return { min: niceMin, max: niceMax, step: step, ticks: ticks, decimals: decimals };
  }

  function renderTierBridgeSvg(metalKey) {
    const isGold = metalKey === "gold";
    const tiers = DATA.six_price_tiers[metalKey].tiers;
    const t3 = parseNum(tiers.find((t) => t.tier === 3).value);
    const t4 = parseNum(tiers.find((t) => t.tier === 4).value);
    const t5Parts = tiers.find((t) => t.tier === 5).value.split("/").map((s) => parseNum(s));
    const t6 = parseNum(tiers.find((t) => t.tier === 6).value);
    const accent = isGold ? "#D4AF63" : "#B9C6D6";

    const bars = [
      { lbl: "Tier 3: Parity", val: t3, col: "#758D92" },
      { lbl: "Tier 4: Retail", val: t4, col: "#B9C6D6" },
      { lbl: "Tier 5: Bank Bid", val: t5Parts[0], col: "#C96A6A" },
      { lbl: "Tier 5: Bank Ask", val: t5Parts[1], col: accent },
      { lbl: "Tier 6: Net Exec", val: t6, col: "#4E9F76" },
    ];
    const compact = window.innerWidth <= 420;
    const W = compact ? 440 : 920;
    const H = compact ? 186 : 220;
    const padL = compact ? 50 : 64;
    const padR = 18;
    const padT = 26;
    const padB = 34;
    const vals = bars.map((b) => b.val);
    const span = Math.max(0.5, Math.max(...vals) - Math.min(...vals));
    const scale = computeNiceScale(Math.max(0, Math.min(...vals) - span * 0.35), Math.max(...vals) + span * 0.22, 4, false);
    const minV = scale.min;
    const maxV = scale.max;
    const range = maxV - minV || 1;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const yOf = (v) => padT + ((maxV - v) / range) * plotH;
    const slotW = plotW / bars.length;
    const barW = compact ? 44 : 64;

    let grid = "";
    scale.ticks.forEach((gv) => {
      const y = yOf(gv);
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#282C34" stroke-width="1" />';
      grid += '<text x="' + (padL - 8) + '" y="' + (y + 3.5).toFixed(1) + '" fill="#8E96A3" font-size="10.5" text-anchor="end" font-family="monospace">' + gv.toFixed(scale.decimals) + "</text>";
    });

    let rects = "";
    bars.forEach((b, i) => {
      const cx = padL + i * slotW + slotW / 2;
      const y = yOf(b.val);
      const h = Math.max(4, H - padB - y);
      const shortLbl = compact ? b.lbl.replace("Tier ", "T") : b.lbl;
      rects += '<rect x="' + (cx - barW / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW + '" height="' + h.toFixed(1) + '" rx="4" fill="' + b.col + '" fill-opacity="0.86"><title>Synthetic ' + esc(b.lbl + ": " + b.val.toFixed(2) + " TRY/g") + "</title></rect>";
      rects += '<text x="' + cx.toFixed(1) + '" y="' + (y - 6).toFixed(1) + '" fill="#F1EDE5" font-size="' + (compact ? "10" : "11") + '" font-weight="600" text-anchor="middle" font-family="monospace">' + b.val.toFixed(2) + "</text>";
      rects += '<text x="' + cx.toFixed(1) + '" y="' + (H - 10) + '" fill="#A4ABB6" font-size="' + (compact ? "9.5" : "10.5") + '" text-anchor="middle">' + esc(shortLbl) + "</text>";
    });

    return (
      '<div class="chart-box" id="structure-bridge-box">' +
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Synthetic ' + esc(metalKey) + ' TRY per gram price tier comparison">' +
      grid + rects +
      "</svg>" +
      '<div class="chart-legend"><span>Theoretical parity (Tier 3) never equals executable bank bid (Tier 5) or net realized cost (Tier 6).</span></div></div>'
    );
  }

  function renderDecompositionWaterfallSvg(res, opts) {
    const o = opts || {};
    const isSilver = o.metal === "silver";
    const metalColor = isSilver ? "#B9C6D6" : "#D4AF63";
    const compact = Boolean(o.compact) || window.innerWidth <= 420;
    const items = [
      { lbl: compact ? "Metal" : "Metal Price Effect", val: res.usdNum, col: metalColor },
      { lbl: compact ? "FX Rate" : "Exchange Rate Effect", val: res.fxNum, col: "#758D92" },
      { lbl: compact ? "Combined" : "Combined Effect", val: res.interNum, col: "#8C98B8" },
      { lbl: compact ? "Total Δ" : "Total Price Change", val: res.totalNum, col: res.totalNum >= 0 ? "#4E9F76" : "#C96A6A" },
    ];
    const W = compact ? 440 : (o.overview ? 620 : 900);
    const H = compact ? 182 : (o.overview ? 204 : 226);
    const padL = compact ? 52 : 64;
    const padR = 20;
    const padT = 26;
    const padB = 34;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const rawMax = Math.max(0, ...items.map((x) => x.val));
    const rawMin = Math.min(0, ...items.map((x) => x.val));
    const span = Math.max(1, rawMax - rawMin);
    const padHi = rawMax > 0 ? rawMax + span * 0.11 : 0;
    const padLo = rawMin < 0 ? rawMin - span * 0.11 : 0;
    const scale = computeNiceScale(padLo, padHi, rawMin < 0 ? 5 : 4, true);
    const maxV = scale.max;
    const minV = scale.min;
    const range = maxV - minV || 1;
    const yOf = (v) => padT + ((maxV - v) / range) * plotH;
    const zeroY = yOf(0);
    const slotW = plotW / items.length;
    const barW = compact ? 48 : 66;

    let grid = "";
    scale.ticks.forEach((gv) => {
      const y = yOf(gv);
      const isZero = gv === 0;
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="' + (isZero ? "#4B5260" : "#252932") + '" stroke-width="' + (isZero ? "1.3" : "1") + '" />';
      const prefix = (minV < 0 && gv > 0) ? "+" : "";
      grid += '<text x="' + (padL - 8) + '" y="' + (y + 3.5).toFixed(1) + '" fill="#8E96A3" font-size="10.5" text-anchor="end" font-family="monospace">' + prefix + gv.toFixed(scale.decimals) + "</text>";
    });

    let bars = "";
    items.forEach((it, idx) => {
      const cx = padL + idx * slotW + slotW / 2;
      const y = it.val >= 0 ? yOf(it.val) : zeroY;
      const h = Math.max(3, Math.abs(yOf(it.val) - zeroY));
      const sign = it.val > 0 ? "+" : "";
      bars += '<rect x="' + (cx - barW / 2).toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + barW + '" height="' + h.toFixed(1) + '" rx="4" fill="' + it.col + '" fill-opacity="0.88"><title>Synthetic ' + esc(it.lbl + ": " + sign + it.val.toFixed(4) + " TRY/g") + "</title></rect>";
      const lblY = it.val >= 0 ? Math.max(14, y - 6) : Math.min(H - padB - 4, y + h + 13);
      bars += '<text x="' + cx.toFixed(1) + '" y="' + lblY.toFixed(1) + '" fill="#F1EDE5" stroke="#141619" stroke-width="3.5" stroke-linejoin="round" paint-order="stroke" font-size="' + (compact ? "10.5" : "11") + '" font-weight="700" text-anchor="middle" font-family="monospace">' + sign + it.val.toFixed(2) + "</text>";
      bars += '<text x="' + cx.toFixed(1) + '" y="' + (H - 10) + '" fill="' + (idx === 3 ? "#F1EDE5" : "#A4ABB6") + '" font-size="' + (compact ? "10" : "11") + '" font-weight="' + (idx === 3 ? "600" : "400") + '" text-anchor="middle">' + esc(it.lbl) + "</text>";
    });

    const boxId = o.boxId ? ' id="' + esc(o.boxId) + '"' : "";
    return (
      '<div class="chart-box"' + boxId + ">" +
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Synthetic price driver breakdown chart showing metal price effect, exchange-rate effect, combined effect, and total TRY per gram change">' +
      grid + bars +
      "</svg>" +
      '<div class="chart-legend">' +
      '<span><i class="legend-dot" style="background:' + metalColor + '"></i>' + (isSilver ? "Silver Price Effect" : "Gold Price Effect") + "</span>" +
      '<span><i class="legend-dot" style="background:#758D92"></i>Exchange Rate Effect</span>' +
      '<span><i class="legend-dot" style="background:#8C98B8"></i>Combined Effect</span>' +
      '<span><i class="legend-dot" style="background:#4E9F76"></i>Total Price Change (TRY/g)</span>' +
      "</div></div>"
    );
  }

  function renderForecastSvg(series, horizonObj) {
    const vals = series.values.map(Number);
    const selKey = horizonObj.selected_model;
    const sel = horizonObj.models[selKey];
    const naive = horizonObj.models.naive;
    const h = horizonObj.horizon_months;
    const compact = window.innerWidth <= 420;
    const W = compact ? 440 : 960;
    const H = compact ? 186 : 236;
    const padL = compact ? 46 : 58;
    const padR = compact ? 22 : 36;
    const padT = 22;
    const padB = 32;
    const plotW = W - padL - padR;
    const plotH = H - padT - padB;
    const allV = vals.concat([Number(sel.band_lower), Number(sel.band_upper), Number(sel.final_point), Number(naive.final_point)]);
    const scale = computeNiceScale(Math.min(...allV), Math.max(...allV), 4, false);
    const minV = scale.min;
    const maxV = scale.max;
    const range = maxV - minV || 1;
    const totalPts = vals.length + h;
    const xOf = (i) => padL + (i / (totalPts - 1)) * plotW;
    const yOf = (v) => padT + ((maxV - v) / range) * plotH;

    let grid = "";
    scale.ticks.forEach((gv) => {
      const y = yOf(gv);
      grid += '<line x1="' + padL + '" y1="' + y.toFixed(1) + '" x2="' + (W - padR) + '" y2="' + y.toFixed(1) + '" stroke="#252932" stroke-width="1" />';
      grid += '<text x="' + (padL - 8) + '" y="' + (y + 3.5).toFixed(1) + '" fill="#8E96A3" font-size="10.5" text-anchor="end" font-family="monospace">' + gv.toFixed(scale.decimals) + "</text>";
    });

    const histPath = vals.map((v, i) => (i === 0 ? "M" : "L") + xOf(i).toFixed(1) + "," + yOf(v).toFixed(1)).join(" ");
    const origIdx = vals.length - 1;
    const targIdx = totalPts - 1;
    const origX = xOf(origIdx), origY = yOf(vals[origIdx]);
    const targX = xOf(targIdx);
    const bandPoly =
      origX.toFixed(1) + "," + origY.toFixed(1) + " " +
      targX.toFixed(1) + "," + yOf(Number(sel.band_upper)).toFixed(1) + " " +
      targX.toFixed(1) + "," + yOf(Number(sel.band_lower)).toFixed(1);

    const naiveLine = '<line x1="' + origX.toFixed(1) + '" y1="' + origY.toFixed(1) + '" x2="' + targX.toFixed(1) + '" y2="' + yOf(Number(naive.final_point)).toFixed(1) + '" stroke="#A4ABB6" stroke-width="1.8" stroke-dasharray="4 4" />';
    const selLine = '<line x1="' + origX.toFixed(1) + '" y1="' + origY.toFixed(1) + '" x2="' + targX.toFixed(1) + '" y2="' + yOf(Number(sel.final_point)).toFixed(1) + '" stroke="#D4AF63" stroke-width="2.5" />';
    const sepLine = '<line x1="' + origX.toFixed(1) + '" y1="' + padT + '" x2="' + origX.toFixed(1) + '" y2="' + (H - padB) + '" stroke="#444B57" stroke-width="1.2" stroke-dasharray="3 3" />';

    return (
      '<div class="chart-box" id="forecast-chart-box">' +
      '<svg viewBox="0 0 ' + W + " " + H + '" role="img" aria-label="Synthetic 36-month series with ' + h + '-month walk-forward forecast and non-probabilistic sensitivity band">' +
      grid + sepLine +
      '<polygon points="' + bandPoly + '" fill="rgba(212,175,99,0.18)" />' +
      '<path d="' + histPath + '" fill="none" stroke="#B9C6D6" stroke-width="2.2" />' +
      naiveLine + selLine +
      '<circle cx="' + targX.toFixed(1) + '" cy="' + yOf(Number(sel.final_point)).toFixed(1) + '" r="4.5" fill="#D4AF63"><title>Synthetic Selected (' + esc(selKey) + "): " + esc(sel.final_point) + " [Band: " + esc(sel.band_lower) + " .. " + esc(sel.band_upper) + ", probability=null]</title></circle>" +
      '<text x="' + xOf(0).toFixed(1) + '" y="' + (H - 9) + '" fill="#A4ABB6" font-size="10.5" font-family="monospace">Y1-M01</text>' +
      '<text x="' + (origX - 6).toFixed(1) + '" y="' + (H - 9) + '" fill="#A4ABB6" font-size="10.5" text-anchor="end" font-family="monospace">Origin (Y3-M12)</text>' +
      '<text x="' + targX.toFixed(1) + '" y="' + (H - 9) + '" fill="#D4AF63" font-size="10.5" text-anchor="end" font-family="monospace">+' + h + "m</text>" +
      "</svg>" +
      '<div class="chart-legend">' +
      '<span><i class="legend-dot" style="background:#B9C6D6"></i>Synthetic Series (36m)</span>' +
      '<span><i class="legend-dot" style="background:#D4AF63"></i>Selected (' + esc(selKey) + ")</span>" +
      '<span><i class="legend-dot" style="background:#A4ABB6"></i>Naive Baseline</span>' +
      '<span><i class="legend-dot" style="background:rgba(212,175,99,0.45)"></i>Sensitivity Band (probability = null)</span>' +
      "</div></div>"
    );
  }

  // ---------- View 1: Overview (Product-First Precious-Metals Showcase) ----------
  function renderOverview() {
    const presets = DATA.decomposition_presets;
    const overviewOptions = [
      { id: "gold_combined", short: "Gold · Rally" },
      { id: "gold_offset", short: "Gold · FX Offset" },
      { id: "silver_swing", short: "Silver · Swing" },
    ];
    const active = presets.find((p) => p.id === STATE.overviewPreset) || presets[0];
    const res = computeExactDecomposition(active.p0, active.p1, active.e0, active.e1);
    const isSilver = active.metal === "silver";
    const tourActive = Boolean(typeof TUT !== "undefined" && TUT.active);
    const signUsd = res.usdNum > 0 ? "+" : "";
    const signFx = res.fxNum > 0 ? "+" : "";
    const signTot = res.totalNum > 0 ? "+" : "";

    const el = document.getElementById("panel-overview");
    el.innerHTML =
      '<div class="ov-hero-band" id="ov-hero-band">' +
      '<div class="ov-intro" id="ov-intro-block">' +
      '<h2 class="ov-headline">See what really moves <em>gold and silver prices.</em></h2>' +
      '<p class="ov-lead">Understand gold and silver price movements, separate international metal changes from exchange-rate effects, compare buying and selling costs, and evaluate statistical forecasting methods in one workspace.</p>' +
      '<div class="ov-actions">' +
      '<button type="button" class="btn btn-primary" id="btnOvStartTour"' + (tourActive ? " hidden" : "") + ">Start Guided Tour</button>" +
      '<button type="button" class="btn" id="btnOvExploreStructure">Explore Pricing</button>' +
      "</div>" +
      "</div>" +

      '<div class="ov-spotlight" id="ov-focal-stage">' +
      '<div class="ov-spot-head">' +
      '<div class="ov-spot-identity">' +
      '<h2>Price Driver Breakdown <span class="mono ' + (isSilver ? "silver-txt" : "gold-txt") + '">' + (isSilver ? "Ag" : "Au") + "</span></h2>" +
      "<span>" + esc(active.label) + " (TRY / gram)</span>" +
      "</div>" +
      '<div class="ov-spot-tabs" role="group" aria-label="Sample price driver scenario selector">' +
      overviewOptions.map((opt) =>
        '<button type="button" class="ov-spot-tab" data-ov-preset="' + esc(opt.id) + '" aria-pressed="' + (opt.id === active.id ? "true" : "false") + '">' + esc(opt.short) + "</button>"
      ).join("") +
      "</div></div>" +

      '<div class="ov-spot-summary" id="ov-spot-summary">' +
      "<span>Parity TRY/g <strong>" + esc(Number(res.g0Str).toFixed(2)) + " → " + esc(Number(res.g1Str).toFixed(2)) + "</strong></span>" +
      "<span>Metal Effect <strong class=\"" + (isSilver ? "silver-txt" : "gold-txt") + '">' + signUsd + esc(Number(res.usdStr).toFixed(2)) + "</strong></span>" +
      '<span>FX Effect <strong>' + signFx + esc(Number(res.fxStr).toFixed(2)) + "</strong></span>" +
      '<span>Total Δ <strong class="' + (res.totalNum >= 0 ? "pos" : "neg") + '">' + signTot + esc(Number(res.totalStr).toFixed(2)) + "</strong></span>" +
      "</div>" +

      renderDecompositionWaterfallSvg(res, { overview: true, metal: active.metal, boxId: "ov-focal-chart" }) +

      '<div class="ov-spot-foot">' +
      "<span>100% synthetic example · TRY per gram</span>" +
      '<button type="button" class="btn btn-sm" id="btnOvOpenDecomp">Open Full Calculator →</button>' +
      "</div></div>" +
      "</div>" +

      '<div class="ov-wf-section">' +
      '<div class="ov-wf-heading">Research Workflows</div>' +
      '<div class="ov-workflow-grid" id="ov-workflow-strip">' +
      '<div class="ov-wf-card"><div><h3>Gold &amp; Silver Pricing</h3><p>Compare international spot benchmarks, local retail quotes, and synthetic bank pricing side by side.</p></div><div class="ov-wf-foot"><button type="button" class="btn btn-sm" data-jump="structure">Open Pricing</button></div></div>' +
      '<div class="ov-wf-card"><div><h3>Holdings &amp; Transactions</h3><p>Explore synthetic gold and silver lots, weighted-average cost, and auditable transaction records.</p></div><div class="ov-wf-foot"><button type="button" class="btn btn-sm" data-jump="ledger">Open Holdings</button></div></div>' +
      '<div class="ov-wf-card"><div><h3>Buying &amp; Selling Costs</h3><p>Compare synthetic bid-ask spreads, measure immediate buy-to-sell costs, and test quote-age safeguards.</p></div><div class="ov-wf-foot"><button type="button" class="btn btn-sm" data-jump="spread">Open Cost Lab</button></div></div>' +
      '<div class="ov-wf-card"><div><h3>Forecast Research</h3><p>Test simple baseline and trend models across synthetic sequences to see when forecasts genuinely beat a baseline.</p></div><div class="ov-wf-foot"><button type="button" class="btn btn-sm" data-jump="forecast">Open Forecasts</button></div></div>' +
      "</div></div>";

    const btnTour = document.getElementById("btnOvStartTour");
    if (btnTour) btnTour.addEventListener("click", startTutorial);
    const btnStr = document.getElementById("btnOvExploreStructure");
    if (btnStr) btnStr.addEventListener("click", () => switchTab("structure"));
    const btnDec = document.getElementById("btnOvOpenDecomp");
    if (btnDec) {
      btnDec.addEventListener("click", () => {
        STATE.decompPreset = active.id;
        STATE.p0 = active.p0; STATE.p1 = active.p1; STATE.e0 = active.e0; STATE.e1 = active.e1;
        switchTab("decomp");
      });
    }
    el.querySelectorAll("[data-ov-preset]").forEach((b) => {
      b.addEventListener("click", () => {
        STATE.overviewPreset = b.dataset.ovPreset;
        renderOverview();
      });
    });
    el.querySelectorAll("[data-jump]").forEach((b) => {
      b.addEventListener("click", () => switchTab(b.dataset.jump));
    });
  }

  // ---------- View 2: Market Structure (6 Tiers) ----------
  function renderStructure() {
    const el = document.getElementById("panel-structure");
    const bucket = DATA.six_price_tiers[STATE.tierMetal];
    const isGold = STATE.tierMetal === "gold";
    el.innerHTML =
      '<div class="section-head"><div><h2>Gold &amp; Silver Market Structure (6 Price Tiers)</h2>' +
      "<p>Separates international benchmarks and theoretical TRY/gram parity from local retail premiums, bank spreads, and net execution costs.</p></div></div>" +

      '<div class="controls-bar" id="structure-controls">' +
      '<button type="button" class="btn" id="tier-gold" aria-pressed="' + (isGold ? "true" : "false") + '">Gold (Au) — Synthetic Example</button>' +
      '<button type="button" class="btn" id="tier-silver" aria-pressed="' + (!isGold ? "true" : "false") + '">Silver (Ag) — Synthetic Example</button>' +
      "</div>" +

      '<div class="card" id="structure-tiers-card"><h3>' + esc(bucket.unit_label) + ' <span class="badge ' + (isGold ? "b-gold" : "b-silver") + '">SYNTHETIC</span></h3>' +
      '<div class="tier-list">' +
      bucket.tiers.map((t) => (
        '<div class="tier-card">' +
        '<div class="tier-top"><span class="badge ' + (t.tier === 3 ? "b-amber" : (t.tier >= 5 ? "b-green" : "b-silver")) + '">TIER ' + t.tier + '</span><span class="mono muted">' + esc(t.unit) + "</span></div>" +
        '<div style="font-weight:700;margin-bottom:4px">' + esc(t.name) + "</div>" +
        '<div class="tier-val ' + (isGold ? "gold-txt" : "silver-txt") + '">' + esc(t.value) + "</div>" +
        '<p class="muted" style="margin:6px 0 0;font-size:12px">' + esc(t.note) + "</p>" +
        "</div>"
      )).join("") +
      "</div></div>" +

      '<div class="card" id="structure-bridge-card"><h3>Price-Layer Divergence (TRY / Gram — Synthetic)</h3>' +
      renderTierBridgeSvg(STATE.tierMetal) +
      "</div>";

    document.getElementById("tier-gold").addEventListener("click", () => { STATE.tierMetal = "gold"; renderStructure(); });
    document.getElementById("tier-silver").addEventListener("click", () => { STATE.tierMetal = "silver"; renderStructure(); });
  }

  // ---------- View 3: Currency Decomposition Calculator ----------
  function renderDecomp() {
    const el = document.getElementById("panel-decomp");
    const res = computeExactDecomposition(STATE.p0, STATE.p1, STATE.e0, STATE.e1);
    const presets = DATA.decomposition_presets;
    const activePreset = presets.find((x) => x.id === STATE.decompPreset);
    const metal = activePreset ? activePreset.metal : "gold";

    el.innerHTML =
      '<div class="section-head"><div><h2>Currency &amp; Metal Driver Decomposition</h2>' +
      "<p>Splits theoretical TRY/gram moves into USD metal price, USD/TRY exchange rate, and cross-interaction using exact <code>31.1034768 g/oz</code> arithmetic.</p></div></div>" +

      '<div class="card" id="decomp-main-card"><h3>Synthetic Scenarios &amp; Custom Inputs</h3>' +
      '<div class="controls-bar" id="decomp-presets">' +
      presets.map((pr) => '<button type="button" class="btn btn-sm" data-preset="' + esc(pr.id) + '" aria-pressed="' + (STATE.decompPreset === pr.id ? "true" : "false") + '">' + esc(pr.label) + "</button>").join("") +
      "</div>" +
      '<div class="controls-bar">' +
      '<div class="control-group"><label for="inp-p0">Start Metal (USD/oz)</label><input id="inp-p0" type="number" step="0.01" value="' + esc(STATE.p0) + '" /></div>' +
      '<div class="control-group"><label for="inp-p1">End Metal (USD/oz)</label><input id="inp-p1" type="number" step="0.01" value="' + esc(STATE.p1) + '" /></div>' +
      '<div class="control-group"><label for="inp-e0">Start USD/TRY</label><input id="inp-e0" type="number" step="0.0001" value="' + esc(STATE.e0) + '" /></div>' +
      '<div class="control-group"><label for="inp-e1">End USD/TRY</label><input id="inp-e1" type="number" step="0.0001" value="' + esc(STATE.e1) + '" /></div>' +
      "</div>" +
      (!res.valid
        ? '<div class="notice notice-red"><strong>Input Validation Error:</strong> ' + esc(res.error) + "</div>"
        : '<div class="kpi-grid" id="decomp-kpis">' +
          '<div class="kpi-card"><div class="kpi-label">Theoretical Start → End</div><div class="kpi-value" style="font-size:15.5px">' + esc(res.g0Str) + " → " + esc(res.g1Str) + '</div><div class="kpi-detail">Total Δ: ' + esc(res.totalStr) + " TRY/g (" + esc(res.rTotStr) + "%)</div></div>" +
          '<div class="kpi-card"><div class="kpi-label">USD Metal Contribution</div><div class="kpi-value ' + (metal === "silver" ? "silver-txt" : "gold-txt") + '">' + esc(res.usdStr) + '</div><div class="kpi-detail">TRY/g · Metal return: ' + esc(res.rUsdStr) + "%</div></div>" +
          '<div class="kpi-card"><div class="kpi-label">USD/TRY FX Contribution</div><div class="kpi-value">' + esc(res.fxStr) + '</div><div class="kpi-detail">TRY/g · FX return: ' + esc(res.rFxStr) + "%</div></div>" +
          '<div class="kpi-card"><div class="kpi-label">Cross-Interaction Term</div><div class="kpi-value">' + esc(res.interStr) + '</div><div class="kpi-detail">((P1 − P0) × (E1 − E0)) ÷ 31.1034768</div></div>' +
          "</div>" +
          renderDecompositionWaterfallSvg(res, { metal: metal, boxId: "decomp-chart-box" })) +
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

  // ---------- View 4: Portfolio Ledger ----------
  function renderLedger() {
    const el = document.getElementById("panel-ledger");
    const summary = computeLedgerSummary(STATE.voidApplied);
    const entries = DATA.synthetic_ledger.financial_entries;
    const physicals = DATA.synthetic_ledger.physical_holdings;

    el.innerHTML =
      '<div class="section-head"><div><h2>Fixed-Point Portfolio Ledger</h2>' +
      "<p>Exact integer accounting (<code>ug</code> = 10⁻⁶ g, <code>e4</code> = 10⁻⁴ TRY), append-only void reversals, and strict physical-lot isolation.</p></div></div>" +

      '<div class="notice notice-silver"><strong>Synthetic Ledger Example:</strong> All quantities, costs, and timestamps below are fabricated educational entries. Zero real balances, receipts, or account identifiers exist in this preview.</div>' +

      '<div class="controls-bar" id="ledger-controls">' +
      '<button type="button" class="btn" id="toggle-void" aria-pressed="' + (STATE.voidApplied ? "true" : "false") + '">' +
      (STATE.voidApplied ? "Alternative-B Void Active (TX-003 Typo Reversed)" : "Alternative-B Void Removed (TX-003 50g Typo Active)") +
      "</button>" +
      "</div>" +

      '<div class="kpi-grid" id="ledger-kpis">' +
      '<div class="kpi-card"><div class="kpi-label">Synthetic Gold (995‰)</div><div class="kpi-value gold-txt">' + esc(fmtUgToGrams(summary.gold.balance_ug)) + '</div><div class="kpi-detail">Exact integer: ' + esc(summary.gold.balance_ug.toLocaleString("en-US")) + " ug</div></div>" +
      '<div class="kpi-card"><div class="kpi-label">Gold Weighted-Avg Cost</div><div class="kpi-value">' + esc(fmtE4ToTry(summary.gold.avg_cost_e4_per_g)) + '/g</div><div class="kpi-detail">Total Cost: ' + esc(fmtE4ToTry(summary.gold.total_cost_e4)) + "</div></div>" +
      '<div class="kpi-card"><div class="kpi-label">Synthetic Silver (999‰)</div><div class="kpi-value silver-txt">' + esc(fmtUgToGrams(summary.silver.balance_ug)) + '</div><div class="kpi-detail">Exact integer: ' + esc(summary.silver.balance_ug.toLocaleString("en-US")) + " ug</div></div>" +
      '<div class="kpi-card"><div class="kpi-label">Silver Weighted-Avg Cost</div><div class="kpi-value">' + esc(fmtE4ToTry(summary.silver.avg_cost_e4_per_g)) + '/g</div><div class="kpi-detail">Total Cost: ' + esc(fmtE4ToTry(summary.silver.total_cost_e4)) + "</div></div>" +
      "</div>" +

      '<div class="card" id="ledger-journal-card"><h3>Append-Only Financial Transaction Journal (UPDATE / DELETE Blocked)</h3>' +
      '<p class="card-sub">Toggle the void control above to see how a decimal typo (<code>TX-003</code>) is reversed strictly by appending <code>TX-003-VOID</code> without editing historical rows.</p>' +
      '<div class="table-wrap" id="ledger-table-wrap"><table><thead><tr><th>Entry ID</th><th>Timestamp (UTC)</th><th>Instrument</th><th>Side</th><th class="num">Mass (g)</th><th class="num">Unit Price</th><th class="num">Net Total (e4 TRY)</th><th>State</th></tr></thead><tbody>' +
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

      '<div class="card" id="ledger-physical-card"><h3>Isolated Physical Holdings Ledger (Bank Quotes Never Applied)</h3>' +
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

  // ---------- View 5: Spread & Quote Freshness ----------
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
      '<div class="section-head"><div><h2>Bank Spread &amp; 900s Quote Freshness Gate</h2>' +
      "<p>Measures exact bid-ask spread drag and enforces fail-closed withholding when quotes exceed the 900-second (15-minute) eligibility window or fail price sanity checks.</p></div></div>" +

      '<div class="card" id="spread-main-card"><h3>Interactive Synthetic Quote Controls</h3>' +
      '<div class="controls-bar" id="spread-controls">' +
      '<button type="button" class="btn btn-sm" id="sp-gold" aria-pressed="' + (STATE.spreadMetal === "gold" ? "true" : "false") + '">Synthetic Gold Preset</button>' +
      '<button type="button" class="btn btn-sm" id="sp-silver" aria-pressed="' + (STATE.spreadMetal === "silver" ? "true" : "false") + '">Synthetic Silver Preset</button>' +
      '<button type="button" class="btn btn-sm" id="sp-stale">Test Stale (901s)</button>' +
      '<button type="button" class="btn btn-sm" id="sp-boundary">Test Boundary (900s)</button>' +
      '<button type="button" class="btn btn-sm" id="sp-malformed">Test Malformed (Ask &lt; Bid)</button>' +
      "</div>" +
      '<div class="controls-bar">' +
      '<div class="control-group"><label for="inp-bid">Generic Bank Bid (TRY/g)</label><input id="inp-bid" type="number" step="0.01" value="' + esc(STATE.bidStr) + '" /></div>' +
      '<div class="control-group"><label for="inp-ask">Generic Bank Ask (TRY/g)</label><input id="inp-ask" type="number" step="0.01" value="' + esc(STATE.askStr) + '" /></div>' +
      '<div class="control-group" style="flex:1;min-width:210px"><label for="inp-age">Quote Age: <strong class="mono">' + STATE.quoteAgeSec + 's</strong> (Cutoff: 900s)</label><input id="inp-age" type="range" min="0" max="1800" step="1" value="' + STATE.quoteAgeSec + '" /></div>' +
      "</div>" +

      (!sp.valid
        ? '<div class="notice notice-red" id="spread-status-box"><strong>' + esc(sp.code) + ":</strong> " + esc(sp.error) + " All downstream comparisons are strictly <strong>WITHHELD</strong>.</div>"
        : (isFresh
            ? '<div class="notice notice-green" id="spread-status-box"><strong>ELIGIBLE (' + STATE.quoteAgeSec + 's &lt;= 900s):</strong> Generic bank quote passes freshness and <code>ask &gt;= bid</code> checks. Figures below are descriptive gross comparisons (before tax) — never BUY/SELL instructions.</div>'
            : '<div class="notice notice-red" id="spread-status-box"><strong>STALE — WITHHELD (' + STATE.quoteAgeSec + 's &gt; 900s):</strong> Quote exceeds the 900-second eligibility cutoff. Gross valuation and decision comparisons are fail-closed <strong>WITHHELD</strong>.</div>')) +

      '<div class="kpi-grid" id="spread-kpi-grid" style="margin-bottom:0">' +
      '<div class="kpi-card"><div class="kpi-label">Eligibility Status</div><div class="kpi-value">' + (isEligible ? '<span class="pos">ELIGIBLE</span>' : '<span class="neg">WITHHELD</span>') + '</div><div class="kpi-detail">Rule: age &lt;= 900s &amp; ask &gt;= bid</div></div>' +
      '<div class="kpi-card"><div class="kpi-label">Mid-Relative Spread</div><div class="kpi-value">' + esc(sp.valid ? sp.midSpreadStr : "WITHHELD") + '</div><div class="kpi-detail">2 × (ask − bid) ÷ (ask + bid)</div></div>' +
      '<div class="kpi-card"><div class="kpi-label">Immediate Spread Drag</div><div class="kpi-value">' + esc(sp.valid ? sp.dragStr : "WITHHELD") + '</div><div class="kpi-detail">(ask − bid) ÷ ask (instant buy→sell drag)</div></div>' +
      '<div class="kpi-card"><div class="kpi-label">Synthetic Gross Bid (' + esc(sampleGrams.split(".")[0]) + 'g)</div><div class="kpi-value" style="font-size:16.5px">' + esc(grossBidStr) + '</div><div class="kpi-detail">Spread friction: ' + esc(roundTripCostStr) + " (before tax)</div></div>" +
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

  // ---------- View 6: Statistical Forecast Evaluation ----------
  function renderForecast() {
    const el = document.getElementById("panel-forecast");
    const list = DATA.forecast_evaluation.synthetic_series;
    const series = list[STATE.forecastSeriesIdx] || list[0];
    const hObj = series.horizons[STATE.forecastHorizon] || series.horizons["6"];
    const models = ["naive", "drift", "damped_trend"].map((k) => hObj.models[k]);

    el.innerHTML =
      '<div class="section-head"><div><h2>Statistical Forecast Evaluation</h2>' +
      "<p>Walk-forward chronological validation comparing <code>naive</code>, <code>drift</code>, and <code>damped_trend</code> under a 5% development-MAE promotion gate and non-probabilistic sensitivity bands.</p></div></div>" +

      '<div class="notice notice-gold" id="forecast-notice"><strong>Methodology Demonstration Only:</strong> Charts and tables below run GoSil\'s classical formulas over <strong>100% synthetic 36-month sequences</strong>. They do not predict real gold or silver prices and contain zero external market observations.</div>' +

      '<div class="card" id="forecast-main-card">' +
      '<div class="controls-bar" id="forecast-controls">' +
      list.map((s, i) => '<button type="button" class="btn btn-sm" data-fseries="' + i + '" aria-pressed="' + (STATE.forecastSeriesIdx === i ? "true" : "false") + '">' + esc(s.name) + "</button>").join("") +
      '<button type="button" class="btn btn-sm" data-fhor="3" aria-pressed="' + (STATE.forecastHorizon === "3" ? "true" : "false") + '">Horizon: 3 Months</button>' +
      '<button type="button" class="btn btn-sm" data-fhor="6" aria-pressed="' + (STATE.forecastHorizon === "6" ? "true" : "false") + '">Horizon: 6 Months</button>' +
      "</div>" +
      '<p class="muted" id="forecast-summary-line" style="margin:0 0 12px">' + esc(series.description) + ' · Selected model: <strong class="gold-txt mono">' + esc(hObj.selected_model) + "</strong></p>" +
      renderForecastSvg(series, hObj) +
      '<div class="table-wrap" id="forecast-table-wrap" style="margin-top:14px"><table><thead><tr><th>Model</th><th class="num">Dev MAE</th><th class="num">Test MAE</th><th class="num">Final Point</th><th class="num">Sensitivity Band (p = null)</th><th>Promotion Gate (≥ 5% vs Naive)</th></tr></thead><tbody>' +
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
      '<p class="card-sub">Reported from GoSil\'s frozen retrospective evaluations — zero external dataset values are retained or redistributed here.</p>' +
      '<ul class="muted" style="margin:0;padding-left:18px">' +
      DATA.forecast_evaluation.historical_qualitative_findings.map((f) => '<li style="margin-bottom:6px">' + esc(f) + "</li>").join("") +
      "</ul></div>";

    el.querySelectorAll("[data-fseries]").forEach((b) => b.addEventListener("click", () => { STATE.forecastSeriesIdx = Number(b.dataset.fseries); renderForecast(); }));
    el.querySelectorAll("[data-fhor]").forEach((b) => b.addEventListener("click", () => { STATE.forecastHorizon = b.dataset.fhor; renderForecast(); }));
  }

  // ---------- View 7: Architecture & Evidence (Level 3 Technical Reference) ----------
  function renderArch() {
    const el = document.getElementById("panel-arch");
    el.innerHTML =
      '<div class="section-head"><div><h2>System Architecture &amp; Engineering Provenance</h2>' +
      "<p>Separation between the frozen local-first private Python/SQLite engine and this 100% synthetic browser preview.</p></div></div>" +

      '<div class="card"><h3>Local-First Vault &amp; Preview Boundary</h3>' +
      '<div class="chart-box">' +
      '<svg viewBox="0 0 900 246" role="img" aria-label="GoSil local-first architecture showing Private SQLite Vault outside Git, Fixed-Point Core Engine, and 100% Synthetic Public Preview">' +
      '<defs><marker id="garr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0,1 L10,5 L0,9 z" fill="#D4AF63" /></marker></defs>' +
      '<rect x="16" y="22" width="250" height="200" rx="8" fill="#181A1E" stroke="#C96A6A" stroke-width="1.5" stroke-dasharray="5 3" />' +
      '<text x="30" y="48" fill="#E8A2A2" font-size="13" font-weight="700">Private Local Vault (Outside Git)</text>' +
      '<text x="30" y="70" fill="#A4ABB6" font-size="11.5">• Mode 0700 dir / 0600 SQLite DB</text>' +
      '<text x="30" y="90" fill="#A4ABB6" font-size="11.5">• STRICT Append-Only Schema v1</text>' +
      '<text x="30" y="110" fill="#A4ABB6" font-size="11.5">• Triggers block UPDATE / DELETE</text>' +
      '<text x="30" y="130" fill="#A4ABB6" font-size="11.5">• SHA-256 Verified Online Backups</text>' +
      '<text x="30" y="162" fill="#E28686" font-size="11" font-weight="700">HARD LOCKED: First-Read = False</text>' +
      '<text x="30" y="182" fill="#7B8391" font-size="10.5">Never accessed by public preview</text>' +

      '<rect x="322" y="22" width="260" height="200" rx="8" fill="#181A1E" stroke="#D4AF63" stroke-width="1.6" />' +
      '<text x="336" y="48" fill="#D4AF63" font-size="13" font-weight="700">Frozen Private Engine (Python 3.11+)</text>' +
      '<text x="336" y="70" fill="#F1EDE5" font-size="11.5">Zero Runtime Third-Party Dependencies</text>' +
      '<text x="336" y="92" fill="#A4ABB6" font-size="11.5">• Exact e4 TRY / ug Mass / Fraction</text>' +
      '<text x="336" y="112" fill="#A4ABB6" font-size="11.5">• 6-Tier Price &amp; 900s Freshness Gate</text>' +
      '<text x="336" y="132" fill="#A4ABB6" font-size="11.5">• Purged Walk-Forward Forecast Core</text>' +
      '<text x="336" y="152" fill="#A4ABB6" font-size="11.5">• 127.0.0.1 Loopback + CSRF + No-Store</text>' +
      '<text x="336" y="186" fill="#6FC496" font-size="11">Verified: 739 pytest + 205 UI3 PASS</text>' +

      '<rect x="638" y="22" width="246" height="200" rx="8" fill="#141619" stroke="#B9C6D6" stroke-width="1.6" />' +
      '<text x="652" y="48" fill="#B9C6D6" font-size="13" font-weight="700">Static Browser Preview (This Site)</text>' +
      '<text x="652" y="70" fill="#F1EDE5" font-size="11.5">100% Synthetic · Zero Backend</text>' +
      '<text x="652" y="92" fill="#A4ABB6" font-size="11.5">• Exact 31.1034768 Decomposition</text>' +
      '<text x="652" y="112" fill="#A4ABB6" font-size="11.5">• Synthetic Ledger &amp; Void Toggle</text>' +
      '<text x="652" y="132" fill="#A4ABB6" font-size="11.5">• Spread &amp; 900s Freshness Lab</text>' +
      '<text x="652" y="152" fill="#A4ABB6" font-size="11.5">• Zero External Feeds · Zero Real Data</text>' +
      '<text x="652" y="186" fill="#D4AF63" font-size="11">Standalone Offline Tests Verified</text>' +

      '<line x1="266" y1="122" x2="320" y2="122" stroke="#C96A6A" stroke-width="1.8" stroke-dasharray="4 3" />' +
      '<line x1="582" y1="122" x2="636" y2="122" stroke="#D4AF63" stroke-width="1.8" marker-end="url(#garr)" />' +
      "</svg></div></div>" +

      '<div class="grid-2">' +
      '<div class="card"><h3>Historical &amp; Preview Verification Record</h3>' +
      '<div class="table-wrap"><table><thead><tr><th>Suite</th><th>Scope</th><th>Status</th></tr></thead><tbody>' +
      '<tr><td>Private Python + Hypothesis</td><td>Fixed-point math, SQLite triggers, security, CORE1–D23</td><td><span class="badge b-green">739 / 739 PASS</span></td></tr>' +
      '<tr><td>Private UI3 Contract Suite</td><td>Offline prototype rendering &amp; contract security</td><td><span class="badge b-green">205 / 205 PASS</span></td></tr>' +
      '<tr><td>Public Standalone Suite</td><td>Synthetic math identities, voids, 900s gate, privacy</td><td><span class="badge b-green">VERIFIED</span></td></tr>' +
      '<tr><td>Bank APIs / LLM Prediction</td><td>Live bank quotes, trade execution, LLM price prediction</td><td><span class="badge b-red">NOT IMPLEMENTED</span></td></tr>' +
      "</tbody></table></div></div>" +

      '<div class="card"><h3>Known Limitations &amp; Frozen Scope</h3>' +
      '<ul class="muted" style="margin:0;padding-left:18px;font-size:13px">' +
      '<li style="margin-bottom:6px"><strong>Frozen Archive (D23, 2026-11-16):</strong> Active feature development is discontinued; deferred real-owner gates remain permanently closed.</li>' +
      '<li style="margin-bottom:6px"><strong>No LLM Prediction Engine:</strong> Implements exact fixed-point accounting and classical statistical baselines only; no reliable future-price edge is claimed.</li>' +
      '<li style="margin-bottom:6px"><strong>Zero External Market Data:</strong> External statistical series carry non-retention rules; every numerical example here is 100% synthetic.</li>' +
      '<li><strong>Non-Advisory:</strong> Gross comparisons omit after-tax liquidation calculations and never constitute financial advice.</li>' +
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

  // ---------- Interactive Watch Tutorial (Sticky Dock, Adaptive Sequential Guidance, Exact Restoration) ----------
  const TUTORIAL_STAGES = [
    {
      id: "overview",
      title: "Welcome to GoSil",
      phases: [
        {
          id: "product-intro",
          label: "Overview",
          narration: "GoSil helps you explore gold and silver prices, understand the effect of exchange rates, compare buying and selling costs, and evaluate forecasting methods.",
          targetSelector: "#ov-focal-stage",
          desktopSelector: "#ov-hero-band",
          durationMs: 4000,
          apply: function () {
            STATE.overviewPreset = "gold_combined";
            switchTab("overview");
          },
        },
        {
          id: "scenario-switch",
          label: "FX Offset",
          narration: "Switch scenarios right on the Overview: here, an international gold drop (-194.45 TRY/g) is outweighed by a higher exchange rate (+222.23 TRY/g) for a +12.22 TRY/g total rise.",
          targetSelector: "#ov-focal-stage",
          desktopSelector: "#ov-hero-band",
          durationMs: 4000,
          apply: function () {
            STATE.overviewPreset = "gold_offset";
            switchTab("overview");
          },
        },
        {
          id: "overview-chart",
          label: "Breakdown",
          narration: "The breakdown chart updates immediately to show the metal price effect, exchange-rate effect, combined effect, and total TRY/g price change.",
          targetSelector: "#ov-focal-chart",
          checkSelector: "#ov-focal-chart svg",
          onlyIfClipped: true,
          durationMs: 3400,
          apply: function () {
            if (STATE.tab !== "overview" || STATE.overviewPreset !== "gold_offset") {
              STATE.overviewPreset = "gold_offset";
              switchTab("overview");
            }
          },
        },
        {
          id: "workflow-tour",
          label: "Workflows",
          narration: "Jump into any workflow from the Overview: gold and silver pricing, holdings and transaction records, buying and selling costs, or forecast research.",
          targetSelector: "#ov-workflow-strip",
          checkSelector: "#ov-workflow-strip",
          onlyIfClipped: true,
          durationMs: 3200,
          apply: function () {
            if (STATE.tab !== "overview") switchTab("overview");
          },
        },
      ],
    },
    {
      id: "market-structure",
      title: "Gold & Silver Pricing Layers",
      phases: [
        {
          id: "tier-gold",
          label: "Gold Pricing",
          narration: "GoSil keeps six price layers separate—from international spot and theoretical TRY/g parity to local retail quotes, bank spreads, and net purchase cost.",
          targetSelector: "#structure-tiers-card .tier-card:first-child",
          desktopSelector: "#structure-tiers-card",
          durationMs: 3800,
          apply: function () {
            STATE.tierMetal = "gold";
            switchTab("structure");
          },
        },
        {
          id: "tier-bridge",
          label: "Price Bridge",
          narration: "Comparing Tiers 3 through 6 side by side shows why theoretical gram parity never equals an executable bank bid or realized transaction cost.",
          targetSelector: "#structure-bridge-box",
          checkSelector: "#structure-bridge-box svg",
          onlyIfClipped: true,
          durationMs: 3400,
          apply: function () {
            if (STATE.tab !== "structure") switchTab("structure");
          },
        },
        {
          id: "tier-silver",
          label: "Silver Costs",
          narration: "Switching to synthetic Silver (Ag) highlights wider bank bid-ask spreads (7.88% immediate buy-to-sell cost) relative to theoretical gram parity.",
          targetSelector: "#structure-bridge-box",
          desktopSelector: "#structure-bridge-card",
          durationMs: 3600,
          apply: function () {
            STATE.tierMetal = "silver";
            switchTab("structure");
          },
        },
      ],
    },
    {
      id: "currency-drivers",
      title: "Price Driver Breakdown",
      phases: [
        {
          id: "decomp-calc",
          label: "FX Offset",
          narration: "Using the exact 31.1034768 g/oz conversion, the calculator ensures Metal Price Effect + Exchange Rate Effect + Combined Effect equals the exact total TRY/g change.",
          targetSelector: "#decomp-kpis",
          desktopSelector: "#decomp-main-card",
          durationMs: 3800,
          apply: function () {
            const pr = DATA.decomposition_presets.find((x) => x.id === "gold_offset") || DATA.decomposition_presets[0];
            STATE.decompPreset = pr.id;
            STATE.p0 = pr.p0; STATE.p1 = pr.p1; STATE.e0 = pr.e0; STATE.e1 = pr.e1;
            switchTab("decomp");
          },
        },
        {
          id: "decomp-chart",
          label: "Breakdown",
          narration: "The breakdown chart shows how the negative metal move (-194.45), positive exchange-rate move (+222.23), and combined effect (-15.56) sum to +12.22 TRY/g.",
          targetSelector: "#decomp-chart-box",
          checkSelector: "#decomp-chart-box svg",
          onlyIfClipped: true,
          durationMs: 3400,
          apply: function () {
            if (STATE.tab !== "decomp") switchTab("decomp");
          },
        },
      ],
    },
    {
      id: "portfolio-ledger",
      title: "Holdings & Transaction Records",
      phases: [
        {
          id: "ledger-void-on",
          label: "Void Active",
          narration: "With the append-only void active, synthetic typo lot TX-003 (50 g) is reversed by TX-003-VOID without editing history—leaving exactly 12.000000 g Gold.",
          targetSelector: "#ledger-kpis",
          desktopSelector: "#ledger-controls",
          durationMs: 3800,
          apply: function () {
            STATE.voidApplied = true;
            switchTab("ledger");
          },
        },
        {
          id: "ledger-void-off",
          label: "Typo Active",
          narration: "Removing the void restores TX-003 (50 g), moving synthetic Gold to 62.000000 g and showing how append-only reversals preserve a full audit trail.",
          targetSelector: "#ledger-kpis",
          desktopSelector: "#ledger-controls",
          durationMs: 3600,
          apply: function () {
            STATE.voidApplied = false;
            switchTab("ledger");
          },
        },
      ],
    },
    {
      id: "spread-freshness",
      title: "Buying Costs & Quote Freshness",
      phases: [
        {
          id: "spread-eligible",
          label: "Fresh (420s)",
          narration: "At 420 seconds old (within the 900s freshness limit), the synthetic Gold quote is eligible and reports both mid-relative spread and immediate buy-to-sell cost.",
          targetSelector: "#spread-status-box",
          desktopSelector: "#spread-main-card",
          durationMs: 3600,
          apply: function () {
            STATE.spreadMetal = "gold";
            STATE.bidStr = DATA.quote_defaults.gold.bid_try_g;
            STATE.askStr = DATA.quote_defaults.gold.ask_try_g;
            STATE.quoteAgeSec = 420;
            switchTab("spread");
          },
        },
        {
          id: "spread-stale",
          label: "Stale (901s)",
          narration: "Moving quote age to 901 seconds crosses the 900s freshness safeguard—gross valuation and downstream comparisons immediately fail closed as WITHHELD.",
          targetSelector: "#spread-status-box",
          desktopSelector: "#spread-main-card",
          durationMs: 3800,
          apply: function () {
            STATE.quoteAgeSec = 901;
            switchTab("spread");
          },
        },
      ],
    },
    {
      id: "forecast-eval",
      title: "Statistical Forecast Research",
      phases: [
        {
          id: "forecast-trend",
          label: "Trend · Drift",
          narration: "On a steady synthetic 36-month sequence, the drift model beats the naive baseline by over 5% on development MAE and shows empirical error sensitivity bounds (p = null).",
          targetSelector: "#forecast-controls",
          desktopSelector: "#forecast-main-card",
          durationMs: 3800,
          apply: function () {
            STATE.forecastSeriesIdx = 0;
            STATE.forecastHorizon = "6";
            switchTab("forecast");
          },
        },
        {
          id: "forecast-trend-chart",
          label: "Trend Chart",
          narration: "The 6-month walk-forward chart compares the promoted drift projection against the dashed naive baseline and historical-error sensitivity band.",
          targetSelector: "#forecast-chart-box",
          checkSelector: "#forecast-chart-box svg",
          onlyIfClipped: true,
          durationMs: 3400,
          apply: function () {
            if (STATE.tab !== "forecast" || STATE.forecastSeriesIdx !== 0) {
              STATE.forecastSeriesIdx = 0;
              STATE.forecastHorizon = "6";
              switchTab("forecast");
            }
          },
        },
        {
          id: "forecast-choppy",
          label: "Choppy · Naive",
          narration: "On a choppy synthetic sequence, both trend challengers fail the 5% improvement gate and are withheld—keeping the simple naive baseline active.",
          targetSelector: "#forecast-controls",
          desktopSelector: "#forecast-main-card",
          durationMs: 3800,
          apply: function () {
            STATE.forecastSeriesIdx = 1;
            STATE.forecastHorizon = "6";
            switchTab("forecast");
          },
        },
        {
          id: "forecast-choppy-chart",
          label: "Choppy Chart",
          narration: "On the choppy sequence, the naive baseline stays selected with wide empirical error bounds rather than manufacturing false trend confidence.",
          targetSelector: "#forecast-chart-box",
          checkSelector: "#forecast-chart-box svg",
          onlyIfClipped: true,
          durationMs: 3600,
          apply: function () {
            if (STATE.tab !== "forecast" || STATE.forecastSeriesIdx !== 1) {
              STATE.forecastSeriesIdx = 1;
              STATE.forecastHorizon = "6";
              switchTab("forecast");
            }
          },
        },
      ],
    },
  ];

  const TUT = {
    active: false,
    playing: false,
    completed: false,
    stageIndex: 0,
    phaseIndex: 0,
    activePhases: [],
    runToken: 0,
    timerId: null,
    resizeTimerId: null,
    userScrolledAway: false,
    programmaticScrollUntil: 0,
    savedManualState: null,
    savedScrollY: 0,
    highlightedEl: null,
  };

  function prefersReducedMotion() {
    return Boolean(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches);
  }

  function clearTutorialTimers() {
    if (TUT.timerId !== null) {
      clearTimeout(TUT.timerId);
      TUT.timerId = null;
    }
  }

  function clearHighlight() {
    if (TUT.highlightedEl) {
      TUT.highlightedEl.classList.remove("tut-target-highlight");
      TUT.highlightedEl = null;
    }
  }

  function getDockBottom() {
    const dock = document.getElementById("tutorialDock");
    if (!dock || dock.hidden) return 0;
    return Math.max(0, Math.round(dock.getBoundingClientRect().bottom));
  }

  function isElementFullyInClearViewport(selector) {
    if (!selector) return false;
    const el = document.querySelector(selector);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    const dockBot = getDockBottom();
    return r.height > 0 && r.top >= dockBot - 1 && r.bottom <= window.innerHeight + 1;
  }

  function resolveSelectorForPhase(phase) {
    if (!phase) return null;
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (phase.desktopSelector) {
      const el = document.querySelector(phase.desktopSelector);
      const dockBot = getDockBottom();
      if (el && el.getBoundingClientRect().height <= (h - dockBot - 12)) {
        return phase.desktopSelector;
      }
      if (w >= 980 && h >= 620) {
        return phase.desktopSelector;
      }
    }
    return phase.targetSelector;
  }

  function resolveActivePhasesForStage(stage) {
    const all = stage.phases || [];
    if (all.length <= 1) return all.slice();
    const out = [all[0]];
    for (let i = 1; i < all.length; i++) {
      const ph = all[i];
      if (!ph.onlyIfClipped) {
        out.push(ph);
      } else {
        const checkSel = ph.checkSelector || ph.targetSelector;
        if (!isElementFullyInClearViewport(checkSel)) {
          out.push(ph);
        }
      }
    }
    return out;
  }

  function currentPhase() {
    if (TUT.activePhases && TUT.activePhases[TUT.phaseIndex]) {
      return TUT.activePhases[TUT.phaseIndex];
    }
    const st = TUTORIAL_STAGES[TUT.stageIndex];
    return (st && st.phases && st.phases[0]) || null;
  }

  function syncTutorialEntryButtons() {
    const btnHeader = document.getElementById("btnWatchTutorial");
    if (btnHeader) btnHeader.hidden = TUT.active;
    const btnOverview = document.getElementById("btnOvStartTour");
    if (btnOverview) btnOverview.hidden = TUT.active;
  }

  function updateTutorialChrome() {
    const dock = document.getElementById("tutorialDock");
    const badge = document.getElementById("tutStepBadge");
    const title = document.getElementById("tutStageTitle");
    const phasePills = document.getElementById("tutPhasePills");
    const narration = document.getElementById("tutNarration");
    const scrollNote = document.getElementById("tutScrollNote");
    const fill = document.getElementById("tutProgressFill");
    const btnPrev = document.getElementById("btnTutPrev");
    const btnPlay = document.getElementById("btnTutPlayPause");
    const btnNext = document.getElementById("btnTutNext");
    const btnRestart = document.getElementById("btnTutRestart");

    syncTutorialEntryButtons();
    if (!dock) return;
    dock.hidden = !TUT.active;
    if (!TUT.active) return;

    const st = TUTORIAL_STAGES[TUT.stageIndex];
    const ph = currentPhase();
    badge.textContent = "Step " + (TUT.stageIndex + 1) + " of " + TUTORIAL_STAGES.length;
    title.textContent = st.title;
    narration.textContent = ph ? ph.narration : "";
    if (scrollNote) scrollNote.hidden = !TUT.userScrolledAway;

    if (phasePills) {
      if (TUT.activePhases.length > 1) {
        phasePills.hidden = false;
        phasePills.innerHTML = TUT.activePhases.map((p, idx) =>
          '<button type="button" class="tut-phase-btn" data-tut-phase="' + idx + '"' +
          (idx === TUT.phaseIndex ? ' aria-current="step"' : "") + ">" +
          esc(p.label || ("View " + (idx + 1))) + "</button>"
        ).join("");
        phasePills.querySelectorAll("[data-tut-phase]").forEach((btn) => {
          btn.addEventListener("click", () => goToPhase(Number(btn.dataset.tutPhase), true));
        });
      } else {
        phasePills.hidden = true;
        phasePills.innerHTML = "";
      }
    }

    const phaseFrac = TUT.activePhases.length > 0 ? (TUT.phaseIndex + 1) / TUT.activePhases.length : 1;
    const totalPct = ((TUT.stageIndex + phaseFrac) / TUTORIAL_STAGES.length) * 100;
    if (fill) fill.style.width = Math.min(100, totalPct).toFixed(1) + "%";

    btnPrev.disabled = TUT.stageIndex <= 0;
    btnNext.disabled = TUT.stageIndex >= TUTORIAL_STAGES.length - 1;
    if (TUT.completed) {
      btnPlay.textContent = "Replay";
      btnPlay.setAttribute("aria-label", "Replay walkthrough from start");
    } else if (TUT.playing) {
      btnPlay.textContent = "Pause";
      btnPlay.setAttribute("aria-label", "Pause walkthrough");
    } else {
      btnPlay.textContent = "Play";
      btnPlay.setAttribute("aria-label", "Resume walkthrough");
    }
    if (btnRestart) btnRestart.textContent = TUT.completed ? "Replay" : "Restart";
  }

  function scrollTargetIntoView(selector, force, instant) {
    if (!TUT.active || (!force && TUT.userScrolledAway)) return;
    const target = selector ? document.querySelector(selector) : null;
    clearHighlight();
    if (!target) return;
    target.classList.add("tut-target-highlight");
    TUT.highlightedEl = target;

    const dockBot = getDockBottom();
    const rect = target.getBoundingClientRect();
    const desiredTop = dockBot + 10;
    const availH = Math.max(80, window.innerHeight - desiredTop - 8);
    const fitsFully = rect.height <= availH;
    const alreadyGood = fitsFully
      ? (rect.top >= dockBot + 4 && rect.bottom <= window.innerHeight - 4)
      : (Math.abs(rect.top - desiredTop) <= 12);

    if (!alreadyGood) {
      const targetY = Math.max(0, Math.round(window.scrollY + rect.top - desiredTop));
      TUT.programmaticScrollUntil = Date.now() + 700;
      window.scrollTo({
        top: targetY,
        behavior: (instant || prefersReducedMotion()) ? "auto" : "smooth",
      });
    }
  }

  function scheduleAutoAdvance(token) {
    clearTutorialTimers();
    if (!TUT.active || !TUT.playing) return;
    const ph = currentPhase();
    const dwell = (ph && ph.durationMs) || 3600;
    TUT.timerId = setTimeout(() => {
      if (!TUT.active || TUT.runToken !== token || !TUT.playing) return;
      if (TUT.phaseIndex < TUT.activePhases.length - 1) {
        goToPhase(TUT.phaseIndex + 1, false);
      } else if (TUT.stageIndex < TUTORIAL_STAGES.length - 1) {
        goToStage(TUT.stageIndex + 1, false);
      } else {
        TUT.playing = false;
        TUT.completed = true;
        updateTutorialChrome();
      }
    }, dwell);
  }

  function goToPhase(phaseIdx, resetScrollOptOut, instantScroll) {
    if (!TUT.active) return;
    const phases = TUT.activePhases;
    if (!phases || !phases.length) return;
    const clamped = Math.max(0, Math.min(phases.length - 1, phaseIdx));
    TUT.runToken += 1;
    const token = TUT.runToken;
    clearTutorialTimers();
    TUT.phaseIndex = clamped;
    TUT.completed = false;
    if (resetScrollOptOut) TUT.userScrolledAway = false;

    const ph = phases[clamped];
    if (ph.apply) ph.apply();
    updateTutorialChrome();
    scrollTargetIntoView(resolveSelectorForPhase(ph), Boolean(resetScrollOptOut), Boolean(instantScroll));
    const st = TUTORIAL_STAGES[TUT.stageIndex];
    const fullIdx = st ? st.phases.indexOf(ph) : -1;
    const nextCandidate = (fullIdx >= 0 && fullIdx + 1 < st.phases.length) ? st.phases[fullIdx + 1] : null;
    if (nextCandidate && nextCandidate.onlyIfClipped && !TUT.activePhases.includes(nextCandidate)) {
      const checkSel = nextCandidate.checkSelector || nextCandidate.targetSelector;
      if (checkSel && !isElementFullyInClearViewport(checkSel)) {
        TUT.activePhases = TUT.activePhases.slice(0, clamped + 1).concat([nextCandidate], TUT.activePhases.slice(clamped + 1));
        updateTutorialChrome();
      }
    }
    if (TUT.playing) scheduleAutoAdvance(token);
  }

  function goToStage(index, resetScrollOptOut) {
    if (!TUT.active) return;
    const clamped = Math.max(0, Math.min(TUTORIAL_STAGES.length - 1, index));
    TUT.runToken += 1;
    const token = TUT.runToken;
    clearTutorialTimers();
    TUT.stageIndex = clamped;
    TUT.phaseIndex = 0;
    TUT.completed = false;
    if (resetScrollOptOut) TUT.userScrolledAway = false;

    const st = TUTORIAL_STAGES[clamped];
    const firstPhase = st.phases[0];
    // Pre-populate unconditional phase pills so dock height is accurate before checking clipping
    TUT.activePhases = st.phases.filter((p, idx) => idx === 0 || !p.onlyIfClipped);
    if (firstPhase && firstPhase.apply) firstPhase.apply();
    updateTutorialChrome();
    const firstSel = resolveSelectorForPhase(firstPhase);
    scrollTargetIntoView(firstSel, Boolean(resetScrollOptOut), true);
    TUT.activePhases = resolveActivePhasesForStage(st);
    updateTutorialChrome();
    scrollTargetIntoView(firstSel, Boolean(resetScrollOptOut), true);
    if (TUT.playing) scheduleAutoAdvance(token);
  }

  function startTutorial() {
    if (TUT.active) return;
    TUT.savedManualState = cloneState();
    TUT.savedScrollY = window.scrollY || 0;
    TUT.active = true;
    TUT.playing = true;
    TUT.completed = false;
    TUT.userScrolledAway = false;
    goToStage(0, true);
  }

  function exitTutorial() {
    if (!TUT.active) return;
    TUT.runToken += 1;
    clearTutorialTimers();
    clearHighlight();
    TUT.active = false;
    TUT.playing = false;
    TUT.completed = false;
    TUT.userScrolledAway = false;
    TUT.activePhases = [];
    TUT.phaseIndex = 0;
    updateTutorialChrome();

    const snap = TUT.savedManualState;
    const prevY = TUT.savedScrollY;
    TUT.savedManualState = null;
    if (snap) {
      restoreState(snap);
      switchTab(STATE.tab);
    }
    TUT.programmaticScrollUntil = Date.now() + 450;
    window.scrollTo({ top: prevY, behavior: "auto" });
    const launchBtn = document.getElementById("btnWatchTutorial");
    if (launchBtn) launchBtn.focus();
  }

  function setupTutorial() {
    const btnLaunch = document.getElementById("btnWatchTutorial");
    const btnPrev = document.getElementById("btnTutPrev");
    const btnPlay = document.getElementById("btnTutPlayPause");
    const btnNext = document.getElementById("btnTutNext");
    const btnRestart = document.getElementById("btnTutRestart");
    const btnExit = document.getElementById("btnTutExit");

    if (btnLaunch) btnLaunch.addEventListener("click", startTutorial);
    if (btnPrev) btnPrev.addEventListener("click", () => goToStage(TUT.stageIndex - 1, true));
    if (btnNext) btnNext.addEventListener("click", () => goToStage(TUT.stageIndex + 1, true));
    if (btnRestart) {
      btnRestart.addEventListener("click", () => {
        TUT.playing = true;
        TUT.completed = false;
        goToStage(0, true);
      });
    }
    if (btnPlay) {
      btnPlay.addEventListener("click", () => {
        if (!TUT.active) return;
        if (TUT.completed) {
          TUT.playing = true;
          TUT.completed = false;
          goToStage(0, true);
          return;
        }
        TUT.playing = !TUT.playing;
        TUT.runToken += 1;
        clearTutorialTimers();
        updateTutorialChrome();
        if (TUT.playing) scheduleAutoAdvance(TUT.runToken);
      });
    }
    if (btnExit) btnExit.addEventListener("click", exitTutorial);

    document.addEventListener("keydown", (ev) => {
      if (ev.key === "Escape" && TUT.active) {
        ev.preventDefault();
        exitTutorial();
      }
    });

    window.addEventListener("scroll", () => {
      if (!TUT.active) return;
      if (Date.now() < TUT.programmaticScrollUntil) return;
      if (!TUT.userScrolledAway) {
        TUT.userScrolledAway = true;
        updateTutorialChrome();
      }
    }, { passive: true });

    window.addEventListener("resize", () => {
      if (STATE.tab === "overview" || STATE.tab === "structure" || STATE.tab === "decomp" || STATE.tab === "forecast") {
        renderActiveTab();
      }
      if (!TUT.active) return;
      if (TUT.resizeTimerId !== null) clearTimeout(TUT.resizeTimerId);
      TUT.programmaticScrollUntil = Date.now() + 800;
      TUT.resizeTimerId = setTimeout(() => {
        TUT.resizeTimerId = null;
        if (!TUT.active) return;
        const st = TUTORIAL_STAGES[TUT.stageIndex];
        const prevPhaseId = (currentPhase() && currentPhase().id) || null;
        renderActiveTab();
        TUT.activePhases = resolveActivePhasesForStage(st);
        const matchedIdx = TUT.activePhases.findIndex((p) => p.id === prevPhaseId);
        TUT.phaseIndex = matchedIdx >= 0 ? matchedIdx : Math.min(TUT.phaseIndex, TUT.activePhases.length - 1);
        updateTutorialChrome();
        const ph = currentPhase();
        scrollTargetIntoView(resolveSelectorForPhase(ph), false, true);
      }, 140);
    });
  }

  window.__GOSIL_TUTORIAL__ = {
    getState: function () {
      const st = TUTORIAL_STAGES[TUT.stageIndex] || {};
      const ph = currentPhase() || {};
      return {
        active: TUT.active,
        playing: TUT.playing,
        completed: TUT.completed,
        stageIndex: TUT.stageIndex,
        stageCount: TUTORIAL_STAGES.length,
        stageId: st.id || null,
        phaseIndex: TUT.phaseIndex,
        phaseCount: TUT.activePhases.length,
        phaseId: ph.id || null,
        phaseIds: TUT.activePhases.map((p) => p.id),
        userScrolledAway: TUT.userScrolledAway,
        runToken: TUT.runToken,
        tab: STATE.tab,
        overviewPreset: STATE.overviewPreset,
        tierMetal: STATE.tierMetal,
        decompPreset: STATE.decompPreset,
        voidApplied: STATE.voidApplied,
        spreadMetal: STATE.spreadMetal,
        quoteAgeSec: STATE.quoteAgeSec,
        forecastSeriesIdx: STATE.forecastSeriesIdx,
        forecastHorizon: STATE.forecastHorizon,
      };
    },
    goToStage: function (idx) { if (TUT.active) goToStage(idx, true); },
    goToPhase: function (idx) { if (TUT.active) goToPhase(idx, true, true); },
    start: startTutorial,
    exit: exitTutorial,
  };

  setupTabs();
  setupTutorial();
  renderOverview();
})();
