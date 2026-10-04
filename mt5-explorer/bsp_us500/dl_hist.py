import time, os
from histdata.api import download_hist_data, TimeFrame, Platform
out = 'histdata_spx'
os.makedirs(out, exist_ok=True)
ok, fail = [], []
months = []
for y in (2023, 2024, 2025, 2026):
    for m in range(1, 13):
        if y == 2026 and m > 8:  # hasta ago-2026 (sep en curso); se intentara igual sep si existe
            continue
        months.append((y, m))
# intentar tambien 202609
months.append((2026, 9))
for (y, m) in months:
    try:
        r = download_hist_data(year=str(y), month=m, pair='spxusd',
            platform=Platform.GENERIC_ASCII, time_frame=TimeFrame.ONE_MINUTE,
            output_directory=out, verbose=True)
        print(f'OK {y}-{m:02d} -> {r}', flush=True)
        ok.append((y, m))
    except Exception as e:
        print(f'FAIL {y}-{m:02d}: {type(e).__name__}: {e}', flush=True)
        fail.append((y, m, repr(e)))
    time.sleep(2)
print('OK_LIST', ok)
print('FAIL_LIST', fail)
