# Fusiona zips HistData NSX/USD M1 -> CSV único UTC ordenado sin duplicados.
# Uso: python merge_histdata_ustec.py  (lee histdata_ustec/*.zip, escribe histdata_ustec/nsxusd_m1_all.csv)
import glob
import os
import zipfile
import pandas as pd

BASE = os.path.dirname(os.path.abspath(__file__))
HD = os.path.join(BASE, "histdata_ustec")
OUT = os.path.join(HD, "nsxusd_m1_all.csv")


def read_zip(zp):
    with zipfile.ZipFile(zp) as z:
        csvs = [n for n in z.namelist() if n.lower().endswith(".csv")]
        frames = []
        for cn in csvs:
            with z.open(cn) as f:
                df = pd.read_csv(f, sep=";", header=None,
                                 names=["dt", "o", "h", "l", "c", "v"])
                frames.append(df)
        if not frames:
            return None
        return pd.concat(frames, ignore_index=True)


def main():
    zips = sorted(glob.glob(os.path.join(HD, "*.zip")))
    print("zips:", [os.path.basename(z) for z in zips])
    allf = []
    for zp in zips:
        df = read_zip(zp)
        print(os.path.basename(zp), "filas=", None if df is None else len(df))
        if df is not None:
            allf.append(df)
    t = pd.concat(allf, ignore_index=True)
    # dt = 'YYYYMMDD HHMMSS' en EST sin DST -> UTC = EST+5h
    t["time"] = pd.to_datetime(t["dt"], format="%Y%m%d %H%M%S") + pd.Timedelta(hours=5)
    t = t.rename(columns={"o": "open", "h": "high", "l": "low", "c": "close", "v": "vol"})
    t = t[["time", "open", "high", "low", "close", "vol"]]
    t = t.sort_values("time").drop_duplicates("time").reset_index(drop=True)
    t.to_csv(OUT, index=False)
    print(f"M1 total={len(t)} {t.time.min()} -> {t.time.max()}")
    bym = t.time.dt.to_period("M").value_counts().sort_index()
    print(bym.to_string())
    print("OUT:", OUT)


if __name__ == "__main__":
    main()
