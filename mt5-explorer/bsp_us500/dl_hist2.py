import time, os
from histdata.api import download_hist_data, TimeFrame, Platform
out = 'histdata_spx'
os.makedirs(out, exist_ok=True)
def dl(y, m):
    try:
        r = download_hist_data(year=str(y), month=m, pair='spxusd',
            platform=Platform.GENERIC_ASCII, time_frame=TimeFrame.ONE_MINUTE,
            output_directory=out, verbose=True)
        print(f'OK {y}-{m} -> {r}', flush=True)
    except Exception as e:
        print(f'FAIL {y}-{m}: {type(e).__name__}: {e}', flush=True)
    time.sleep(2)
for y in ('2023','2024','2025'):
    dl(y, None)
for m in range(1, 10):
    dl('2026', m)
print('DONE')
