#!/usr/bin/env node
'use strict';
// Free Dukascopy download via dukascopy-node. Does not download unless explicitly asked.
// Monthly/full history is blocked until a two-session sample has been audited and acknowledged.
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

function usage(){
  console.log(`Usage:
  node download_duka_ticks.js --list-instruments
  node download_duka_ticks.js --sample --instrument <id> --from YYYY-MM-DD --to YYYY-MM-DD
  node download_duka_ticks.js --monthly --sample-audited YES --instrument <id> --from YYYY-MM-DD --to YYYY-MM-DD

Defaults write only beneath ./duka_raw. --sample is capped to a single UTC day; use two separate
sample calls after checking output. Monthly mode requires explicit acknowledgement and still runs
one month per process with concurrency 1. No full-range auto download.`);
}
const args=process.argv.slice(2);
function val(k,d=null){const i=args.indexOf(k);return i<0?d:args[i+1];}
function has(k){return args.includes(k);}
const root=__dirname;
const out=path.resolve(root,'duka_raw');

async function main(){
  if(!process.versions.node || Number(process.versions.node.split('.')[0])<18) throw new Error('Node.js 18+ required');
  let duk;
  try{duk=require('dukascopy-node');}catch(e){throw new Error('dukascopy-node not installed. Install locally first: npm install --save-dev dukascopy-node (free package, no data fee).');}
  if(has('--list-instruments')){
    // Instrument catalog exposure differs between package versions; enumerate the installed package exports.
    const names=Object.keys(duk).sort();
    console.log('dukascopy-node exports:',names.join(', '));
    const catalogCandidates=['instruments','INSTRUMENTS','instrumentList','INSTRUMENT_LIST'];
    let found=false;
    for(const k of catalogCandidates){if(duk[k]){console.log(`CATALOG ${k}:`);console.log(JSON.stringify(duk[k],null,2));found=true;}}
    if(!found) console.log('No public catalog export in this version. See instrument identifiers in package docs/source; do not guess a symbol.');
    return;
  }
  const instrument=val('--instrument');
  if(!instrument) throw new Error('Provide a verified Dukascopy instrument id.');
  const from=val('--from');const to=val('--to');
  if(!from||!to) throw new Error('--from and --to required');
  const start=new Date(`${from}T00:00:00Z`), end=new Date(`${to}T00:00:00Z`);
  if(Number.isNaN(start.valueOf())||Number.isNaN(end.valueOf())||end<start) throw new Error('invalid dates');
  if(has('--sample')){
    if(from!==to) throw new Error('sample mode is capped to one UTC day; call separately for two sessions');
    fs.mkdirSync(out,{recursive:true});
    const dir=path.join(out,instrument,from);fs.mkdirSync(dir,{recursive:true});
    const file=path.join(dir,`${instrument}_${from}_tick.csv`);
    const data=await duk.getHistoricalRates({instrument,dates:{from:start,to:new Date(start.getTime()+86400000)},timeframe:'tick',format:'csv',
      ignoreFlats:false,volume:true,cache:true,savePath:file,batchSize:1});
    if(data && typeof data==='string' && !fs.existsSync(file)) fs.writeFileSync(file,data);
    console.log(`SAMPLE COMPLETE instrument=${instrument} date=${from} path=${file}`);
    return;
  }
  if(has('--monthly')){
    if(val('--sample-audited')!=='YES') throw new Error('Monthly download blocked: audit the sample first, then pass --sample-audited YES.');
    fs.mkdirSync(out,{recursive:true});
    const months=[];let d=new Date(Date.UTC(start.getUTCFullYear(),start.getUTCMonth(),1));
    while(d<=end){months.push(new Date(d));d.setUTCMonth(d.getUTCMonth()+1);}
    for(const m of months){
      const mStart=new Date(Date.UTC(m.getUTCFullYear(),m.getUTCMonth(),1));
      const mEnd=new Date(Date.UTC(m.getUTCFullYear(),m.getUTCMonth()+1,1));
      const lo=mStart<start?start:mStart, hi=mEnd>end?new Date(end.getTime()+86400000):mEnd;
      const tag=`${lo.toISOString().slice(0,10)}_${new Date(hi.getTime()-86400000).toISOString().slice(0,10)}`;
      const dir=path.join(out,instrument,tag);fs.mkdirSync(dir,{recursive:true});
      const file=path.join(dir,`${instrument}_${tag}_tick.csv`);
      console.log(`Downloading month ${tag}, concurrency=1`);
      await duk.getHistoricalRates({instrument,dates:{from:lo,to:hi},timeframe:'tick',format:'csv',ignoreFlats:false,volume:true,cache:true,savePath:file,batchSize:1});
    }
    console.log('Monthly downloads complete. Run validation; do not concatenate sessions across missing days.');
    return;
  }
  usage();
}
main().catch(e=>{console.error('STOP:',e.message);process.exitCode=2;});
