import zipfile, glob, os
import pandas as pd
zips = sorted(glob.glob('histdata_spx/*.zip'))
print(zips)
frames = []
for z in zips:
    with zipfile.ZipFile(z) as zf:
        for nm in zf.namelist():
            if nm.lower().endswith('.csv'):
                with zf.open(nm) as f:
                    df = pd.read_csv(f, sep=';', header=None,
                        names=['dt','open','high','low','close','vol'])
                frames.append(df)
                print(z, nm, len(df), df.iloc[0,0], df.iloc[-1,0], flush=True)
                break
all1 = pd.concat(frames, ignore_index=True)
print('total rows raw', len(all1))
# parse EST sin DST -> America/New_York? Spec dice EST sin DST = UTC-5 fijo
all1['time'] = pd.to_datetime(all1['dt'], format='%Y%m%d %H%M%S')
all1['time'] = all1['time'].dt.tz_localize('Etc/GMT+5').dt.tz_convert('UTC').dt.tz_localize(None)
for c in ['open','high','low','close','vol']:
    all1[c] = pd.to_numeric(all1[c], errors='coerce')
all1 = all1.dropna(subset=['open','high','low','close']).sort_values('time')
ndup = all1.duplicated('time').sum()
all1 = all1.drop_duplicates('time', keep='first').reset_index(drop=True)
all1[['time','open','high','low','close','vol']].to_csv('histdata_spx/spxusd_m1_all.csv', index=False)
print('M1 barras=%d dup=%d rango=%s -> %s' % (len(all1), ndup, all1.time.min(), all1.time.max()))
all1['ym'] = all1.time.dt.to_period('M').astype(str)
got = sorted(all1.ym.unique())
import pandas as pd2
exp = pd2.period_range('2023-01','2026-09',freq='M').astype(str).tolist()
print('meses con datos %d/%d = %.1f%%' % (len(got), len(exp), 100*len(got)/len(exp)))
print('meses:', got)
print('conteo/mes:'); print(all1.groupby('ym').size().to_string())
# resample H1 y M15
all1 = all1.set_index('time').sort_index()
h1 = pd.DataFrame({'open':all1.open.resample('h').first(),'high':all1.high.resample('h').max(),
 'low':all1.low.resample('h').min(),'close':all1.close.resample('h').last(),
 'vol':all1.vol.resample('h').sum()}).dropna().reset_index()
h1.to_csv('histdata_spx/spxusd_h1.csv', index=False)
m15 = pd.DataFrame({'open':all1.open.resample('15min').first(),'high':all1.high.resample('15min').max(),
 'low':all1.low.resample('15min').min(),'close':all1.close.resample('15min').last(),
 'vol':all1.vol.resample('15min').sum()}).dropna().reset_index()
m15.to_csv('histdata_spx/spxusd_m15.csv', index=False)
print('H1=%d %s->%s | M15=%d %s->%s' % (len(h1),h1.time.min(),h1.time.max(),len(m15),m15.time.min(),m15.time.max()))
