# Descarga HistData.com M1 GENERIC_ASCII de SPX/USD (S&P500) 2023-2026.
# Uso: python dl_histdata_spx.py --pair spxusd --years 2023 2024 2025 2026
# Guarda zips/csv en histdata_spx/ junto a este script.
import argparse
import os
import sys

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "histdata_spx")
os.makedirs(OUT, exist_ok=True)

from histdata import download_hist_data as dl
from histdata.api import Platform as P, TimeFrame as TF


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pair", default="spxusd")
    ap.add_argument("--years", nargs="+", type=int, default=[2023, 2024, 2025, 2026])
    a = ap.parse_args()
    ok, fail = 0, []
    for y in a.years:
        for m in range(1, 13):
            try:
                dl(year=str(y), month=str(m), pair=a.pair,
                   platform=P.GENERIC_ASCII, time_frame=TF.ONE_MINUTE)
                ok += 1
                print(f"OK {y}-{m:02d}", flush=True)
            except Exception as e:
                fail.append((y, m, str(e)[:200]))
                print(f"FALLO {y}-{m:02d}: {str(e)[:200]}", flush=True)
    print(f"HECHO ok={ok} fallos={len(fail)}")
    for y, m, e in fail:
        print(f"  {y}-{m:02d}: {e}")


if __name__ == "__main__":
    main()
