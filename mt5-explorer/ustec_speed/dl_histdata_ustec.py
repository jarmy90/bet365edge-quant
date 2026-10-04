# Descarga HistData.com M1 GENERIC_ASCII de NSX/USD (Nasdaq-100 = proxy USTEC).
# Uso: python dl_histdata_ustec.py --pair nsxusd --years 2025 2026
# Guarda zips en histdata_ustec/ junto a este script.
import argparse
import os

BASE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(BASE, "histdata_ustec")
os.makedirs(OUT, exist_ok=True)
os.chdir(OUT)

from histdata import download_hist_data as dl
from histdata.api import Platform as P, TimeFrame as TF


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pair", default="nsxusd")
    ap.add_argument("--years", nargs="+", type=int, default=[2024, 2025])
    ap.add_argument("--months", nargs="+", type=int, default=[1, 2, 3, 4, 5, 6, 7, 8, 9])
    a = ap.parse_args()
    ok, fail = 0, []
    for y in a.years:
        if y < 2026:
            try:
                dl(year=str(y), month=None, pair=a.pair,
                   platform=P.GENERIC_ASCII, time_frame=TF.ONE_MINUTE)
                ok += 1
                print(f"OK {y} (anual)", flush=True)
            except Exception as e:
                fail.append((y, 0, str(e)[:160]))
                print(f"FALLO {y}: {str(e)[:160]}", flush=True)
            continue
        for m in a.months:
            try:
                dl(year=str(y), month=str(m), pair=a.pair,
                   platform=P.GENERIC_ASCII, time_frame=TF.ONE_MINUTE)
                ok += 1
                print(f"OK {y}-{m:02d}", flush=True)
            except Exception as e:
                fail.append((y, m, str(e)[:160]))
                print(f"FALLO {y}-{m:02d}: {str(e)[:160]}", flush=True)
    print(f"HECHO ok={ok} fallos={len(fail)}")
    for y, m, e in fail:
        print(f"  {y}-{m:02d}: {e}")


if __name__ == "__main__":
    main()
