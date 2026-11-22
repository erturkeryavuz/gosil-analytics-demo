"""Standalone integrity, math, and privacy tests for the GoSil synthetic showcase.

Runs completely independently with Python 3.9+ standard library only (zero private
repository access, zero environment variables, zero network calls).
"""
from decimal import Decimal, ROUND_HALF_EVEN, localcontext
from fractions import Fraction
import json
import re
import subprocess
import unittest
from pathlib import Path

DEMO_ROOT = Path(__file__).resolve().parent.parent
DOCS = DEMO_ROOT / "docs"
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
        # Active entries with Alternative B void applied (TX-003 excluded):
        # Gold: +10g (285,114,000 e4) + 5g (150,060,000 e4) - 3g = 12,000,000 ug
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
        # 15g total cost = 435,174,000 e4; removing 3/15 (20%) leaves 348,139,200 e4
        self.assertEqual(gold_cost, 348_139_200)

        # Physical holdings isolation & exact fine mass conservation
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
            # Steady synthetic trend promotes drift challenger
            self.assertEqual(trend_s["horizons"][h]["selected_model"], "drift")
            self.assertTrue(trend_s["horizons"][h]["models"]["drift"]["promoted"])
            # Choppy synthetic series withholds BOTH challengers and retains naive
            self.assertEqual(choppy_s["horizons"][h]["selected_model"], "naive")
            self.assertFalse(choppy_s["horizons"][h]["models"]["drift"]["promoted"])
            self.assertFalse(choppy_s["horizons"][h]["models"]["damped_trend"]["promoted"])
            for s in (trend_s, choppy_s):
                for m in s["horizons"][h]["models"].values():
                    self.assertIsNone(m["probability"])
                    self.assertEqual(m["band_kind"], "empirical_error_sensitivity")

    def test_html_links_accessibility_and_privacy_boundaries(self):
        self.assertFalse((DEMO_ROOT / "LICENSE").exists())
        index_html = (DOCS / "index.html").read_text(encoding="utf-8")
        for tab in ["overview", "structure", "decomp", "ledger", "spread", "forecast", "arch"]:
            self.assertIn(f'id="tab-{tab}"', index_html)
            self.assertIn(f'id="panel-{tab}"', index_html)
        for page in ("index.html", "notices.html"):
            txt = (DOCS / page).read_text(encoding="utf-8")
            for ref in re.findall(r'(?:href|src)="([^"]+)"', txt):
                if ref.startswith(("http://", "https://", "#", "mailto:")):
                    continue
                self.assertTrue((DOCS / ref).is_file(), f"Broken local asset {ref!r} in {page}")
        self.assertIn("prefers-reduced-motion", (DOCS / "styles.css").read_text(encoding="utf-8"))

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
        ]
        for path in [DEMO_ROOT / "README.md", *DOCS.rglob("*")]:
            if not path.is_file():
                continue
            txt = path.read_text(encoding="utf-8")
            for pat in forbidden:
                self.assertIsNone(re.search(pat, txt, re.I), f"Forbidden pattern {pat!r} in {path.name}")


if __name__ == "__main__":
    unittest.main()
