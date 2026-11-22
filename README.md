# GoSil — Precious Metals Accounting & Statistical Research Showcase

> **Status: FROZEN — Historical Research Showcase (100% Synthetic)**
>
> This standalone static repository presents the engineering architecture and quantitative discipline of **GoSil** — a private, local-first Turkish gram gold and silver accounting and statistical research project whose active development has been discontinued. **Every number in this showcase is 100% synthetic.** It contains **zero** real holdings, **zero** external market datasets, **zero** live feeds, **zero** LLM/AI prediction claims, and **zero** investment advice.

---

## Interactive Modules (`docs/`)

1. **Overview:** Project boundaries, frozen milestone record (`D23`, `2026-11-16`), and core fixed-point accounting invariants.
2. **Gold & Silver Market Structure (6 Tiers):** Side-by-side synthetic breakdown separating International USD/oz Spot, USD/TRY FX, Theoretical `TRY/g` (`÷ 31.1034768`), Local Retail Reference, Generic Bank Bid/Ask Spread, and Net Execution Cost.
3. **Currency Decomposition Calculator:** Live interactive exact-arithmetic calculator (preserving `31.1034768` g/troy oz) splitting theoretical `TRY/g` changes into USD Metal Contribution + USD/TRY FX Contribution + Cross-Interaction with a live SVG waterfall chart.
4. **Synthetic Portfolio Ledger:** Fixed-point integer accounting (`MoneyTRY` in `e4` = `0.0001 TRY`; `Micrograms` in `ug` = `0.000001 g`), weighted-average cost tracking, live Alternative-B append-only void toggling (`UPDATE`/`DELETE` blocked), and strict physical-holding isolation (`bank_quote_applied = False`).
5. **Spread & Quote Freshness Simulator:** Interactive generic bank bid/ask calculator (`mid_relative_spread` & `immediate_spread_drag`) paired with a `0s`–`1800s` quote-age slider enforcing the exact `900s` (`15m`) eligibility cutoff (`STALE → WITHHELD`) and malformed `ask < bid` rejection.
6. **Statistical Forecast Evaluation:** Purged walk-forward evaluation comparing `naive`, `drift`, and `damped_trend` (`0.9` step damping) on two 100% synthetic 36-month series — demonstrating the `5%` development-MAE promotion gate, challenger withholding, and non-probabilistic sensitivity bands (`probability: null`), alongside a qualitative-only summary of private historical research findings.
7. **Architecture & Evidence:** Local-first private vault architecture diagram (`REAL_OWNER_FIRST_READ_AUTHORIZED = False`), historical private test evidence (`739/739` offline `pytest` + `205` UI3 checks), and explicit limitations.

---

## Preview & Standalone Verification Locally

```bash
# Preview static showcase locally
python3 -m http.server 8000 --directory docs

# Run standalone offline integrity tests (Python 3.9+ stdlib only)
python3 -B -m unittest discover -s tests -v
```

---

## Boundaries & Notices

- **Private Source Remains Private:** The original `GoSil` Python/SQLite engineering repository and private local vault stay strictly private and frozen.
- **100% Synthetic Data:** Zero IMF/BIS observations, zero real bank quotes, and zero personal holdings are bundled or fetched. See [`docs/THIRD-PARTY-NOTICES.md`](docs/THIRD-PARTY-NOTICES.md) and [`docs/notices.html`](docs/notices.html).
- **License Status:** No root open-source license file is declared without separate owner authorization.
