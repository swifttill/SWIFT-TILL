const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');

const ROOT = path.resolve(__dirname, '../..');
const CONFIG_PATH = path.join(ROOT, 'print-agent.config.json');
const STORAGE = path.join(ROOT, 'storage');
const SPOOL = path.join(STORAGE, 'print-spool');
const PRINTED = path.join(SPOOL, 'printed');
const FAILED = path.join(SPOOL, 'failed');
const LOG_DIR = path.join(STORAGE, 'print-logs');
const OFFLINE_BACKUPS = path.join(STORAGE, 'offline-backups');
const VERSION = '44.0.0-offline-auth-safe-counter-agent';

function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p,{recursive:true}); }
function loadConfig(){
  try { if(fs.existsSync(CONFIG_PATH)) return JSON.parse(fs.readFileSync(CONFIG_PATH,'utf8')); }
  catch(e){ console.log('Config read failed:', e.message); }
  return {};
}
const CONFIG = loadConfig();
function cfg(name, fallback=''){
  return String(process.env[name] || CONFIG[name] || fallback).trim();
}
const PORT = Number(cfg('SWIFTTILL_PRINT_AGENT_PORT', '9721'));
const CLOUD_URL = cfg('SWIFTTILL_CLOUD_URL', 'https://swift-till.onrender.com').replace(/\/$/, '');
const AGENT_KEY = cfg('SWIFTTILL_PRINT_AGENT_KEY', cfg('PRINT_AGENT_KEY', ''));
const PRINTER_NAME = cfg('SWIFTTILL_PRINTER_NAME', '');
const MODE = cfg('SWIFTTILL_PRINTER_MODE', 'windows-text'); // windows-text | spool-only
const POLL_MS = Math.max(1200, Number(cfg('SWIFTTILL_PRINT_POLL_MS', '1800')));
const NOTEPAD_FALLBACK = cfg('SWIFTTILL_NOTEPAD_FALLBACK', '0') === '1';
let polling = false;
let lastPollAt = '';
let lastError = '';
let printedCount = 0;
let failedCount = 0;

ensureDir(SPOOL); ensureDir(PRINTED); ensureDir(FAILED); ensureDir(LOG_DIR); ensureDir(OFFLINE_BACKUPS);

function log(line){
  const msg = `[${new Date().toISOString()}] ${line}`;
  console.log(msg);
  try { fs.appendFileSync(path.join(LOG_DIR, 'agent.log'), msg + os.EOL, 'utf8'); } catch {}
}
function corsOrigin(res){
  const origin = String(res.__origin || '').replace(/\/$/, '');
  const allowed = new Set([CLOUD_URL, 'http://127.0.0.1:'+PORT, 'http://localhost:'+PORT, 'http://127.0.0.1:8080', 'http://localhost:8080']);
  if(!origin) return '*';
  return allowed.has(origin) ? origin : 'http://127.0.0.1:'+PORT;
}
function json(res, status, data){
  res.writeHead(status, {
    'Content-Type':'application/json; charset=utf-8',
    'Access-Control-Allow-Origin':corsOrigin(res),
    'Vary':'Origin',
    'Access-Control-Allow-Methods':'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers':'Content-Type,Authorization,X-Print-Agent-Key'
  });
  res.end(JSON.stringify(data, null, 2));
}
function readBody(req){
  return new Promise((resolve,reject)=>{ let body=''; req.on('data', c=>{ body+=c; if(body.length>6*1024*1024) reject(new Error('Payload too large')); }); req.on('end',()=>{ try{ resolve(body?JSON.parse(body):{}); }catch(e){ reject(new Error('Invalid JSON body')); } }); });
}
function execPs(script, timeout=12000){
  return new Promise((resolve,reject)=>{
    execFile('powershell.exe', ['-NoProfile','-NonInteractive','-Command', script], { windowsHide:true, timeout }, (err, stdout, stderr)=>{
      if(err) return reject(new Error((stderr || err.message || '').trim() || 'PowerShell failed'));
      resolve(String(stdout || '').trim());
    });
  });
}
function psQuote(s){ return String(s).replace(/'/g, "''"); }
async function defaultPrinter(){
  if(process.platform !== 'win32') return '';
  try{
    const out = await execPs("$p=Get-CimInstance Win32_Printer | Where-Object {$_.Default -eq $true} | Select-Object -First 1 -ExpandProperty Name; if($p){$p}", 7000);
    return out.split(/\r?\n/).filter(Boolean)[0] || '';
  }catch(e){ return ''; }
}
async function printerList(){
  if(process.platform !== 'win32') return [];
  try{
    const out = await execPs("Get-CimInstance Win32_Printer | Select-Object Name,Default,WorkOffline,PrinterStatus | ConvertTo-Json -Compress", 9000);
    if(!out) return [];
    const parsed = JSON.parse(out);
    return Array.isArray(parsed) ? parsed : [parsed];
  }catch(e){ return []; }
}
function stripHtml(html=''){
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi,'')
    .replace(/<script[\s\S]*?<\/script>/gi,'')
    .replace(/<br\s*\/?\s*>/gi,'\n')
    .replace(/<\/p>|<\/div>|<\/tr>|<\/h\d>/gi,'\n')
    .replace(/<[^>]+>/g,'')
    .replace(/&nbsp;/g,' ').replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
    .replace(/[ \t]+\n/g,'\n').replace(/\n{3,}/g,'\n\n').trim();
}
function padRight(s,w){ s=String(s); return s.length>=w?s.slice(0,w):s+' '.repeat(w-s.length); }
function padLeft(s,w){ s=String(s); return s.length>=w?s.slice(0,w):' '.repeat(w-s.length)+s; }
function center(s,w=42){ s=String(s||''); if(s.length>=w) return s.slice(0,w); const l=Math.floor((w-s.length)/2); return ' '.repeat(l)+s; }
function money(n){ return `Rs ${Math.round(Number(n||0)).toLocaleString('en-PK')}`; }
function line(w=42){ return '-'.repeat(w); }
function receiptToText(r={}){
  const w = Number(cfg('SWIFTTILL_RECEIPT_WIDTH_CHARS','42')) || 42;
  const lines=[];
  lines.push(center(r.business || r.legalName || 'SwiftTill POS', w));
  if(r.branchName) lines.push(center(r.branchName,w));
  if(r.phone) lines.push(center(r.phone,w));
  if(r.address) lines.push(center(r.address,w));
  lines.push(line(w));
  lines.push(`${padRight(r.unpaid?'UNPAID BILL':'PAID RECEIPT', w-12)}${padLeft('#'+(r.number||''),12)}`);
  if(r.type) lines.push(`${padRight('Type',14)} ${r.type}`);
  if(r.table) lines.push(`${padRight('Table',14)} ${r.table}`);
  if(r.cashier) lines.push(`${padRight('Cashier',14)} ${r.cashier}`);
  if(r.orderTaker) lines.push(`${padRight('Order Taker',14)} ${r.orderTaker}`);
  lines.push(`${padRight('Date',14)} ${new Date(r.date || Date.now()).toLocaleString()}`);
  lines.push(line(w));
  for(const item of (r.lines||[])){
    const name = String(item.name || 'Item');
    const qty = Number(item.qty || 1);
    const rate = Number(item.price || 0) + (item.modifiers||[]).reduce((s,m)=>s+Number(m.price||0),0);
    const total = rate * qty;
    lines.push(name.length>w ? name.slice(0,w) : name);
    lines.push(`${padRight(`${qty} x ${money(rate)}`, w-13)}${padLeft(money(total),13)}`);
    for(const m of (item.modifiers||[])) lines.push(`  + ${m.name} ${money(m.price||0)}`.slice(0,w));
    if(item.notes) lines.push(`  Note: ${item.notes}`.slice(0,w));
  }
  const t = r.totals || {};
  lines.push(line(w));
  lines.push(`${padRight('Subtotal', w-14)}${padLeft(money(t.subtotal||0),14)}`);
  if(Number(t.deliveryFee||0)) lines.push(`${padRight('Delivery', w-14)}${padLeft(money(t.deliveryFee||0),14)}`);
  if(Number(t.discount||0)) lines.push(`${padRight('Discount', w-14)}${padLeft('-'+money(t.discount||0),14)}`);
  lines.push(`${padRight('TOTAL', w-14)}${padLeft(money(t.total||0),14)}`);
  if((r.payments||[]).length){
    lines.push(line(w));
    lines.push('PAYMENT');
    for(const p of r.payments){
      lines.push(`${padRight(p.method||'', w-14)}${padLeft(money(p.amount||0),14)}`);
      if(Number(p.received||0) && Number(p.received||0)!==Number(p.amount||0)) lines.push(`${padRight('Received', w-14)}${padLeft(money(p.received||0),14)}`);
      if(Number(p.change||0)) lines.push(`${padRight('Change', w-14)}${padLeft(money(p.change||0),14)}`);
    }
  }
  lines.push(line(w));
  lines.push(center(r.footer || 'Thank you. Visit again.', w));
  lines.push(center('Powered by SwiftTill POS', w));
  lines.push('\n\n');
  return lines.join('\n');
}
function payloadText(payload){
  if(payload.text && String(payload.text).trim()) return String(payload.text).trim() + '\n\n';
  if(payload.receipt) return receiptToText(payload.receipt);
  if(payload.html) return stripHtml(payload.html) + '\n\n';
  return 'SwiftTill POS receipt\n\n';
}
function writeJobFiles(payload){
  const stamp=new Date().toISOString().replace(/[:.]/g,'-');
  const id=String(payload.id||payload.jobId||payload.type||'receipt').replace(/[^a-z0-9_-]/gi,'-');
  const txt = payloadText(payload);
  const base = `${id}-${stamp}`;
  const txtFile = path.join(SPOOL, `${base}.txt`);
  fs.writeFileSync(txtFile, txt, 'utf8');
  let htmlFile = '';
  if(payload.html){ htmlFile = path.join(SPOOL, `${base}.html`); fs.writeFileSync(htmlFile, String(payload.html), 'utf8'); }
  return { txtFile, htmlFile, text: txt, base };
}
async function printTextFile(txtFile){
  if(MODE === 'spool-only') return { printed:false, mode:MODE, reason:'spool-only mode' };
  if(process.platform !== 'win32') return { printed:false, mode:MODE, reason:'not Windows' };
  const target = PRINTER_NAME || await defaultPrinter();
  if(!target) throw new Error('No Windows default printer found. Set thermal printer as default printer.');
  const script = `$ErrorActionPreference='Stop'; $file='${psQuote(txtFile)}'; $printer='${psQuote(target)}'; Get-Content -LiteralPath $file | Out-Printer -Name $printer; Write-Output $printer`;
  try{
    const out = await execPs(script, 20000);
    return { printed:true, printer: out.split(/\r?\n/).filter(Boolean).pop() || target, method:'Out-Printer' };
  }catch(e){
    if(!NOTEPAD_FALLBACK) throw e;
    const fallback = `Start-Process -FilePath notepad.exe -ArgumentList '/p','${psQuote(txtFile)}' -WindowStyle Hidden; Start-Sleep -Seconds 2; Write-Output 'notepad-fallback'`;
    await execPs(fallback, 20000);
    return { printed:true, printer: target, method:'notepad-/p-fallback' };
  }
}
async function printPayload(payload){
  const spooled = writeJobFiles(payload);
  try{
    const result = await printTextFile(spooled.txtFile);
    if(result.printed){
      printedCount += 1;
      const dest = path.join(PRINTED, path.basename(spooled.txtFile));
      try { fs.copyFileSync(spooled.txtFile, dest); } catch {}
      return { ok:true, printed:true, printer:result.printer || '', method:result.method || MODE, spooled:spooled.txtFile };
    }
    return { ok:true, printed:false, mode:result.mode || MODE, reason:result.reason || '', spooled:spooled.txtFile };
  }catch(e){
    failedCount += 1; lastError = e.message;
    try { fs.copyFileSync(spooled.txtFile, path.join(FAILED, path.basename(spooled.txtFile))); } catch {}
    return { ok:false, printed:false, error:e.message, spooled:spooled.txtFile, note:'Job saved in spool. Fix printer/default printer and retry.' };
  }
}
async function completeCloudJob(job, result){
  const res = await fetch(`${CLOUD_URL}/api/print-jobs/complete`, {
    method:'POST',
    headers:{ 'Content-Type':'application/json', 'X-Print-Agent-Key':AGENT_KEY },
    body:JSON.stringify({ id:job.id, ok:!!result.ok && result.printed !== false, error:result.error || result.reason || '' })
  });
  if(!res.ok) throw new Error(`Cloud complete failed: ${res.status}`);
}
async function pollCloudQueue(){
  if(!AGENT_KEY || polling) return;
  polling = true; lastPollAt = new Date().toISOString();
  try{
    const res = await fetch(`${CLOUD_URL}/api/print-jobs/next`, { headers:{ 'X-Print-Agent-Key': AGENT_KEY } });
    const out = await res.json().catch(()=>({ok:false,error:'Invalid cloud response'}));
    if(!res.ok || out.ok===false){ lastError = out.error || res.statusText; log('Cloud print poll: ' + lastError); return; }
    const job = out.job;
    if(!job) return;
    log(`Printing cloud job ${job.id} (${job.type || 'receipt'}) attempt ${job.attempts || 1}`);
    const result = await printPayload({ id:job.id, type:job.type, html:job.html, text:job.text, receipt:job.receipt });
    await completeCloudJob(job, result);
    if(result.ok) log(`Cloud job ${job.id} printed/spooled: ${result.spooled || ''}`);
    else log(`Cloud job ${job.id} failed: ${result.error || result.reason || ''}`);
  }catch(e){ lastError = e.message; log('Cloud print queue unavailable: ' + e.message); }
  finally { polling = false; }
}

function checksum(text){ text=String(text||''); let a=2166136261>>>0; for(let i=0;i<text.length;i++){ a^=text.charCodeAt(i); a=Math.imul(a,16777619)>>>0; } return text.length+':'+a.toString(16); }
function writeOfflineBackup(payload={}){
  const day = new Date().toISOString().slice(0,10);
  const dir = path.join(OFFLINE_BACKUPS, day);
  ensureDir(dir);
  const stamp = new Date().toISOString().replace(/[:.]/g,'-');
  const device = String(payload.deviceId || 'counter').replace(/[^a-z0-9_-]/gi,'-').slice(0,50);
  const base = `${device}-${stamp}`;
  const file = path.join(dir, `${base}.json`);
  const tmp = file + '.tmp';
  const backup = { app:'SwiftTill POS', type:'offline-local-backup', agentVersion:VERSION, savedAt:new Date().toISOString(), safeMode:true, ...payload };
  const body = JSON.stringify(backup, null, 2);
  backup.agentChecksum = checksum(body);
  const finalBody = JSON.stringify(backup, null, 2);
  fs.writeFileSync(tmp, finalBody, 'utf8');
  fs.renameSync(tmp, file);
  fs.writeFileSync(path.join(dir, `${device}-latest.json.tmp`), finalBody, 'utf8');
  fs.renameSync(path.join(dir, `${device}-latest.json.tmp`), path.join(dir, `${device}-latest.json`));
  fs.appendFileSync(path.join(OFFLINE_BACKUPS, 'offline-ledger.ndjson'), JSON.stringify({ file, savedAt:backup.savedAt, device, bytes:Buffer.byteLength(finalBody), checksum:backup.agentChecksum, reason:payload.reason || '' }) + os.EOL, 'utf8');
  return { ok:true, file, bytes:Buffer.byteLength(finalBody), checksum:backup.agentChecksum, backupRoot:OFFLINE_BACKUPS, latest:path.join(dir, `${device}-latest.json`) };
}


function latestOfflineBackup(){
  const ledger = path.join(OFFLINE_BACKUPS, 'offline-ledger.ndjson');
  const candidates = [];
  try{
    if(fs.existsSync(ledger)){
      const lines = fs.readFileSync(ledger,'utf8').trim().split(/\r?\n/).filter(Boolean).slice(-200).reverse();
      for(const line of lines){ try{ const rec=JSON.parse(line); if(rec.file && fs.existsSync(rec.file)) candidates.push(rec.file); }catch{} }
    }
    const days = fs.readdirSync(OFFLINE_BACKUPS).filter(d=>/^\d{4}-\d{2}-\d{2}$/.test(d)).sort().reverse();
    for(const day of days){
      const dir = path.join(OFFLINE_BACKUPS, day);
      for(const f of fs.readdirSync(dir).filter(x=>x.endsWith('-latest.json') || x.endsWith('.json')).sort().reverse()) candidates.push(path.join(dir,f));
    }
  }catch{}
  const file = candidates.find(Boolean);
  if(!file) return null;
  try{ return { file, backup:JSON.parse(fs.readFileSync(file,'utf8')) }; }catch{return { file, error:'Backup file could not be parsed' };}
}

function countFiles(dir){ try { return fs.readdirSync(dir).filter(f=>fs.statSync(path.join(dir,f)).isFile()).length; } catch { return 0; } }
async function health(){
  const printers = await printerList();
  const def = PRINTER_NAME || await defaultPrinter();
  return {
    ok:true,
    app:'SwiftTill Print Agent',
    version:VERSION,
    port:PORT,
    mode:MODE,
    platform:process.platform,
    node:process.version,
    cloudUrl:CLOUD_URL,
    cloudPolling:Boolean(AGENT_KEY),
    pollMs:POLL_MS,
    lastPollAt,
    lastError,
    printer:{ configuredName:PRINTER_NAME || '', defaultPrinter:def, detected:Boolean(def), count:printers.length, printers },
    spool:{ path:SPOOL, pending:countFiles(SPOOL), printed:countFiles(PRINTED), failed:countFiles(FAILED), printedCount, failedCount }, offlineBackups:{ path:OFFLINE_BACKUPS, days:fs.existsSync(OFFLINE_BACKUPS)?fs.readdirSync(OFFLINE_BACKUPS).length:0 }
  };
}
async function handle(req,res){
  res.__origin = req.headers.origin || '';
  if(req.method==='OPTIONS') return json(res,204,{});
  if(req.url==='/health' && req.method==='GET') return json(res,200, await health());
  if(req.url==='/printers' && req.method==='GET') return json(res,200, { ok:true, printers:await printerList(), defaultPrinter:await defaultPrinter() });
  if(req.url==='/test' && (req.method==='GET' || req.method==='POST')){
    const result = await printPayload({ id:'test', receipt:{ business:'SwiftTill POS', branchName:'Printer Test', number:'TEST', type:'TEST', date:new Date().toISOString(), cashier:'Print Agent', lines:[{name:'Thermal printer test', qty:1, price:1, modifiers:[]}], totals:{subtotal:1,discount:0,deliveryFee:0,total:1}, payments:[], footer:'If this prints, setup is ready.' }});
    return json(res,result.ok?200:500,result);
  }
  if(req.url==='/print' && req.method==='POST'){
    const body = await readBody(req);
    const result = await printPayload(body);
    return json(res,result.ok?200:500,result);
  }
  if(req.url==='/offline-backup' && req.method==='POST'){
    const body = await readBody(req);
    const result = writeOfflineBackup(body);
    return json(res,200,result);
  }
  if(req.url==='/offline-backups/latest' && req.method==='GET'){
    const latest = latestOfflineBackup();
    if(!latest) return json(res,404,{ ok:false, error:'No offline backup found' });
    if(latest.error) return json(res,500,{ ok:false, error:latest.error, file:latest.file });
    return json(res,200,{ ok:true, file:latest.file, backup:latest.backup });
  }
  if(req.url==='/offline-backups/status' && req.method==='GET'){
    const latest = latestOfflineBackup();
    return json(res,200,{ ok:true, path:OFFLINE_BACKUPS, latestFile:latest?.file || '', hasBackup:Boolean(latest?.backup) });
  }
  if(req.url==='/retry-spool' && req.method==='POST'){
    const files = fs.readdirSync(FAILED).filter(f=>f.endsWith('.txt')).slice(0,10);
    const results=[];
    for(const f of files){
      const file = path.join(FAILED,f);
      try{ const pr = await printTextFile(file); results.push({file:f, ok:true, ...pr}); }
      catch(e){ results.push({file:f, ok:false, error:e.message}); }
    }
    return json(res,200,{ ok:true, retried:results });
  }
  return json(res,404,{ ok:false, error:'Not found' });
}
http.createServer((req,res)=>handle(req,res).catch(e=>json(res,500,{ok:false,error:e.message}))).listen(PORT,'127.0.0.1',()=>{
  log(`SwiftTill Print Agent ${VERSION}: http://127.0.0.1:${PORT}/health`);
  log(`Cloud POS: ${CLOUD_URL}`);
  log(`Mode: ${MODE}; Printer: ${PRINTER_NAME || 'Windows default printer'}`);
  log(AGENT_KEY ? `Cloud queue polling every ${POLL_MS}ms` : 'Cloud queue disabled: set SWIFTTILL_PRINT_AGENT_KEY to enable Render-to-printer polling.');
  if(AGENT_KEY){ setTimeout(pollCloudQueue, 600); setInterval(pollCloudQueue, POLL_MS); }
});
