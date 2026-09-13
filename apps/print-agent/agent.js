const http = require('http');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PORT = Number(process.env.SWIFTTILL_PRINT_AGENT_PORT || 9721);
const ROOT = path.resolve(__dirname, '../..');
const SPOOL = path.join(ROOT, 'storage', 'print-spool');
const MODE = process.env.SWIFTTILL_PRINTER_MODE || 'spool-only'; // spool-only | windows-print
function ensureDir(p){ if(!fs.existsSync(p)) fs.mkdirSync(p,{recursive:true}); }
function json(res, status, data){ res.writeHead(status, { 'Content-Type':'application/json; charset=utf-8', 'Access-Control-Allow-Origin':'*', 'Access-Control-Allow-Methods':'GET,POST,OPTIONS', 'Access-Control-Allow-Headers':'Content-Type,Authorization' }); res.end(JSON.stringify(data)); }
function readBody(req){ return new Promise((resolve,reject)=>{ let body=''; req.on('data', c=>{ body+=c; if(body.length>2*1024*1024) reject(new Error('Payload too large')); }); req.on('end',()=>{ try{ resolve(body?JSON.parse(body):{}); }catch(e){ reject(new Error('Invalid JSON')); } }); }); }
function printWithWindowsDefault(file, cb){
  const ps = `Start-Process -FilePath '${file.replace(/'/g,"''")}' -Verb Print -WindowStyle Hidden`;
  execFile('powershell.exe', ['-NoProfile','-ExecutionPolicy','Bypass','-Command', ps], { windowsHide:true }, cb);
}
async function handle(req,res){
  if(req.method==='OPTIONS') return json(res,204,{});
  if(req.url==='/health') return json(res,200,{ ok:true, app:'SwiftTill Print Agent', version:'19.0.0', mode:MODE, port:PORT, spool:SPOOL });
  if(req.url==='/test' && req.method==='POST'){ req.url='/print'; }
  if(req.url==='/print' && req.method==='POST'){
    try{
      const body=await readBody(req); ensureDir(SPOOL);
      const stamp=new Date().toISOString().replace(/[:.]/g,'-');
      const txt=String(body.text || '').trim() || 'SwiftTill receipt';
      const html=String(body.html || '').trim();
      const txtFile=path.join(SPOOL, `receipt-${stamp}.txt`);
      const htmlFile=path.join(SPOOL, `receipt-${stamp}.html`);
      fs.writeFileSync(txtFile, txt, 'utf8');
      if(html) fs.writeFileSync(htmlFile, html, 'utf8');
      if(MODE==='windows-print'){
        return printWithWindowsDefault(txtFile, err => {
          if(err) return json(res,500,{ ok:false, error:err.message, spooled:txtFile });
          json(res,200,{ ok:true, printed:true, spooled:txtFile });
        });
      }
      return json(res,200,{ ok:true, printed:false, mode:MODE, spooled:txtFile, note:'Set SWIFTTILL_PRINTER_MODE=windows-print for default Windows printer.' });
    }catch(e){ return json(res,500,{ ok:false, error:e.message }); }
  }
  json(res,404,{ ok:false, error:'Not found' });
}
ensureDir(SPOOL);
http.createServer(handle).listen(PORT,()=>console.log(`SwiftTill Print Agent: http://127.0.0.1:${PORT}/health (${MODE})`));
