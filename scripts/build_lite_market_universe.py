#!/usr/bin/env python3
"""Build the public-field TradeFlow Lite market universe from a verified TDX snapshot."""

from __future__ import annotations

import argparse
import gzip
import json
from collections import Counter
from pathlib import Path


SOURCE = "tdx-7709-0x044d"
MINIMUM_COUNTS = {"stock": 4_000, "etf": 1_000, "index": 400}
OUTPUT_FIELDS = {"symbol", "code", "name", "exchange", "kind", "aliases"}


def _canonical_symbol(row: dict) -> tuple[str, str]:
    exchange = str(row.get("exchange") or "").strip().upper()
    raw_symbol = str(row.get("symbol") or "").strip().upper()
    code = raw_symbol.rsplit(".", 1)[-1]
    if exchange not in {"SH", "SZ", "BJ"} or len(code) != 6 or not code.isdigit():
        raise ValueError(f"invalid market identity: exchange={exchange!r} symbol={raw_symbol!r}")
    return f"{exchange}:{code}", code


def build(source_path: Path) -> dict:
    with gzip.open(source_path, "rt", encoding="utf-8") as handle:
        source = json.load(handle)
    if source.get("source") != SOURCE or not str(source.get("data_version") or "").startswith("tdx-"):
        raise ValueError("source is not a verified TDX catalog snapshot")

    rows = []
    seen: set[tuple[str, str]] = set()
    for source_row in source.get("rows") or []:
        if str(source_row.get("status") or "active").strip().lower() != "active":
            continue
        source_kind = str(source_row.get("security_type") or "stock").strip().lower()
        kind = "etf" if source_kind in {"fund", "etf"} else source_kind
        if kind not in MINIMUM_COUNTS:
            continue
        symbol, code = _canonical_symbol(source_row)
        identity = (symbol, kind)
        if identity in seen:
            raise ValueError(f"duplicate market identity: {symbol} {kind}")
        seen.add(identity)
        name = str(source_row.get("name") or "").strip()
        if not name:
            raise ValueError(f"missing name: {symbol} {kind}")
        aliases = []
        for value in source_row.get("search_aliases") or []:
            alias = str(value or "").strip()
            if alias and alias not in aliases and alias not in {name, code, symbol}:
                aliases.append(alias)
        row = {
            "symbol": symbol,
            "code": code,
            "name": name,
            "exchange": symbol[:2],
            "kind": kind,
        }
        if aliases:
            row["aliases"] = aliases
        rows.append(row)

    counts = Counter(row["kind"] for row in rows)
    for kind, minimum in MINIMUM_COUNTS.items():
        if counts[kind] < minimum:
            raise ValueError(f"incomplete {kind} catalog: {counts[kind]} < {minimum}")
    exchanges = {row["exchange"] for row in rows if row["kind"] == "stock"}
    if not {"SH", "SZ", "BJ"} <= exchanges:
        raise ValueError(f"stock catalog missing exchange: {sorted(exchanges)}")
    for symbol, kind in (("SZ:000001", "stock"), ("SH:600000", "stock"), ("SZ:159915", "etf"), ("SH:510050", "etf"), ("SH:000001", "index"), ("BJ:899050", "index")):
        if (symbol, kind) not in seen:
            raise ValueError(f"missing control instrument: {symbol} {kind}")

    rows.sort(key=lambda row: (row["exchange"], row["code"], row["kind"]))
    package = {
        "version": f"{source['data_version']}-lite-v1",
        "source": SOURCE,
        "counts": dict(sorted(counts.items())),
        "rows": rows,
    }
    if any(set(row) - OUTPUT_FIELDS for row in rows):
        raise ValueError("output contains a non-public field")
    return package


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("source", type=Path)
    parser.add_argument("output", type=Path)
    args = parser.parse_args()
    package = build(args.source)
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(json.dumps(package, ensure_ascii=False, separators=(",", ":")) + "\n", encoding="utf-8")
    print(json.dumps({"version": package["version"], "counts": package["counts"], "rows": len(package["rows"])}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
