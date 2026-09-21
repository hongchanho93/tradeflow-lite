import gzip
import json
import tempfile
import unittest
from pathlib import Path

from build_lite_market_universe import OUTPUT_FIELDS, build


class LiteMarketUniverseTests(unittest.TestCase):
    def test_build_normalizes_stock_etf_and_index_identity(self):
        rows = []
        controls = [
            ("000001", "SZ", "平安银行", "stock"),
            ("600000", "SH", "浦发银行", "stock"),
            ("430001", "BJ", "北交所样本", "stock"),
            ("159915", "SZ", "创业板ETF", "fund"),
            ("510050", "SH", "上证50ETF", "fund"),
            ("SH.000001", "SH", "上证指数", "index"),
            ("BJ.899050", "BJ", "北证50", "index"),
        ]
        for symbol, exchange, name, kind in controls:
            rows.append({"symbol": symbol, "exchange": exchange, "name": name, "security_type": kind, "status": "active", "search_aliases": [name, "alias"]})
        for index in range(4_000):
            rows.append({"symbol": f"{10_000 + index:06d}", "exchange": "SZ", "name": f"股票{index}", "security_type": "stock", "status": "active"})
        for index in range(1_000):
            rows.append({"symbol": f"{150000 + index:06d}", "exchange": "SZ", "name": f"ETF{index}", "security_type": "fund", "status": "active"})
        for index in range(400):
            rows.append({"symbol": f"SH.{900000 + index:06d}", "exchange": "SH", "name": f"指数{index}", "security_type": "index", "status": "active"})

        with tempfile.TemporaryDirectory() as directory:
            source = Path(directory) / "universe.json.gz"
            with gzip.open(source, "wt", encoding="utf-8") as handle:
                json.dump({"source": "tdx-7709-0x044d", "data_version": "tdx-test", "rows": rows}, handle, ensure_ascii=False)
            package = build(source)

        by_identity = {(row["symbol"], row["kind"]): row for row in package["rows"]}
        self.assertEqual(by_identity[("SH:000001", "index")]["code"], "000001")
        self.assertEqual(by_identity[("SZ:159915", "etf")]["name"], "创业板ETF")
        self.assertEqual(by_identity[("SZ:000001", "stock")]["aliases"], ["alias"])
        self.assertIn(("BJ:899050", "index"), by_identity)
        self.assertTrue(all(set(row) <= OUTPUT_FIELDS for row in package["rows"]))


if __name__ == "__main__":
    unittest.main()
