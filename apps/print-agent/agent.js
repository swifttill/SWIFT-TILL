const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = Number(process.env.SWIFTTILL_PRINT_AGENT_PORT || 9721);
const CLOUD_URL = String(process.env.SWIFTTILL_CLOUD_URL || 'https://swift-till.onrender.com').replace(/\/$/, '');
const AGENT_KEY = String(process.env.SWIFTTILL_PRINT_AGENT_KEY || process.env.PRINT_AGENT_KEY || '').trim();
const ROOT = path.resolve(__dirname, '../..');
const SPOOL = path.join(ROOT, 'storage', 'print-spool');
const MODE = process.env.SWIFTTILL_PRINTER_MODE || 'windows-print'; // spool-only | windows-print
const POLL_MS = Math.max(1000, Number(process.env.SWIFTTILL_PRINT_POLL_MS || 2000));
let polling = false;

function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p,{recursive:true}); }
function json(res, status, data){ res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,POST,OPTIONS', 'Access-Control-Allow-Headers':'Content-Type,Authorization,X-Print-Agent-Key' }); res.end(JSON.stringify(data)); }
function readBody(req){ return new Promise((resolve,reject)=>{ let body=''; req.on('data', c=>{ body+=c; if(body.length>4*1024*1024) reject(new Error('Payload too large')); }); req.on('end',()=>{ try{ resolve(body?JSON.parse(body):{}); }catch(e){ reject(new Error('Invalid JSON')); } }); }); }
function stripHtml(html=''){ return String(html).replace(/<br\s*\/?\s*>/gi,'\n').replace(/<\/div>/gi,'\n').replace(/<[^>]+>/g,'').replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/\n{3,}/g,'\n\n').trim(); }
function writeSpool(payload){ ensureDir(SPOOL); const stamp=new Date().toISOString().replace(/[:.]/g,'-'); const id=(payload.id||payload.jobId||'receipt').replace(/[^a-z0-9_-]/gi,'-'); const txt=String(payload.text || '').trim() || stripHtml(payload.html) || 'SwiftTill receipt'; const html=String(payload.html || '').trim(); const txtFile=path.join(SPOOL, `${id}-${stamp}.txt`); const htmlFile=path.join(SPOOL, `${id}-${stamp}.html`); fs.writeFileSync(txtFile, txt, 'utf8'); if(html) fs.writeFileSync(htmlFile, html, 'utf8'); return { txtFile, htmlFile: html ? htmlFile : '', text: txt }; }
function printWithWindowsDefault(file){ return new Promise((resolve,reject)=>{ const ps = `Start-Process -FilePath '${file.replace(/'/g,"''")}' -Verb Print -WindowStyle Hidden`; execFile('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-Command', ps], { windowsHide:true }, err => err ? reject(err) : resolve()); }); }
async function printPayload(payload){ const spooled = writeSpool(payload); if(MODE==='windows-print'){ await printWithWindowsDefault(spooled.txtFile); return { ok:true, printed:true, spooled:spooled.txtFile }; } return { ok:true, printed:false, mode:MODE, spooled:spooled.txtFile, note:'Spool-only mode. Set SWIFTTILL_PRINTER_MODE=windows-print for direct Windows printing.' }; }
async function completeCloudJob(job, result){ await fetch(`${CLOUD_URL}/api/print-jobs/complete`, { method:'POST', headers:{ 'Content-Type':'application/json', 'X-Print-Agent-Key':AGENT_KEY }, body:JSON.stringify({ id:job.id, ok:!!result.ok, error:result.error || '' }) }); }
async function pollCloudQueue(){ if(!AGENT_KEY || polling) return; polling = true; try{ const res = await fetch(`${CLOUD_URL}/api/print-jobs/next`, { headers:{ 'X-Print-Agent-Key': AGENT_KEY } }); const out = await res.json().catch(()=>({ok:false,error:'Invalid cloud response'})); if(!res.ok || out.ok===false) { console.log('Cloud print poll:', out.error || res.statusText); return; } const job = out.job; if(!job) return; console.log(`Printing cloud job ${job.id} (${job.type || 'receipt'})`); try{ const result = await printPayload({ id:job.id, type:job.type, html:job.html, text:job.text, receipt:job.receipt }); await completeCloudJob(job, result); console.log(`Printed cloud job ${job.id}`); }catch(e){ await completeCloudJob(job, { ok:false, error:e.message }); console.error(`Print job ${job.id} failed:`, e.message); } }catch(e){ console.log('Cloud print queue unavailable:', e.message); } finally { polling = false; } }
async function handle(req,res){
  if(req.method==='OPTIONS') return json(res,204,{});
  if(req.url==='/health') return json(res,200,{ ok:true, app:'SwiftTill Print Agent', version:'24.0.0', mode:MODE, port:PORT, cloudUrl:CLOUD_URL, cloudPolling:Boolean(AGENT_KEY), spool:SPOOL });
  if(req.url==='/test' && req.method==='POST'){ req.url='/print'; }
  if(req.url==='/print' && req.method==='POST'){
    try{ const body=await readBody(req); const result=await printPayload(body); return json(res,200,result); }
    catch(e){ return json(res,500,{ ok:false, error:e.message }); }
  }
  json(res,404,{ ok:false, error:'Not found' });
}
ensureDir(SPOOL);
http.createServer(handle).listen(PORT,()=>{
  console.log(`SwiftTill Print Agent: http://127.0.0.1:${PORT}/health (${MODE})`);
  console.log(`Cloud POS: ${CLOUD_URL}`);
  console.log(AGENT_KEY ? `Cloud queue polling every ${POLL_MS}ms` : 'Cloud queue disabled: set SWIFTTILL_PRINT_AGENT_KEY to enable Render-to-printer polling.');
  if(AGENT_KEY) setInterval(pollCloudQueue, POLL_MS);
});
