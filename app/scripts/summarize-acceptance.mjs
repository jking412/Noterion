import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {createReadStream} from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const app=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const runs=process.argv.slice(2);
if(!runs.length)throw Error('Pass completed run IDs');
const results=[];
for(const run of runs){
  const root=path.join(app,'validation/evidence',run);
  const result=JSON.parse(await fs.readFile(path.join(root,'result.json'),'utf8'));
  const assertions=JSON.parse(await fs.readFile(path.join(root,'assertions.json'),'utf8').catch(()=> '[]'));
  const events=(await fs.readFile(path.join(root,'rust-events.jsonl'),'utf8')).trim().split(/\r?\n/).filter(Boolean).map(JSON.parse);
  let samples=0,peakWorkingSet=0,peakPrivate=0,peakHostWorkingSet=0;
  for(const file of (await fs.readdir(root)).filter(name=>/^resources-\d+\.jsonl$/.test(name))){
    for(const line of (await fs.readFile(path.join(root,file),'utf8')).replace(/^\uFEFF/,'').trim().split(/\r?\n/).filter(Boolean)){
      const sample=JSON.parse(line),processes=sample.processes.filter(p=>['noterion.exe','msedgewebview2.exe'].includes(p.Name.toLowerCase()));
      samples++;peakWorkingSet=Math.max(peakWorkingSet,processes.reduce((n,p)=>n+Number(p.WorkingSetSize),0));peakPrivate=Math.max(peakPrivate,processes.reduce((n,p)=>n+Number(p.PrivatePageCount),0));
      peakHostWorkingSet=Math.max(peakHostWorkingSet,...processes.filter(p=>p.Name.toLowerCase()==='noterion.exe').map(p=>Number(p.WorkingSetSize)));
    }
  }
  results.push({run,...result,assertions,resourceObservations:{samples,peakWorkingSet,peakPrivate,peakHostWorkingSet,note:'Sum of process working sets includes shared pages; it is not unique physical memory. Node/driver/sampler excluded.'},fileReads:events.filter(e=>e.event==='file-read'),fileCopies:events.filter(e=>e.event==='file-copy')});
}
const digest=createHash('sha256');for await(const bytes of createReadStream(path.join(app,'dist-desktop/noterion.exe')))digest.update(bytes);
const summary={generatedAt:new Date().toISOString(),exeSha256:digest.digest('hex'),results};
await fs.writeFile(path.join(app,'validation/final-summary.json'),JSON.stringify(summary,null,2)+'\n');
console.log(JSON.stringify({exeSha256:summary.exeSha256,runs:results.map(r=>({run:r.run,verdict:r.verdict,assertions:r.assertions.length,launches:r.launches,resources:r.resourceObservations}))},null,2));
