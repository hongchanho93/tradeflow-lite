#!/usr/bin/env python3
"""Build a compact logo-id manifest without downloading thousands of images."""

from __future__ import annotations

import argparse
from concurrent.futures import ThreadPoolExecutor
import json
import re
import time
import urllib.parse
import urllib.request
from pathlib import Path


SEARCH_URL = "https://symbol-search.tradingview.com/symbol_search/v3/"
PAGE_SIZE = 50
GROUPS = (
    ("SH", "SSE", "stocks", "stock"),
    ("SZ", "SZSE", "stocks", "stock"),
    ("SH", "SSE", "funds", "etf"),
    ("SZ", "SZSE", "funds", "etf"),
    ("SH", "SSE", "index", "index"),
    ("SZ", "SZSE", "index", "index"),
)
SYMBOL_RE = re.compile(r"^\d{6}$")
COMPANY_LOGO_RE = re.compile(
    r'https://basic\.10jqka\.com\.cn/ai_data/logo/company/[^"\']+\.(?:png|jpg|svg)'
)


def _page(exchange: str, search_type: str, start: int) -> dict:
    query = urllib.parse.urlencode({
        "text": "",
        "hl": 1,
        "exchange": exchange,
        "lang": "zh",
        "search_type": search_type,
        "domain": "production",
        "start": start,
    })
    request = urllib.request.Request(
        f"{SEARCH_URL}?{query}",
        headers={
            "User-Agent": "Mozilla/5.0 TradeFlow-Lite-logo-manifest/0.1",
            "Referer": "https://cn.tradingview.com/",
            "Origin": "https://cn.tradingview.com",
        },
    )
    last_error: Exception | None = None
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                return json.load(response)
        except Exception as error:
            last_error = error
            time.sleep(0.25 * (attempt + 1))
    raise RuntimeError(f"logo manifest page failed: {exchange} {search_type} {start}: {last_error}")


def _group(exchange: str, search_type: str) -> list[dict]:
    first = _page(exchange, search_type, 0)
    first_rows = first.get("symbols") or []
    total = len(first_rows) + int(first.get("symbols_remaining") or 0)
    starts = list(range(PAGE_SIZE, total, PAGE_SIZE))
    with ThreadPoolExecutor(max_workers=4) as executor:
        pages = list(executor.map(lambda start: _page(exchange, search_type, start), starts))
    rows = list(first_rows)
    for page in pages:
        rows.extend(page.get("symbols") or [])
    return rows


def _beijing_company_logo(row: dict) -> tuple[str, str]:
    code = str(row["code"])
    page_url = f"https://basic.10jqka.com.cn/{code}/company.html"
    request = urllib.request.Request(
        page_url,
        headers={"User-Agent": "Mozilla/5.0 TradeFlow-Lite-logo-manifest/0.1"},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=10) as response:
                html = response.read().decode("utf-8", errors="ignore")
            match = COMPANY_LOGO_RE.search(html)
            return f"{row['symbol']}:stock", match.group(0) if match else ""
        except Exception:
            if attempt == 2:
                return f"{row['symbol']}:stock", ""
            time.sleep(0.25 * (attempt + 1))
    return f"{row['symbol']}:stock", ""


def build(universe_path: Path) -> dict:
    universe = json.loads(universe_path.read_text(encoding="utf-8"))
    wanted = {
        f"{row['symbol']}:{row['kind']}"
        for row in universe["rows"]
    }
    logos: dict[str, str] = {}
    for lite_exchange, tv_exchange, search_type, kind in GROUPS:
        for row in _group(tv_exchange, search_type):
            symbol = re.sub(r"<[^>]+>", "", str(row.get("symbol") or "")).strip()
            logoid = str(row.get("logoid") or "").strip().strip("/")
            key = f"{lite_exchange}:{symbol}:{kind}"
            if key in wanted and SYMBOL_RE.fullmatch(symbol) and logoid:
                logos[key] = logoid
    beijing_stocks = [
        row for row in universe["rows"]
        if row["exchange"] == "BJ" and row["kind"] == "stock"
    ]
    with ThreadPoolExecutor(max_workers=8) as executor:
        beijing_results = list(executor.map(_beijing_company_logo, beijing_stocks))
    for key, logo_url in beijing_results:
        if logo_url:
            logos[key] = logo_url
    beijing_logo_count = sum(bool(logo_url) for _, logo_url in beijing_results)
    if beijing_logo_count < 340:
        raise RuntimeError(f"Beijing company logo coverage unexpectedly low: {beijing_logo_count}")
    return {
        "source": "tradingview-symbol-search-v3+10jqka-company-pages",
        "providers": {"SH": "source/SSE", "SZ": "source/SZSE", "BJ": "local/BJSE"},
        "logos": dict(sorted(logos.items())),
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("universe", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    package = build(args.universe)
    args.output.write_text(json.dumps(package, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"logos": len(package["logos"]), "output": str(args.output)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
