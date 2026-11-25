"""Standalone integrity, math, artwork, tutorial, and privacy tests for GoSil.

Runs completely independently with Python 3.9+ standard library and Node syntax check only
(zero private repository access, zero environment variables, zero network calls).
"""
from decimal import Decimal, ROUND_HALF_EVEN, localcontext
from fractions import Fraction
import json
import re
import struct
import subprocess
import unittest
from pathlib import Path

DEMO_ROOT = Path(__file__).resolve().parent.parent
DOCS = DEMO_ROOT / "docs"
MEDIA = DEMO_ROOT / "media"
TROY_GRAMS = Fraction(311034768, 10_000_000)


def load_data():
    raw = (DOCS / "data.js").read_text(encoding="utf-8")
    m = re.search(r"Object\.freeze\((.*)\);\s*$", raw, re.S)
    assert m, "Unable to parse window.GOSIL_SHOWCASE_DATA"
    return json.loads(m.group(1))


def fmt_frac(val: Fraction, places: int = 4) -> str:
    q = Decimal(10) ** (-places)
    with localcontext() as ctx:
        ctx.prec = 50
        d = (Decimal(val.numerator) / Decimal(val.denominator)).quantize(q, rounding=ROUND_HALF_EVEN)
    return format(d, "f")


def png_dimensions(path: Path):
    head = path.read_bytes()[:24]
    assert head[:8] == b"\x89PNG\r\n\x1a\n", f"Not a valid PNG: {path}"
    return struct.unpack(">II", head[16:24])


class TestGoSilStandaloneShowcase(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.data = load_data()

    def test_required_files_and_js_syntax(self):
        for rel in [
            "README.md",
            "docs/index.html",
            "docs/styles.css",
            "docs/data.js",
            "docs/app.js",
            "docs/notices.html",
            "docs/THIRD-PARTY-NOTICES.md",
            "media/gosil-readme-hero.png",
            "media/gosil-social-preview.png",
            "media/src/gosil-readme-hero.svg",
            "media/src/gosil-social-preview.svg",
        ]:
            self.assertTrue((DEMO_ROOT / rel).is_file(), f"Missing {rel}")
        for js in ("data.js", "app.js"):
            res = subprocess.run(["node", "--check", str(DOCS / js)], capture_output=True, text=True)
            self.assertEqual(res.returncode, 0, res.stderr)

    def test_synthetic_metadata_and_six_price_tiers(self):
        meta = self.data["meta"]
        self.assertTrue(meta["synthetic_only"])
        self.assertEqual(meta["troy_oz_grams"], "31.1034768")
        self.assertIn("FROZEN", meta["status"])
        for metal in ("gold", "silver"):
            tiers = self.data["six_price_tiers"][metal]["tiers"]
            self.assertEqual(len(tiers), 6)
            self.assertEqual([t["tier"] for t in tiers], [1, 2, 3, 4, 5, 6])
            # Independently verify Tier 3 parity equals (Tier 1 USD/oz * Tier 2 USD/TRY) / 31.1034768
            t1 = Fraction(tiers[0]["value"].replace(",", ""))
            t2 = Fraction(tiers[1]["value"].replace(",", ""))
            expected_t3 = fmt_frac((t1 * t2) / TROY_GRAMS, 4)
            actual_t3 = tiers[2]["value"].replace(",", "")
            self.assertEqual(actual_t3, expected_t3, f"Tier 3 parity drift for {metal}")

    def test_currency_decomposition_exact_identities(self):
        for pr in self.data["decomposition_presets"]:
            p0, p1 = Fraction(pr["p0"]), Fraction(pr["p1"])
            e0, e1 = Fraction(pr["e0"]), Fraction(pr["e1"])
            g0 = (p0 * e0) / TROY_GRAMS
            g1 = (p1 * e1) / TROY_GRAMS
            usd_c = ((p1 - p0) * e0) / TROY_GRAMS
            fx_c = (p0 * (e1 - e0)) / TROY_GRAMS
            inter_c = ((p1 - p0) * (e1 - e0)) / TROY_GRAMS
            self.assertEqual(usd_c + fx_c + inter_c, g1 - g0)
            self.assertEqual(pr["try_g_start"], fmt_frac(g0, 4))
            self.assertEqual(pr["try_g_end"], fmt_frac(g1, 4))
            self.assertEqual(pr["total_delta"], fmt_frac(g1 - g0, 4))
            self.assertEqual(pr["usd_component"], fmt_frac(usd_c, 4))
            self.assertEqual(pr["fx_component"], fmt_frac(fx_c, 4))
            self.assertEqual(pr["interaction_component"], fmt_frac(inter_c, 4))

    def test_fixed_point_ledger_conservation_voids_and_physical_isolation(self):
        entries = self.data["synthetic_ledger"]["financial_entries"]
        gold_bal = 0
        gold_cost = 0
        for tx in entries:
            self.assertIsInstance(tx["quantity_ug"], int)
            self.assertIsInstance(tx["unit_price_e4"], int)
            self.assertIsInstance(tx["total_cost_e4"], int)
            if tx["instrument"] != "gold" or tx["voidable_demo"]:
                continue
            if tx["side"] == "buy":
                gold_bal += tx["quantity_ug"]
                gold_cost += tx["total_cost_e4"]
            else:
                removed = (gold_cost * tx["quantity_ug"]) // gold_bal
                gold_cost -= removed
                gold_bal -= tx["quantity_ug"]
        self.assertEqual(gold_bal, 12_000_000)
        self.assertEqual(gold_cost, 348_139_200)

        for ph in self.data["synthetic_ledger"]["physical_holdings"]:
            self.assertFalse(ph["bank_quote_applied"])
            rem = ph["pieces_total"] - ph["pieces_disposed"]
            gross = rem * ph["gross_weight_per_piece_ug"]
            fine = (gross * ph["fineness_milli"]) // 1000
            self.assertGreater(fine, 0)
            self.assertLessEqual(fine, gross)

    def test_spread_formulas_and_900s_freshness_policy(self):
        for metal in ("gold", "silver"):
            q = self.data["quote_defaults"][metal]
            self.assertEqual(q["freshness_limit_sec"], 900)
            bid = Fraction(q["bid_try_g"])
            ask = Fraction(q["ask_try_g"])
            self.assertGreater(bid, 0)
            self.assertGreaterEqual(ask, bid)
            mid_spread = Fraction(2) * (ask - bid) / (ask + bid)
            drag = (ask - bid) / ask
            self.assertGreater(mid_spread, 0)
            self.assertGreater(drag, 0)

    def test_forecast_promotion_and_withholding_rules(self):
        series_list = self.data["forecast_evaluation"]["synthetic_series"]
        self.assertEqual(len(series_list), 2)
        trend_s, choppy_s = series_list[0], series_list[1]
        self.assertTrue(trend_s["synthetic"])
        self.assertTrue(choppy_s["synthetic"])
        for h in ("3", "6"):
            self.assertEqual(trend_s["horizons"][h]["selected_model"], "drift")
            self.assertTrue(trend_s["horizons"][h]["models"]["drift"]["promoted"])
            self.assertEqual(choppy_s["horizons"][h]["selected_model"], "naive")
            self.assertFalse(choppy_s["horizons"][h]["models"]["drift"]["promoted"])
            self.assertFalse(choppy_s["horizons"][h]["models"]["damped_trend"]["promoted"])
            for s in (trend_s, choppy_s):
                for m in s["horizons"][h]["models"].values():
                    self.assertIsNone(m["probability"])
                    self.assertEqual(m["band_kind"], "empirical_error_sensitivity")

    def test_tutorial_lifecycle_adaptive_contracts_and_anchors(self):
        index_html = (DOCS / "index.html").read_text(encoding="utf-8")
        app_js = (DOCS / "app.js").read_text(encoding="utf-8")
        css = (DOCS / "styles.css").read_text(encoding="utf-8")

        for elem_id in (
            "btnWatchTutorial", "tutorialDock", "tutPhasePills",
            "btnTutPrev", "btnTutPlayPause", "btnTutNext", "btnTutRestart", "btnTutExit",
        ):
            self.assertIn(f'id="{elem_id}"', index_html)

        for token in (
            "window.__GOSIL_TUTORIAL__",
            "syncTutorialEntryButtons",
            "clearTutorialTimers",
            "resolveActivePhasesForStage",
            "isElementFullyInClearViewport",
            "restoreState",
            "prefersReducedMotion",
            "if (TUT.active) return;",
        ):
            self.assertIn(token, app_js)

        for stage_id in (
            '"overview"', '"market-structure"', '"currency-drivers"',
            '"portfolio-ledger"', '"spread-freshness"', '"forecast-eval"',
        ):
            self.assertIn(f"id: {stage_id}", app_js)

        for anchor in (
            'id="ov-hero-band"', 'id="ov-focal-stage"', 'id="ov-spot-summary"', 'id="ov-workflow-strip"',
            'id="structure-tiers-card"', 'id="structure-bridge-card"', 'id="structure-bridge-box"',
            'id="decomp-main-card"', 'id="decomp-kpis"', 'id="ledger-kpis"', 'id="ledger-journal-card"',
            'id="spread-main-card"', 'id="spread-status-box"',
            'id="forecast-main-card"', 'id="forecast-controls"', 'id="forecast-chart-box"',
        ):
            self.assertIn(anchor, app_js, f"Missing tutorial target anchor {anchor}")

        self.assertIn("position: sticky;", css)
        self.assertIn("prefers-reduced-motion", css)

    def test_artwork_dimensions_data_grounding_and_zero_tech_badges(self):
        hero_png = MEDIA / "gosil-readme-hero.png"
        social_png = MEDIA / "gosil-social-preview.png"
        hero_svg = MEDIA / "src" / "gosil-readme-hero.svg"
        social_svg = MEDIA / "src" / "gosil-social-preview.svg"

        self.assertEqual(png_dimensions(hero_png), (1600, 900))
        self.assertEqual(png_dimensions(social_png), (1280, 640))

        pr = next(p for p in self.data["decomposition_presets"] if p["id"] == "gold_offset")
        usd_2 = f'{float(pr["usd_component"]):.2f}'
        fx_2 = f'+{float(pr["fx_component"]):.2f}'
        inter_2 = f'{float(pr["interaction_component"]):.2f}'
        tot_2 = f'+{float(pr["total_delta"]):.2f}'

        hero_txt = hero_svg.read_text(encoding="utf-8")
        social_txt = social_svg.read_text(encoding="utf-8")

        for name, txt in ((hero_svg.name, hero_txt), (social_svg.name, social_txt)):
            self.assertIn("GoSil", txt, name)
            self.assertIn("Price Driver Breakdown", txt, name)
            self.assertIn("Research only", txt, name)
            for banned in (
                "Python", "SQLite", "739", "205", "D23", "IMF", "BIS", "Akbank", "e4", "AI-Powered",
                "1 troy oz = 31.1034768 g", "Exact additive identity",
                "USD metal vs. USD/TRY decomposition",
                "6-tier pricing &amp; quote freshness checks",
                "Fixed-point ledger &amp; forecast testing",
                "synthetic showcase",
            ):
                self.assertNotIn(banned, txt, f"Disallowed promotional/tech text {banned!r} in {name}")

        # README Hero must contain all 4 exact data-grounded values and public-facing labels
        for tok in (
            usd_2, fx_2, inter_2, tot_2,
            "Metal Price", "Exchange Rate", "Combined", "Total Price",
            "100% synthetic",
        ):
            self.assertIn(tok, hero_txt)

        # Social Preview must faithfully represent ALL 4 additive components (no omitted cross-interaction)
        for tok in ("Metal", "FX Rate", "Combined", "Total", "Synthetic example", "TRY / gram"):
            self.assertIn(tok, social_txt)
        # Confirm Social Preview renders all 4 data-grounded bar rects (sGold, sSilver, sSlate, sPos)
        for grad in ("url(#sGold)", "url(#sSilver)", "url(#sSlate)", "url(#sPos)"):
            self.assertIn(grad, social_txt, f"Missing additive bar fill {grad} in Social Preview")

        # Overview must remain product-first (no troy-ounce constant in introductory chart footer)
        app_js = (DOCS / "app.js").read_text(encoding="utf-8")
        ov_block = app_js.split("function renderOverview()")[1].split("function renderStructure()")[0]
        self.assertNotIn("31.1034768", ov_block)
        self.assertIn("Gold &amp; Silver Pricing", ov_block)
        self.assertIn("Holdings &amp; Transactions", ov_block)
        self.assertIn("Buying &amp; Selling Costs", ov_block)
        self.assertIn("Forecast Research", ov_block)

    def test_html_links_accessibility_disclosures_and_privacy_boundaries(self):
        self.assertFalse((DEMO_ROOT / "LICENSE").exists())
        index_html = (DOCS / "index.html").read_text(encoding="utf-8")
        for tab in ["overview", "structure", "decomp", "ledger", "spread", "forecast", "arch"]:
            self.assertIn(f'id="tab-{tab}"', index_html)
            self.assertIn(f'id="panel-{tab}"', index_html)
        for page in ("index.html", "notices.html"):
            txt = (DOCS / page).read_text(encoding="utf-8")
            self.assertIn("synthetic", txt.lower())
            self.assertIn("not investment advice", txt.lower())
            for ref in re.findall(r'(?:href|src)="([^"]+)"', txt):
                if ref.startswith(("http://", "https://", "#", "mailto:")):
                    continue
                self.assertTrue((DOCS / ref).is_file(), f"Broken local asset {ref!r} in {page}")

        readme = (DEMO_ROOT / "README.md").read_text(encoding="utf-8")
        self.assertIn("media/gosil-readme-hero.png", readme)
        self.assertIn("100% synthetic", readme.lower())
        self.assertNotIn("cdn.", index_html.lower())
        self.assertNotIn("fonts.googleapis", index_html.lower())
        self.assertNotIn("onclick=", index_html.lower())

        forbidden = [
            r"/" + "Users/",
            r"akbank",
            r"api\.imf\.org",
            r"stats\.bis\.org",
            r"github\.com/erturkeryavuz/GoSil",
            r"github\.com/erturkeryavuz/Trading-Edge-Terminal",
            r"ghp_[A-Za-z0-9_]{20,}",
            r"PRIVATE KEY",
            r"AI-Powered",
            r"Co-Authored-By",
        ]
        scan_files = [DEMO_ROOT / "README.md", *DOCS.rglob("*"), *(MEDIA / "src").rglob("*.svg")]
        for path in scan_files:
            if not path.is_file():
                continue
            txt = path.read_text(encoding="utf-8")
            for pat in forbidden:
                self.assertIsNone(re.search(pat, txt, re.I), f"Forbidden pattern {pat!r} in {path.name}")


if __name__ == "__main__":
    unittest.main()
