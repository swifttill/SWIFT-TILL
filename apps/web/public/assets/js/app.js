const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');
const toastBox = $('#toast');
let token = localStorage.getItem('swifttill_token') || '';
let state = null;
let screen = 'pos';
let centerMode = 'menu';
let categoryId = 'all';
let currentOrder = null;
let adminTab = 'dashboard';
let reportType = 'daily';
let mobileBillOpen = false;
let selectedOrderType = 'DINE_IN';
let lastReceipt = null;
let busyCount = 0;
let lastActionAt = 0;
let pendingActions = new Set();
function ensurePrintArea(){
  const areas = $$('#printArea');
  const bodyArea = areas.find(x => x.parentElement === document.body);
  areas.filter(x => x !== bodyArea).forEach(x => x.remove());
  if(bodyArea){ bodyArea.className = 'print-only'; return bodyArea; }
  const el = document.createElement('div');
  el.id = 'printArea';
  el.className = 'print-only';
  document.body.appendChild(el);
  return el;
}
function ensureBusyLayer(){ let el = document.getElementById('globalBusy'); if(!el){ el = document.createElement('div'); el.id='globalBusy'; el.innerHTML='<div class="busy-card"><div class="busy-bar"><span></span></div><b>Saving...</b><p>Fast cloud action in progress.</p></div>'; document.body.appendChild(el); } return el; }
function setBusy(on){ busyCount = Math.max(0, busyCount + (on ? 1 : -1)); const el = ensureBusyLayer(); el.classList.toggle('show', busyCount > 0); document.body.classList.toggle('is-busy', busyCount > 0); }
function beginAction(key){ if(pendingActions.has(key)) return false; pendingActions.add(key); return true; }
function endAction(key){ pendingActions.delete(key); }
function hasOrderLines(o=currentOrder){ return Array.isArray(o?.lines) && o.lines.some(l => Number(l.qty||0) > 0); }
function requireOrderLines(message='Add at least one item before continuing'){ if(!hasOrderLines()){ toast(message, true); return false; } return true; }
function numericPrice(v){ return Math.round((Number(v)||0)*100)/100; }
function hasPositiveTotal(o=currentOrder){ return calcTotals(o).total > 0; }
function requirePositiveTotal(message='Order total must be greater than Rs 0. Set item/deal price in Admin first.'){ if(!hasPositiveTotal()){ toast(message, true); return false; } return true; }
function requireNotRapidClick(){ const n=Date.now(); if(n-lastActionAt<350) return false; lastActionAt=n; return true; }

function isMobileViewport(){ return window.matchMedia('(max-width: 760px)').matches; }
function setMobileBill(open){
  mobileBillOpen = !!open;
  document.body.classList.toggle('mobile-bill-open', mobileBillOpen);
  const shell = document.querySelector('.app-shell');
  if(shell) shell.classList.toggle('cart-open', mobileBillOpen);
}
function mobileCartSummary(){
  const lines = currentOrder?.lines?.reduce((s,l)=>s+Number(l.qty||0),0) || 0;
  const total = currentOrder ? calcTotals(currentOrder).total : 0;
  return `${lines} item${lines===1?'':'s'} • ${money(total)}`;
}

function categoryTone(name=''){
  const n = String(name || '').toLowerCase();
  if(/burger|sandwich|wrap|zinger|beef|chicken/.test(n)) return 'tone-burger';
  if(/fries|side|loaded|wings|roll|snack|chips/.test(n)) return 'tone-fries';
  if(/drink|beverage|cola|coke|pepsi|water|juice|shake|tea|coffee/.test(n)) return 'tone-drinks';
  if(/dessert|cake|sweet|ice|cream|cup|brownie/.test(n)) return 'tone-dessert';
  if(/pizza|pasta|italian/.test(n)) return 'tone-pizza';
  if(/deal|combo|meal|offer|family/.test(n)) return 'tone-deal';
  return 'tone-default';
}
function actionIcon(name){ return `<span class="btn-ico">${name}</span>`; }

function money(v){ return `Rs ${Number(v||0).toLocaleString('en-PK',{maximumFractionDigits:0})}`; }
function esc(v){ return String(v ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
function uid(){ return 'ln_' + Math.random().toString(16).slice(2) + Date.now().toString(16); }
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function can(p){ return state?.permissions?.includes(p); }
function toast(msg, bad=false){ toastBox.textContent = msg; toastBox.className = bad ? 'bad show' : 'show'; setTimeout(()=>toastBox.className='',2600); }
async function api(path, data, method='POST'){
  if(state?.settings?.onlineOnly && !navigator.onLine) throw new Error('Internet connection required. Offline mode is disabled for this build.');
  setBusy(true);
  try{
    const res = await fetch(path, { method, headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body:data ? JSON.stringify(data) : undefined });
    if(res.headers.get('content-type')?.includes('text/csv')) return res;
    const json = await res.json().catch(()=>({ok:false,error:'Invalid server response'}));
    if(!res.ok || json.ok===false) throw new Error(json.error || 'Request failed');
    return json;
  } finally { setBusy(false); }
}
async function downloadApi(path, filename){
  setBusy(true);
  try{
    const res = await fetch(path, { headers:{ Authorization:`Bearer ${token}` } });
    if(!res.ok) throw new Error((await res.json().catch(()=>({error:'Download failed'}))).error || 'Download failed');
    const blob = await res.blob();
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
  } finally { setBusy(false); }
}
async function loadState(){ const j = await api('/api/state', null, 'GET'); state = j.data; }
async function boot(){ if(!token) return renderLogin(); try{ await loadState(); renderShell(); }catch(e){ localStorage.removeItem('swifttill_token'); token=''; renderLogin(); } }

function renderLogin(){
  app.innerHTML = `<div class="login-screen"><form class="login-card" id="loginForm">
    <div class="login-brand-text"><b>SwiftTill</b><span>POS</span></div>
    <h1>SwiftTill POS</h1><p>Production cloud POS. Configure real business data from Admin.</p>
    <div class="field"><label>Email</label><input name="email" autocomplete="username"></div>
    <div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password"></div>
    <button class="primary-btn" style="width:100%">Login</button>
    <p class="muted-note">Use the credentials issued by the system owner. Change the bootstrap password after first login.</p>
  </form></div>`;
  $('#loginForm').addEventListener('submit', async e => { e.preventDefault(); const f = new FormData(e.target); try{ const j = await api('/api/login', Object.fromEntries(f)); token = j.token; localStorage.setItem('swifttill_token', token); await boot(); }catch(err){ toast(err.message,true); } });
}
function setupBanner(){
  const s=state?.setup; if(!s || s.complete) return '';
  const labels={businessName:'Business name',branchName:'Branch name',categories:'Categories',pricedMenuItems:'Priced menu items',tables:'Tables',orderTakers:'Order takers',changeDefaultAdminPassword:'Change default admin password'};
  return `<div class="setup-banner"><div><b>Setup required before rush-hour use</b><p>${s.missing.map(x=>labels[x]||x).join(' • ')}</p></div><button class="primary-btn" onclick="screen='admin';adminTab='setup';renderShell();">Complete Setup</button></div>`;
}
function openChangePasswordModal(){
  openModal(`<div class="modal-head"><h2>Change Password</h2><button class="x" onclick="closeModal()">×</button></div><div class="field"><label>Current Password</label><input id="curPass" type="password"></div><div class="field"><label>New Password</label><input id="newPass" type="password" minlength="6"></div><button class="primary-btn" style="width:100%" id="doChangePass">Update Password</button>`);
  $('#doChangePass').onclick=async()=>{try{await api('/api/account/change-password',{currentPassword:$('#curPass').value,newPassword:$('#newPass').value});closeModal();await loadState();renderShell();toast('Password updated');}catch(e){toast(e.message,true)}};
}
async function testPrintAgent(){
  try{
    const j=await api('/api/print-agent/sample',null,'GET');
    const html=receiptHTML(j.receipt);
    const agent=(state.settings.localAgentUrl||'http://127.0.0.1:9721/print').replace(/\\/g,'/');
    const res=await fetch(agent,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({html,text:'SwiftTill print agent test receipt'})});
    const out=await res.json().catch(()=>({ok:false,error:'Invalid print-agent response'}));
    if(!res.ok||out.ok===false) throw new Error(out.error||'Print agent failed');
    toast(out.printed?'Print agent sent to printer':'Print agent spooled test receipt');
  }catch(e){
    ensurePrintArea().innerHTML=receiptHTML({business:state.settings.businessName||'SwiftTill POS',number:'TEST',date:new Date().toISOString(),lines:[{name:'Browser fallback print test',qty:1,price:1}],totals:{subtotal:1,discount:0,deliveryFee:0,total:1},payments:[],unpaid:true});
    toast('Print agent unavailable. Browser print fallback opened.', true);
    setTimeout(()=>window.print(),120);
  }
}
function renderSetup(c){
  const s=state.setup||{missing:[]}; const ck=s.checklist||{};
  c.innerHTML=`<div class="module-title"><div><h3>Restaurant Setup</h3><p class="muted-note">Complete these once before real restaurant rush-hour use.</p></div></div><div class="grid2 setup-grid"><div class="card subcard"><h3>Setup Checklist</h3>${['businessProfile','categories','menuPriced','tables','orderTakers','passwordChanged'].map(k=>`<p class="setup-line ${ck[k]?'ok-text':'danger-text'}">${ck[k]?'✓':'!'} ${esc(k.replace(/([A-Z])/g,' $1'))}</p>`).join('')}<p><b>Status:</b> ${s.complete?'Ready for operation':'Incomplete setup'}</p></div><div class="card subcard"><h3>Quick Actions</h3><button class="ghost-btn" onclick="adminTab='settings';renderAdminContent()">Company / Logo / Receipt</button><button class="ghost-btn" onclick="adminTab='categories';renderAdminContent()">Categories</button><button class="ghost-btn" onclick="adminTab='items';renderAdminContent()">Menu Items + Prices</button><button class="ghost-btn" onclick="adminTab='tables';renderAdminContent()">Tables</button><button class="ghost-btn" onclick="adminTab='takers';renderAdminContent()">Order Takers</button><button class="primary-btn" onclick="openChangePasswordModal()">Change Password</button></div><div class="card subcard"><h3>Print Agent</h3><p>Local URL: <b>${esc(state.printAgent?.localAgentUrl||state.settings.localAgentUrl||'')}</b></p><button class="primary-btn" onclick="testPrintAgent()">Test Print Agent</button><p class="muted-note">If local agent is not running, browser print fallback opens.</p></div></div>`;
}

function renderShell(){
  if(screen === 'admin') return renderAdminShell();
  app.innerHTML = `<div class="app-shell ${mobileBillOpen?'cart-open':''}">
    <aside class="panel sidebar">${renderSidebar()}</aside>
    <main class="main">${setupBanner()}<section class="panel topbar">${renderTopbar()}</section><section class="panel workspace" id="workspace"></section></main>
    <aside class="right-rail"><div class="panel rail-nav">${renderRailNav()}</div><section class="panel bill" id="billPanel"></section></aside>
    <button class="mobile-cart-fab" id="mobileCartFab" type="button"><span>🧾 Bill</span><b>${mobileCartSummary()}</b></button>
  </div><div id="modalRoot"></div>`;
  bindSidebar(); bindRailNav(); renderWorkspace(); renderBill();
  $('#mobileCartFab') && ($('#mobileCartFab').onclick = () => setMobileBill(true));
}
function renderAdminShell(){
  app.innerHTML = `<div class="admin-screen">${setupBanner()}<section class="panel topbar admin-topbar">${renderTopbar()}</section><section class="panel admin-page" id="workspace"></section></div><div id="modalRoot"></div>`;
  $('#backPosBtn') && ($('#backPosBtn').onclick = () => { screen='pos'; centerMode='menu'; renderShell(); });
  $('#logoutBtn') && ($('#logoutBtn').onclick = logout);
  $('#shiftBtn') && ($('#shiftBtn').onclick = () => state.activeShift ? openCloseShift() : openOpenShift());
  renderAdmin($('#workspace'));
}
function renderSidebar(){
  const logo = state?.settings?.logoUrl || '';
  const brand = logo ? `<img src="${esc(logo)}" alt="${esc(state?.settings?.businessName || 'SwiftTill POS')}">` : `<div class="brand-text"><b>SwiftTill</b><span>POS</span></div>`;
  return `<div class="brand">${brand}</div>
  <button class="new-order" id="newOrderBtn">＋ New Order</button>
  <div class="search"><span>⌕</span><input id="menuSearch" placeholder="Search menu items..."></div>
  <div class="sidebar-scroll">
    <div class="section-title"><h3>Categories</h3><button id="showAll">View All</button></div>
    <button class="cat-btn ${categoryId==='all'?'active':''}" data-cat="all"><span>All Items</span></button>
    ${state.categories.filter(c=>c.active).sort((a,b)=>(a.sort||0)-(b.sort||0)).map(c=>`<button class="cat-btn ${categoryTone(c.name)} ${categoryId===c.id?'active':''}" data-cat="${esc(c.id)}">${c.imageUrl?`<img src="${esc(c.imageUrl)}" alt="">`:''}<span>${esc(c.name)}</span></button>`).join('')}
    <div class="divider"></div>
    <div class="section-title"><h3>Deals</h3></div>
    <button class="cat-btn no-icon ${centerMode==='deals'?'active':''}" id="dealsBtn"><span>Special Deals</span></button>
    <button class="cat-btn no-icon" id="comboBtn"><span>Meal Combos</span></button>
  </div>`;
}
function renderRailNav(){
  const openCount = state?.openOrders?.length || 0;
  const adminAllowed = can('admin.menu') || can('admin.users') || can('admin.settings') || can('admin.roles') || can('admin.payments') || can('reports.view');
  return `<button class="${centerMode==='open'?'active':''} rail-open" data-rail="open" title="Open Orders"><span class="rail-ico">▤</span><span class="rail-label">Open Orders</span><span class="mini-badge">${openCount}</span></button>
  <button class="${screen==='admin'?'active':''} ${!adminAllowed?'locked':''} rail-admin" data-rail="admin" title="Admin Panel"><span class="rail-ico">⚙</span><span class="rail-label">Admin Panel</span></button>`;
}
function renderTopbar(){
  const d = new Date(); const active = state.activeShift;
  const back = screen === 'admin' ? `<button class="ghost-btn top-action back-pos-action" id="backPosBtn">← Back to POS</button>` : '';
  return `<div class="hello"><h2>${esc(state.settings.businessName || 'SwiftTill POS')}</h2><p>${screen==='admin'?'Back office controls, reports and setup.':'Fast billing workspace for active restaurant operations.'}</p></div>
  <div class="top-items">
    <div class="top-pill date-pill">📅 <span><b>${d.toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short',year:'numeric'})}</b>${d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span></div>
    <div class="top-pill user-pill">👤 <span><b>${esc(state.user.name)}</b>${esc(state.user.roles.join(', ') || 'User')}</span></div>
    <div class="top-pill branch-pill"><span class="status-dot"></span><span><b>${esc(state.settings.branchName)}</b>System Online</span></div>
    ${back}
    <button class="ghost-btn shift-action" id="shiftBtn">${active?'Close Shift':'Open Shift'}</button>
    <button class="ghost-btn logout-action" id="logoutBtn">Logout</button>
  </div>`;
}
function bindSidebar(){
  $('#newOrderBtn').onclick = () => openNewOrderModal();
  $$('#workspace [data-mode]').forEach(b=>b.onclick=()=>{});
  $$('[data-cat]').forEach(b => b.onclick = () => { setMobileBill(false); screen='pos'; centerMode='menu'; categoryId=b.dataset.cat; renderShell(); });
  $('#dealsBtn').onclick = () => { screen='pos'; centerMode='deals'; renderShell(); };
  $('#comboBtn').onclick = () => { screen='pos'; centerMode='deals'; renderShell(); };
  $('#showAll').onclick = () => { setMobileBill(false); categoryId='all'; centerMode='menu'; screen='pos'; renderShell(); };
  $('#menuSearch').oninput = e => { screen='pos'; centerMode='menu'; renderMenu(e.target.value); };
  $('#logoutBtn').onclick = logout;
  $('#shiftBtn').onclick = () => state.activeShift ? openCloseShift() : openOpenShift();
}
function bindRailNav(){
  $$('[data-rail]').forEach(b => b.onclick = () => {
    const r = b.dataset.rail;
    if(r==='open'){ setMobileBill(false); screen='pos'; centerMode='open'; renderShell(); }
    if(r==='admin'){
      const ok = can('admin.menu') || can('admin.users') || can('admin.settings') || can('admin.roles') || can('admin.payments') || can('reports.view');
      if(!ok) return toast('Admin permission required', true);
      setMobileBill(false); screen='admin'; adminTab = can('reports.view') && !(can('admin.menu') || can('admin.settings')) ? 'reports' : adminTab; renderShell();
    }
  });
}
function logout(){ localStorage.removeItem('swifttill_token'); location.reload(); }
function renderWorkspace(){
  const ws = $('#workspace');
  if(screen === 'reports') return renderReports(ws);
  ws.innerHTML = `<div class="seg modern-seg"><button class="${centerMode==='menu'?'active':''}" data-mode="menu"><span>🍴</span> Menu</button><button class="${centerMode==='tables'?'active':''}" data-mode="tables"><span>▦</span> Tables</button><button class="${centerMode==='deals'?'active':''}" data-mode="deals"><span>%</span> Deals</button></div><div class="crumb">⌂ ${currentOrder ? `${formatType(currentOrder.type)} › ${orderContext(currentOrder)} › Add items to order` : 'Start New Order › Select type › Add items'}</div><div class="center-scroll" id="centerScroll"></div>`;
  $$('[data-mode]', ws).forEach(b => b.onclick = () => { centerMode=b.dataset.mode; renderWorkspace(); });
  if(centerMode==='tables') renderTables(); else if(centerMode==='deals') renderDeals(); else if(centerMode==='open') renderOpenOrders(); else renderMenu();
}
function formatType(t){ return ({DINE_IN:'Dine In',DELIVERY:'Delivery',TAKEAWAY:'Takeaway'}[t]||t); }
function orderContext(o){ if(o.type==='DINE_IN') return state.tables.find(t=>t.id===o.tableId)?.name || 'No table'; if(o.type==='DELIVERY') return o.mobile || o.customerName || 'Delivery customer'; return o.customerName || 'Takeaway'; }
function elapsed(iso){ return elapsedClock(iso); }
function elapsedClock(iso){ if(!iso) return '00:00:00'; const sec=Math.max(0,Math.floor((Date.now()-new Date(iso).getTime())/1000)); const h=Math.floor(sec/3600), m=Math.floor((sec%3600)/60), ss=sec%60; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}:${String(ss).padStart(2,'0')}`; }
function refreshLiveTimers(){ $$('[data-live-timer]').forEach(el=>{ el.textContent = elapsedClock(el.dataset.liveTimer); }); }
function renderTables(){
  $('#centerScroll').innerHTML = `<div class="card subcard"><div class="module-title"><h3>Tables (${esc(state.tables[0]?.floor||'Ground Floor')})</h3><div class="actions-mini"><button class="ghost-btn" onclick="openNewOrderModal('DINE_IN')">New Dine In</button></div></div><div class="tables-mini">${tableCards(state.tables)}</div></div>`;
  bindTableCards();
}
function tableCards(tables){
  return tables.filter(t=>t.active).sort((a,b)=>(a.sort||0)-(b.sort||0)).map(t=>`<button class="table-card ${t.busy?'busy':'available'}" data-table="${esc(t.id)}" data-order="${esc(t.orderId||'')}">
    <div class="table-icon"><span class="chair-top"></span><b>${esc(t.name)}</b><span class="chair-bottom"></span></div><div class="table-name">${t.busy?'Busy':'Available'}</div><div class="table-meta">${t.busy ? `⏱ <span data-live-timer="${esc(t.occupiedAt||'')}">${elapsedClock(t.occupiedAt)}</span> • ${t.guests||0} guests` : `${t.seats} seats`}</div></button>`).join('');
}
function bindTableCards(){
  $$('[data-table]').forEach(btn => btn.onclick = () => { if(btn.dataset.order){ const o=state.openOrders.find(x=>x.id===btn.dataset.order); if(o){ currentOrder=clone(o); centerMode='menu'; renderShell(); } } else openNewOrderModal('DINE_IN', btn.dataset.table); });
}
function renderTablesStrip(){ return `<div class="card subcard mb"><div class="module-title"><h3>Tables quick view</h3><button class="ghost-btn" onclick="centerMode='tables';renderShell()">View All Tables</button></div><div class="tables-mini">${tableCards(state.tables.slice(0,6))}</div></div>`; }
function renderMenu(q=''){
  const cats = state.categories.filter(c=>c.active && c.id!=='cat_all' && c.id!=='all');
  const items = state.items.filter(i=>i.active && (categoryId==='all'||categoryId==='cat_all'||i.categoryId===categoryId) && (!q || i.name.toLowerCase().includes(q.toLowerCase()))).sort((a,b)=>(a.sort||0)-(b.sort||0));
  const selectedCat = categoryId === 'cat_all' ? 'All Items' : (cats.find(c=>c.id===categoryId)?.name || 'Menu Items');
  $('#centerScroll').innerHTML = `${currentOrder?renderTablesStrip():''}<div class="card subcard"><div class="module-title"><div><h3>Menu Items</h3><div class="menu-current">${esc(selectedCat)} • ${items.length} item${items.length===1?'':'s'}</div></div><button class="ghost-btn" onclick="centerMode='tables';renderShell()">View Tables</button></div><div class="item-grid">${items.map(itemCard).join('') || '<div class="empty-cart">No matching items.</div>'}</div></div>`;
  $$('[data-add-item]').forEach(b=>b.onclick=()=>addItem(b.dataset.addItem)); bindTableCards();
}
function itemCard(i){ const cat=state.categories.find(c=>c.id===i.categoryId)?.name||''; const noPrice=numericPrice(i.price)<=0; const disabled=i.soldOut||noPrice; const tone=categoryTone(cat||i.name); return `<button class="item-card clickable-card ${tone} ${disabled?'sold':''}" data-add-item="${esc(i.id)}" ${disabled?'disabled':''}>${i.soldOut?'<div class="sold-badge">SOLD OUT</div>':noPrice?'<div class="sold-badge price-missing">SET PRICE</div>':''}<div class="card-accent"></div><div class="item-img">${i.imageUrl?`<img src="${esc(i.imageUrl)}" alt="">`:'<span class="image-placeholder">No image</span>'}</div><div class="item-body"><div><h4>${esc(i.name)}</h4><p>${esc(cat)}</p><div class="price ${noPrice?'danger-text':''}">${noPrice?'Price required':money(i.price)}</div></div><span class="item-add-hint">＋</span></div></button>`; }
function renderDeals(){
  $('#centerScroll').innerHTML = `<div class="card subcard"><div class="module-title"><h3>Deals</h3>${can('admin.menu')?'<button class="ghost-btn" onclick="screen=\'admin\';adminTab=\'deals\';renderShell()">Manage Deals</button>':''}</div><div class="item-grid">${state.deals.filter(d=>d.active).sort((a,b)=>(a.sort||0)-(b.sort||0)).map(d=>{const noPrice=numericPrice(d.price)<=0; return `<button class="item-card clickable-card deal-card tone-deal ${noPrice?'sold':''}" data-add-deal="${esc(d.id)}" ${noPrice?'disabled':''}>${noPrice?'<div class="sold-badge price-missing">SET PRICE</div>':'<div class="popular">Deal</div>'}<div class="card-accent"></div><div class="item-img">${d.imageUrl?`<img src="${esc(d.imageUrl)}" alt="">`:'<span class="image-placeholder">No image</span>'}</div><div class="item-body"><div><h4>${esc(d.name)}</h4><p>${esc(d.description||'Deal')}</p><div class="price ${noPrice?'danger-text':''}">${noPrice?'Price required':money(d.price)}</div></div><span class="item-add-hint">＋</span></div></button>`}).join('') || '<div class="empty-cart">No active deals. Add real deals from Admin → Deals.</div>'}</div></div>`;
  $$('[data-add-deal]').forEach(b=>b.onclick=()=>addDeal(b.dataset.addDeal));
}
function renderOpenOrders(){
  const filters = ['ALL','DINE_IN','DELIVERY','TAKEAWAY'];
  $('#centerScroll').innerHTML = `<div class="card subcard"><div class="module-title"><h3>Open Orders</h3><button class="ghost-btn" onclick="openNewOrderModal()">New Order</button></div><div class="filter-pills">${filters.map(f=>`<button class="pill" data-open-filter="${f}">${f==='ALL'?'All':formatType(f)}</button>`).join('')}</div><div id="openList"></div></div>`;
  const draw = f => { const orders=state.openOrders.filter(o=>f==='ALL'||o.type===f); $('#openList').innerHTML = orders.length ? orders.map(o=>`<button class="open-order" data-open-id="${esc(o.id)}"><div><h4>#${esc(o.number)} • ${formatType(o.type)} • ${esc(orderContext(o))}</h4><p>${esc(o.orderTakerName||o.customerName||'')} • <span data-live-timer="${esc(o.createdAt)}">${elapsedClock(o.createdAt)}</span> • ${o.lines?.length||0} lines</p></div><b>${money(calcTotals(o).total)}</b></button>`).join('') : `<div class="empty-cart">No open orders.</div>`; $$('[data-open-id]').forEach(b=>b.onclick=()=>{currentOrder=clone(state.openOrders.find(o=>o.id===b.dataset.openId));centerMode='menu';renderShell();}); };
  $$('[data-open-filter]').forEach(b=>b.onclick=()=>draw(b.dataset.openFilter)); draw('ALL');
}
function calcTotals(o){ const subtotal=(o?.lines||[]).reduce((s,l)=>s+((Number(l.price)||0)+(l.modifiers||[]).reduce((a,m)=>a+Number(m.price||0),0))*Number(l.qty||0),0); const deliveryFee=Number(o?.deliveryFee||0); let discount=0; if(o?.discountType==='PERCENT') discount=subtotal*Math.max(0,Math.min(100,Number(o.discountValue||0)))/100; if(o?.discountType==='FIXED') discount=Number(o.discountValue||0); discount=Math.min(Math.max(discount,0),subtotal+deliveryFee); return {subtotal,deliveryFee,discount,total:Math.max(0,subtotal+deliveryFee-discount)}; }
async function ensureOrder(){ if(currentOrder) return true; openNewOrderModal(); return false; }
async function addItem(itemId){ if(!requireNotRapidClick()) return; const i=state.items.find(x=>x.id===itemId); if(!i||i.soldOut) return; if(numericPrice(i.price)<=0) return toast('Set item price in Admin before billing', true); if(!(await ensureOrder())) return; const line=currentOrder.lines.find(l=>l.kind==='ITEM'&&l.itemId===i.id&&(!l.modifiers||!l.modifiers.length)&&!l.note); if(line) line.qty++; else currentOrder.lines.push({lineId:uid(),kind:'ITEM',itemId:i.id,categoryId:i.categoryId,name:i.name,price:i.price,imageUrl:i.imageUrl,qty:1,note:'',modifiers:[]}); renderBill(); if(isMobileViewport()) setMobileBill(true); }
async function addDeal(dealId){ if(!requireNotRapidClick()) return; const d=state.deals.find(x=>x.id===dealId); if(!d) return; if(numericPrice(d.price)<=0) return toast('Set deal price in Admin before billing', true); if(!(await ensureOrder())) return; const line=currentOrder.lines.find(l=>l.kind==='DEAL'&&l.dealId===d.id&&!l.note); if(line) line.qty++; else currentOrder.lines.push({lineId:uid(),kind:'DEAL',dealId:d.id,categoryId:'cat_deals',name:d.name,price:d.price,imageUrl:d.imageUrl,qty:1,note:'',modifiers:[],dealItems:d.items}); renderBill(); if(isMobileViewport()) setMobileBill(true); }
function renderBill(){
  const bp=$('#billPanel'); if(!bp) return;
  if(!currentOrder){ bp.innerHTML=`<div class="bill-head"><h2>Current Order</h2><b>—</b><button class="mobile-close-cart" id="mobileCloseCart" type="button">×</button></div><div class="empty-cart"><div><b>No active bill</b><p>Press New Order to start billing.</p></div></div>`; return; }
  const t=calcTotals(currentOrder);
  const printBillButton = `<button class="secondary-btn mini-action" id="printBillBtn" ${hasOrderLines(currentOrder)?'':'disabled title="Add item first"'}>Print Bill</button>`;
  const billActions = currentOrder.type==='DINE_IN' ? `${printBillButton}<button class="secondary-btn mini-action" id="moveTableBtn">Move Table</button><button class="secondary-btn mini-action" id="splitBillBtn">Split Bill</button>` : `${printBillButton}<button class="secondary-btn mini-action" id="splitBillBtn">Split Bill</button>`;
  const deliveryRow = currentOrder.type==='DELIVERY' ? `<div class="total-row"><span>Delivery Fee</span><b>${money(t.deliveryFee)}</b></div>` : '';
  bp.innerHTML=`<div class="bill-head"><h2>Current Order</h2><b>#${esc(currentOrder.number||'Draft')}</b><button class="mobile-close-cart" id="mobileCloseCart" type="button">×</button></div><div class="orderbox">${orderBoxRows(currentOrder)}</div><div class="line-list">${currentOrder.lines.length?currentOrder.lines.map(cartLine).join(''):'<div class="empty-cart">Add items from the center menu.</div>'}</div><div class="totals compact-totals"><div class="total-row"><span>Subtotal</span><b>${money(t.subtotal)}</b></div><div class="discount-row"><span>Discount</span><div class="switch"><button class="${currentOrder.discountType==='FIXED'?'active':''}" data-disc="FIXED">Rs</button><button class="${currentOrder.discountType==='PERCENT'?'active':''}" data-disc="PERCENT">%</button></div><input class="small-input" id="discountVal" value="${Number(currentOrder.discountValue||0)}"></div>${deliveryRow}<div class="total-row big"><span>Total</span><b>${money(t.total)}</b></div></div><div class="bill-quick-actions">${billActions}</div><label class="check"><input type="checkbox" id="printRemember" ${getPrintDefault()?'checked':''}> Print receipt after payment</label><div class="actions"><button class="hold" id="holdBtn" ${hasOrderLines(currentOrder)?'':'disabled title="Add item first"'}>Ⅱ HOLD</button><button class="pay" id="payBtn" ${hasOrderLines(currentOrder)?'':'disabled title="Add item first"'}>▣ PAY ${money(t.total)}</button></div>`;
  $('#mobileCloseCart') && ($('#mobileCloseCart').onclick = () => setMobileBill(false));
  $$('[data-line-minus]').forEach(b=>b.onclick=()=>changeQty(b.dataset.lineMinus,-1));
  $$('[data-line-plus]').forEach(b=>b.onclick=()=>changeQty(b.dataset.linePlus,1));
  $$('[data-line-remove]').forEach(b=>b.onclick=()=>{currentOrder.lines=currentOrder.lines.filter(l=>l.lineId!==b.dataset.lineRemove);renderBill();});
  $$('[data-line-edit]').forEach(b=>b.onclick=()=>openLineModal(b.dataset.lineEdit));
  $$('[data-qty-input]').forEach(inp=>inp.onchange=()=>{const l=currentOrder.lines.find(x=>x.lineId===inp.dataset.qtyInput); if(l){l.qty=Math.max(1,Number(inp.value)||1); renderBill();}});
  $$('[data-disc]').forEach(b=>b.onclick=()=>{currentOrder.discountType=currentOrder.discountType===b.dataset.disc?'NONE':b.dataset.disc; if(currentOrder.discountType==='NONE') currentOrder.discountValue=0; renderBill();});
  $('#discountVal').onchange=e=>{ currentOrder.discountValue=Math.max(0,Number(e.target.value)||0); if(currentOrder.discountValue>0 && currentOrder.discountType==='NONE') currentOrder.discountType='FIXED'; renderBill(); };
  $('#printRemember').onchange=e=>localStorage.setItem('swifttill_print_default', e.target.checked?'1':'0');
  $('#holdBtn').onclick=()=>saveOrder(true);
  $('#payBtn').onclick=()=>openPayModal();
  $('#printBillBtn') && ($('#printBillBtn').onclick=()=>printCurrentBill());
  $('#moveTableBtn') && ($('#moveTableBtn').onclick=()=>openMoveTableModal());
  $('#splitBillBtn') && ($('#splitBillBtn').onclick=()=>openSplitBillModal());
}
function orderBoxRows(o){ const rows=[`🍴 ${formatType(o.type)}`]; if(o.type==='DINE_IN') rows.push(`▣ ${esc(state.tables.find(t=>t.id===o.tableId)?.name||'No table')}`,`👥 ${o.guests||0} Guests`,`👤 Order Taker: ${esc(o.orderTakerName||'—')}`); if(o.type==='DELIVERY') rows.push(`👤 ${esc(o.customerName||'—')}`,`☎ ${esc(o.mobile||'—')}`,`⌂ ${esc(o.address||'—')}`); if(o.type==='TAKEAWAY') rows.push(`👤 ${esc(o.customerName||'Walk-in')}`,`☎ ${esc(o.mobile||'')}`); return rows.map(r=>`<div>${r}</div>`).join(''); }
function cartLine(l){ const mods=(l.modifiers||[]).map(m=>`+ ${esc(m.name)} ${money(m.price)}`).join('<br>'); return `<div class="cart-line"><img src="${esc(l.imageUrl)}" alt=""><div><h4>${esc(l.name)}</h4><p>${money(l.price)}${mods?'<br>'+mods:''}${l.note?'<br>Note: '+esc(l.note):''}</p><div class="line-tools"><button data-line-edit="${esc(l.lineId)}">notes / add-ons</button></div></div><div class="cart-actions"><div class="qty"><button data-line-minus="${esc(l.lineId)}">−</button><input data-qty-input="${esc(l.lineId)}" value="${l.qty}"><button data-line-plus="${esc(l.lineId)}">+</button></div><button class="trash" data-line-remove="${esc(l.lineId)}">✕</button></div></div>`; }
function changeQty(lineId,delta){ const l=currentOrder.lines.find(x=>x.lineId===lineId); if(!l)return; l.qty+=delta; if(l.qty<=0) currentOrder.lines=currentOrder.lines.filter(x=>x.lineId!==lineId); renderBill(); }
function getPrintDefault(){ const local=localStorage.getItem('swifttill_print_default'); return local===null ? !!state.settings.autoPrintReceipt : local==='1'; }
function openModal(html, wide=false){ $('#modalRoot').innerHTML = `<div class="modal-backdrop"><div class="modal ${wide?'wide':''}">${html}</div></div>`; document.body.classList.add('no-scroll'); }
function closeModal(){ $('#modalRoot').innerHTML=''; document.body.classList.remove('no-scroll'); }
window.closeModal = closeModal;
function orderTypeFields(type, presetTable=''){
  if(type==='DINE_IN') { const availableTables = state.tables.filter(t=>t.active && (!t.busy || t.id===presetTable)); return `<div class="grid2"><div class="field"><label>Order Taker</label><select name="orderTakerId" required>${state.orderTakers.filter(t=>t.active).map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('')}</select></div><div class="field"><label>Number of Guests</label><input name="guests" type="number" min="1" value="2" required></div></div><div class="field"><label>Select Table</label><select name="tableId" required><option value="">Choose available table</option>${availableTables.map(t=>`<option value="${esc(t.id)}" ${t.id===presetTable?'selected':''}>${esc(t.name)} — Available — ${t.seats} seats</option>`).join('')}</select>${availableTables.length?'<p class="muted-note">Dine In cannot start without a table.</p>':'<p class="danger-text">No available table. Open an existing busy table or free a table first.</p>'}</div>`; }
  if(type==='DELIVERY') return `<div class="grid2"><div class="field"><label>Customer Name</label><input name="customerName" required></div><div class="field"><label>Mobile Number</label><input name="mobile" required></div></div><div class="field"><label>Complete Address</label><textarea name="address" rows="3" required></textarea></div><div class="grid2"><div class="field"><label>Delivery Fee</label><input name="deliveryFee" type="number" value="${state.settings.defaultDeliveryFee||0}"></div><div class="field"><label>Delivery Notes</label><input name="deliveryNotes"></div></div>`;
  return `<div class="grid2"><div class="field"><label>Customer Name</label><input name="customerName" placeholder="Walk-in"></div><div class="field"><label>Mobile Number</label><input name="mobile"></div></div>`;
}
function openNewOrderModal(type='DINE_IN', presetTable=''){
  selectedOrderType = type;
  const draw = () => { openModal(`<div class="modal-head"><h2>Create New Order</h2><button class="x" onclick="closeModal()">×</button></div><form id="newOrderForm"><div class="order-type-grid">${['DINE_IN','DELIVERY','TAKEAWAY'].map(t=>`<button type="button" class="order-type ${selectedOrderType===t?'active':''}" data-type="${t}"><div>${t==='DINE_IN'?'🍴':t==='DELIVERY'?'🛵':'🛍'}</div><b>${formatType(t)}</b><span>${t==='DINE_IN'?'At restaurant':t==='DELIVERY'?'To customer':'Pickup order'}</span></button>`).join('')}</div><div class="mt" id="orderFields">${orderTypeFields(selectedOrderType, presetTable)}</div><button class="primary-btn mt" style="width:100%">Create Order</button></form>`); $$('[data-type]').forEach(b=>b.onclick=()=>{selectedOrderType=b.dataset.type; draw();}); $('#newOrderForm').onsubmit=submitNewOrder; };
  draw();
}
async function submitNewOrder(e){ e.preventDefault(); const f=new FormData(e.target); const data=Object.fromEntries(f); data.type=selectedOrderType; data.guests=Number(data.guests||0); data.deliveryFee=Number(data.deliveryFee||0); if(data.type==='DINE_IN' && !data.tableId) return toast('Select table for Dine In order', true); try{ const taker=state.orderTakers.find(t=>t.id===data.orderTakerId); data.orderTakerName=taker?.name||''; const j=await api('/api/orders/create', data); currentOrder=j.order; closeModal(); await loadState(); centerMode='menu'; renderShell(); toast('Order created'); }catch(err){ toast(err.message,true); } }
async function saveOrder(hold=false){ if(!currentOrder) return; if(!requireOrderLines(hold?'Add at least one item before Hold':'Add at least one item before Save')) return; if(!requirePositiveTotal()) return; try{ const j=await api('/api/orders/save',{...currentOrder,hold}); currentOrder=hold?null:j.order; await loadState(); renderShell(); toast(hold?'Order held':'Order saved'); }catch(e){toast(e.message,true);} }
function openLineModal(lineId){ const l=currentOrder.lines.find(x=>x.lineId===lineId); if(!l)return; const item=state.items.find(i=>i.id===l.itemId); const mods=item?.modifiers||[]; openModal(`<div class="modal-head"><h2>${esc(l.name)}</h2><button class="x" onclick="closeModal()">×</button></div><div class="field"><label>Item Note</label><textarea id="lineNote" rows="3" placeholder="No onion, extra spicy, etc.">${esc(l.note||'')}</textarea></div><div class="modal-section"><h3>Add-ons</h3>${mods.length?mods.map(m=>`<label class="check"><input type="checkbox" data-mod-name="${esc(m.name)}" data-mod-price="${m.price}" ${(l.modifiers||[]).some(x=>x.name===m.name)?'checked':''}> ${esc(m.name)} — ${money(m.price)}</label>`).join(''):'<p class="muted-note">No add-ons configured for this line.</p>'}</div><button class="primary-btn mt" id="saveLine">Save Line</button>`); $('#saveLine').onclick=()=>{ l.note=$('#lineNote').value; l.modifiers=$$('[data-mod-name]:checked').map(x=>({name:x.dataset.modName,price:Number(x.dataset.modPrice)})); closeModal(); renderBill(); }; }
function openMoveTableModal(){
  if(!currentOrder || currentOrder.type!=='DINE_IN') return toast('Move table is only for dine-in orders', true);
  const currentTable=currentOrder.tableId;
  const cards=state.tables.filter(t=>t.active).map(t=>{ const disabled=t.busy && t.id!==currentTable; return `<button class="table-card ${t.id===currentTable?'current':t.busy?'busy':'available'}" data-transfer-table="${esc(t.id)}" ${disabled?'disabled':''}><div class="table-icon"><span class="chair-top"></span><b>${esc(t.name)}</b><span class="chair-bottom"></span></div><div class="table-name">${t.id===currentTable?'Current':t.busy?'Busy':'Available'}</div><div class="table-meta">${t.busy?`⏱ ${elapsed(t.occupiedAt)} • ${t.guests||0} guests`:`${t.seats} seats`}</div></button>`; }).join('');
  openModal(`<div class="modal-head"><h2>Move Table</h2><button class="x" onclick="closeModal()">×</button></div><p class="muted-note">Select an available table. Current bill stays the same; only table changes.</p><div class="tables-mini transfer-grid">${cards}</div>`, true);
  $$('[data-transfer-table]').forEach(btn=>btn.onclick=async()=>{ if(btn.disabled) return; const old=currentOrder.tableId; currentOrder.tableId=btn.dataset.transferTable; try{ const j=await api('/api/orders/save',currentOrder); currentOrder=j.order; closeModal(); await loadState(); renderShell(); toast(`Table moved from ${state.tables.find(t=>t.id===old)?.name||'old table'} to ${state.tables.find(t=>t.id===currentOrder.tableId)?.name||'new table'}`); }catch(e){ currentOrder.tableId=old; toast(e.message,true); } });
}
function openSplitBillModal(){
  if(!currentOrder || !currentOrder.lines.length) return toast('Add items before split bill', true);
  const t=calcTotals(currentOrder); if(t.total<=0) return toast('Set item/deal price before split bill', true);
  openModal(`<div class="modal-head"><h2>Split Bill Calculator</h2><button class="x" onclick="closeModal()">×</button></div><div class="pay-total-card"><span>Order Total</span><b>${money(t.total)}</b></div><div class="grid2"><div class="field"><label>Entered Amount</label><input id="splitFirst" type="number" value="0" min="0"></div><div class="field"><label>Equal Persons</label><input id="splitPersons" type="number" value="2" min="2"></div></div><div class="split-summary"><div><span>Entered</span><b id="billEntered">${money(0)}</b></div><div><span id="billBalanceLabel">Remaining</span><b id="billRemaining">${money(t.total)}</b></div><div><span>Equal Share</span><b id="billEqual">${money(t.total/2)}</b></div></div><p class="muted-note">If entered amount is above total, system shows extra/change instead of hiding it.</p><button class="primary-btn mt" id="goSplitPay">Open Split Payment</button>`);
  const update=()=>{ const a=Number($('#splitFirst').value||0); const persons=Math.max(2,Number($('#splitPersons').value||2)); const balance=t.total-a; $('#billEntered').textContent=money(a); $('#billBalanceLabel').textContent=balance<0?'Extra / Change':'Remaining'; $('#billRemaining').textContent=money(Math.abs(balance)); $('#billEqual').textContent=money(t.total/persons); $('#billRemaining').classList.toggle('danger-text', balance>0); $('#billRemaining').classList.toggle('ok-text', balance<=0); };
  $('#splitFirst').addEventListener('input',update); $('#splitPersons').addEventListener('input',update); $('#goSplitPay').onclick=()=>{ closeModal(); openPayModal(); setTimeout(()=>{ const s=$('#splitPay'); if(s){ s.checked=true; s.dispatchEvent(new Event('change')); } },50); }; update();
}
function printReportArea(){
  const html=$('#printReportArea')?.innerHTML || '';
  if(!html.trim()) return toast('Run report first. No report content available to print.', true);
  ensurePrintArea().innerHTML=`<div class="report-print">${html}</div>`;
  setTimeout(()=>window.print(),120);
}
function currentBillReceipt(){
  if(!currentOrder || !currentOrder.lines || !currentOrder.lines.length) return null;
  const table=state.tables.find(t=>t.id===currentOrder.tableId)?.name||'';
  return {business:state.settings.businessName,branchName:state.settings.branchName,phone:state.settings.phone,address:state.settings.address,logoUrl:state.settings.logoUrl,header:'UNPAID BILL / ESTIMATE',footer:'Not paid. Use payment screen for final receipt.',receiptWidth:state.settings.receiptWidth,showLogoOnReceipt:state.settings.showLogoOnReceipt,showCustomerOnReceipt:state.settings.showCustomerOnReceipt,showOrderTakerOnReceipt:state.settings.showOrderTakerOnReceipt,showCashierOnReceipt:state.settings.showCashierOnReceipt,showPaymentBreakdown:false,number:currentOrder.number||'Draft',date:new Date().toISOString(),cashier:state.user?.name||currentOrder.cashierName,type:currentOrder.type,table,guests:currentOrder.guests,orderTaker:currentOrder.orderTakerName,customer:currentOrder.customerName,mobile:currentOrder.mobile,lines:currentOrder.lines,totals:calcTotals(currentOrder),payments:[],unpaid:true};
}
function printCurrentBill(){
  if(!currentOrder || !currentOrder.lines.length) return toast('Add items before printing bill', true);
  const r=currentBillReceipt();
  if(!r || r.totals.total<=0) return toast('Set item/deal price before printing bill', true);
  showReceiptModal(r, false, true);
}


function openPayModal(){
  if(!currentOrder || !currentOrder.lines.length) return toast('Add items before payment',true);
  if(!requirePositiveTotal('Total payable is Rs 0. Set price in Admin before payment.')) return;
  if(currentOrder.type==='DINE_IN' && !currentOrder.tableId) return toast('Select table before payment', true);
  const t=calcTotals(currentOrder);
  openModal(`<div class="modal-head"><h2>Payment</h2><button class="x" onclick="closeModal()">×</button></div><div class="pay-total-card"><span>Total payable</span><b>${money(t.total)}</b></div><div class="seg"><button class="active" data-paytab="cash">Cash</button><button data-paytab="card">Card</button><button data-paytab="online">Online</button></div><div id="payFields"></div><label class="check mt"><input id="payPrint" type="checkbox" ${getPrintDefault()?'checked':''}> Print receipt after payment</label><label class="check"><input id="splitPay" type="checkbox"> Split payment</label><button class="primary-btn mt" style="width:100%" id="completePay">Complete Payment</button>`);
  let tab='cash';
  const balanceBox = (prefix, label='Amount Received') => `<div class="field"><label>${label}</label><input id="${prefix}Amount" type="number" value="${tab==='cash'?Math.ceil(t.total/50)*50:t.total}" min="0"></div><div class="split-summary pay-calc"><div><span>Total</span><b>${money(t.total)}</b></div><div><span>Entered</span><b id="${prefix}Entered">${money(tab==='cash'?Math.ceil(t.total/50)*50:t.total)}</b></div><div><span id="${prefix}BalanceLabel">${tab==='cash' && Math.ceil(t.total/50)*50>t.total?'Change':'Remaining'}</span><b id="${prefix}Balance">${money(Math.abs((tab==='cash'?Math.ceil(t.total/50)*50:t.total)-t.total))}</b></div></div>`;
  const updateSingleCalc=(prefix)=>{ const val=Number($('#'+prefix+'Amount')?.value||0); const diff=val-t.total; $('#'+prefix+'Entered').textContent=money(val); $('#'+prefix+'BalanceLabel').textContent = diff<0 ? 'Remaining' : (tab==='cash' ? 'Change' : 'Extra'); $('#'+prefix+'Balance').textContent=money(Math.abs(diff)); $('#'+prefix+'Balance').classList.toggle('danger-text', diff<0 || (diff>0 && tab!=='cash')); $('#'+prefix+'Balance').classList.toggle('ok-text', diff>=0 && (tab==='cash' || diff===0)); };
  const draw=()=>{
    $$('[data-paytab]').forEach(b=>b.classList.toggle('active',b.dataset.paytab===tab));
    const split=$('#splitPay')?.checked; const f=$('#payFields');
    if(split){
      f.innerHTML=`<div class="split-summary"><div><span>Total</span><b>${money(t.total)}</b></div><div><span>Paid / Received</span><b id="splitPaid">${money(0)}</b></div><div><span id="splitBalanceLabel">Remaining</span><b id="splitRemaining">${money(t.total)}</b></div></div><div class="grid3"><div class="field"><label>Cash Received</label><input id="cashAmt" class="split-amt" type="number" value="0" min="0"></div><div class="field"><label>Card</label><input id="cardAmt" class="split-amt" type="number" value="0" min="0"></div><div class="field"><label>Online</label><input id="onlineAmt" class="split-amt" type="number" value="0" min="0"></div></div><div class="quick-fill-row"><button type="button" class="ghost-btn" data-fill-remaining="cashAmt">Cash remaining</button><button type="button" class="ghost-btn" data-fill-remaining="cardAmt">Card remaining</button><button type="button" class="ghost-btn" data-fill-remaining="onlineAmt">Online remaining</button></div><p class="muted-note">Calculator shows remaining or extra. Extra is accepted only through cash as change.</p>`;
      const update=()=>{ const cash=Number($('#cashAmt')?.value||0), card=Number($('#cardAmt')?.value||0), online=Number($('#onlineAmt')?.value||0); const paid=cash+card+online; const rem=t.total-paid; $('#splitPaid').textContent=money(paid); $('#splitBalanceLabel').textContent=rem<0?'Change / Extra':'Remaining'; $('#splitRemaining').textContent=money(Math.abs(rem)); $('#splitRemaining').classList.toggle('danger-text', rem>0 || (rem<0 && cash<Math.abs(rem))); $('#splitRemaining').classList.toggle('ok-text', rem<=0 && (rem>=0 || cash>=Math.abs(rem))); };
      $$('.split-amt').forEach(i=>i.addEventListener('input',update));
      $$('[data-fill-remaining]').forEach(btn=>btn.onclick=()=>{ const target=$('#'+btn.dataset.fillRemaining); const paidOther=['cashAmt','cardAmt','onlineAmt'].filter(id=>id!==btn.dataset.fillRemaining).reduce((s,id)=>s+Number($('#'+id)?.value||0),0); target.value=Math.max(0,t.total-paidOther); update(); });
      update(); return;
    }
    if(tab==='cash') f.innerHTML=`${balanceBox('cash','Cash Received')}`;
    if(tab==='card') f.innerHTML=`${balanceBox('card','Card Amount')}<div class="field"><label>Card Reference / Slip No.</label><input id="cardRef" placeholder="Optional"></div>`;
    if(tab==='online') f.innerHTML=`${balanceBox('online','Online Amount')}<div class="field"><label>Online Method / Reference</label><input id="onlineRef" placeholder="Easypaisa / JazzCash / Bank ref"></div>`;
    ['cash','card','online'].forEach(prefix=>$('#'+prefix+'Amount')?.addEventListener('input',()=>updateSingleCalc(prefix)));
    updateSingleCalc(tab);
  };
  $$('[data-paytab]').forEach(b=>b.onclick=()=>{tab=b.dataset.paytab;draw();}); $('#splitPay').onchange=draw; draw();
  $('#completePay').onclick=async()=>{ if(!requireOrderLines('Add at least one item before Payment')) return; if(!requirePositiveTotal('Total payable is Rs 0. Set price in Admin before payment.')) return; try{ const split=$('#splitPay').checked; let payments=[]; if(split){ const cash=Number($('#cashAmt').value||0), card=Number($('#cardAmt').value||0), online=Number($('#onlineAmt').value||0); const paid=cash+card+online; const remaining=t.total-paid; if(remaining>0.009) throw new Error(`Remaining amount: ${money(remaining)}`); const extra=Math.max(0,paid-t.total); if(extra>0.009 && cash<extra) throw new Error('Extra amount must be cash so change can be returned.'); const cashRevenue=Math.max(0,cash-extra); payments=[{method:'Cash',amount:cashRevenue,received:cash,change:extra},{method:'Card',amount:card},{method:'Online',amount:online}].filter(p=>p.amount>0 || p.received>0); } else if(tab==='cash'){ const rec=Number($('#cashAmount').value||0); if(rec<t.total) throw new Error('Cash received is less than total'); payments=[{method:'Cash',amount:t.total,received:rec,change:Math.max(0,rec-t.total)}]; } else if(tab==='card'){ const entered=Number($('#cardAmount').value||0); if(entered<t.total) throw new Error(`Remaining amount: ${money(t.total-entered)}`); if(entered>t.total) throw new Error('Card extra detected. Enter exact card amount.'); payments=[{method:'Card',amount:t.total,received:entered,reference:$('#cardRef').value,change:0}]; } else { const entered=Number($('#onlineAmount').value||0); if(entered<t.total) throw new Error(`Remaining amount: ${money(t.total-entered)}`); if(entered>t.total) throw new Error('Online extra detected. Enter exact online amount.'); payments=[{method:'Online',amount:t.total,received:entered,reference:$('#onlineRef').value,change:0}]; } const j=await api('/api/orders/pay',{...currentOrder,payments}); lastReceipt=j.receipt; const doPrint=$('#payPrint').checked; localStorage.setItem('swifttill_print_default', doPrint?'1':'0'); currentOrder=null; screen='pos'; centerMode='menu'; await loadState(); renderShell(); closeModal(); toast('Payment completed'); showReceiptModal(lastReceipt, doPrint); }catch(e){toast(e.message,true);} };
}
function showReceiptModal(r, autoPrint=false, unpaid=false){
  if(!r) return;
  openModal(`<div class="modal-head"><h2>${unpaid || r.unpaid ? 'Unpaid Bill' : 'Paid Bill'} #${esc(r.number)}</h2><button class="x" onclick="closeModal()">×</button></div><div class="receipt-preview-wrap">${receiptHTML(r)}</div><div class="receipt-actions"><button class="ghost-btn" onclick="closeModal();screen='pos';centerMode='menu';renderShell();">Close</button><button class="primary-btn" id="modalPrintReceipt">${unpaid || r.unpaid ? 'Print Bill' : 'Print Receipt'}</button></div>`, false);
  $('#modalPrintReceipt').onclick=()=>printReceipt(r);
  if(autoPrint) setTimeout(()=>printReceipt(r),250);
}
async function printReceipt(r){
  if(!r || !(r.lines||[]).length) return toast('Nothing to print', true);
  const html = receiptHTML(r);
  const printEl = ensurePrintArea();
  printEl.innerHTML = html;
  if(state?.printAgent?.cloudQueueConfigured){
    try{
      const queued = await api('/api/print-jobs',{type:r.unpaid?'unpaid-bill':'receipt',receipt:r,html,text:receiptText(r)});
      if(queued?.queued){ toast('Sent to cloud print queue'); return; }
    }catch(e){ toast('Cloud print queue failed; trying local/browser print', true); }
  }
  const agentUrl=(state?.settings?.localAgentUrl||'').trim();
  if(agentUrl){
    try{
      const res=await fetch(agentUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:r.unpaid?'unpaid-bill':'receipt',receipt:r,html,text:receiptText(r)})});
      if(res.ok){ toast('Sent direct to local thermal printer agent'); return; }
    }catch(e){}
  }
  setTimeout(()=>window.print(),100);
}
function receiptText(r){
  const line='----------------------------------------';
  const rows=[]; rows.push(r.business||'SwiftTill POS'); if(r.branchName) rows.push(r.branchName); if(r.address) rows.push(r.address); if(r.phone) rows.push(r.phone); rows.push(line); rows.push(`Bill No: #${r.number}`); if(r.unpaid) rows.push('Status: UNPAID'); rows.push(new Date(r.date).toLocaleString()); rows.push(`Order: ${formatType(r.type)}`); if(r.table) rows.push(`Table: ${r.table}${r.guests?' / '+r.guests+' guests':''}`); if(r.orderTaker) rows.push(`Taker: ${r.orderTaker}`); if(r.cashier) rows.push(`Cashier: ${r.cashier}`); rows.push(line); for(const l of (r.lines||[])){ rows.push(`${l.name} x${l.qty}  ${money(((l.price||0)+(l.modifiers||[]).reduce((a,m)=>a+Number(m.price||0),0))*l.qty)}`); for(const m of (l.modifiers||[])) rows.push(` + ${m.name} ${money(m.price*l.qty)}`); if(l.note) rows.push(` Note: ${l.note}`); } rows.push(line); rows.push(`Subtotal: ${money(r.totals.subtotal)}`); if(Number(r.totals.deliveryFee||0)>0) rows.push(`Delivery: ${money(r.totals.deliveryFee)}`); rows.push(`Discount: ${money(r.totals.discount)}`); rows.push(`TOTAL: ${money(r.totals.total)}`); rows.push(line); for(const p of (r.payments||[])){ rows.push(`${p.method}: ${money(p.amount)}`); if(p.received&&p.received!==p.amount) rows.push(`Received: ${money(p.received)}`); if(p.change) rows.push(`Change: ${money(p.change)}`); } rows.push(line); rows.push(r.footer||'Thank you'); return rows.join('\n');
}
function receiptHTML(r){
  const width = r.receiptWidth || state?.settings?.receiptWidth || '80mm';
  const lines=(r.lines||[]).map(l=>`<div class="r"><span>${esc(l.name)} x${l.qty}</span><span>${money(((l.price||0)+(l.modifiers||[]).reduce((a,m)=>a+Number(m.price||0),0))*l.qty)}</span></div>${(l.modifiers||[]).map(m=>`<div class="r sub"><span> + ${esc(m.name)}</span><span>${money(m.price*l.qty)}</span></div>`).join('')}${l.note?`<div class="r sub"><span>Note: ${esc(l.note)}</span><span></span></div>`:''}`).join('');
  const customer = r.showCustomerOnReceipt && (r.customer || r.mobile) ? `<div class="r"><span>Customer</span><span>${esc(r.customer || r.mobile)}</span></div>` : '';
  const orderTaker = r.showOrderTakerOnReceipt && r.orderTaker ? `<div class="r"><span>Order Taker</span><span>${esc(r.orderTaker)}</span></div>` : '';
  const cashier = r.showCashierOnReceipt && r.cashier ? `<div class="r"><span>Cashier</span><span>${esc(r.cashier)}</span></div>` : '';
  const logo = r.showLogoOnReceipt && r.logoUrl ? `<img class="receipt-logo" src="${esc(r.logoUrl)}" alt="">` : '';
  const payments = r.showPaymentBreakdown === false ? '' : (r.payments||[]).map(p=>`<div class="r"><span>${esc(p.method)}</span><span>${money(p.amount)}</span></div>${p.received&&p.received!==p.amount?`<div class="r sub"><span>Received</span><span>${money(p.received)}</span></div>`:''}${p.change?`<div class="r sub"><span>Change</span><span>${money(p.change)}</span></div>`:''}`).join('');
  return `<div class="receipt ${width==='58mm'?'narrow':''}">${logo}<h3>${esc(r.business)}</h3><div class="c">${esc(r.branchName||'')}</div><div class="c">${esc(r.header||'')}</div><div class="c">${esc(r.address||'')}<br>${esc(r.phone||'')}</div><div class="sep"></div><div class="r"><span>Bill No</span><span>#${esc(r.number)}</span></div>${r.unpaid?'<div class="r"><span>Status</span><span>UNPAID</span></div>':''}<div class="r"><span>Date</span><span>${new Date(r.date).toLocaleString()}</span></div><div class="r"><span>Order</span><span>${formatType(r.type)}</span></div>${r.table?`<div class="r"><span>Table</span><span>${esc(r.table)}${r.guests?` / ${r.guests} guests`:''}</span></div>`:''}${customer}${orderTaker}${cashier}<div class="sep"></div>${lines}<div class="sep"></div><div class="r"><span>Subtotal</span><span>${money(r.totals.subtotal)}</span></div>${Number(r.totals.deliveryFee||0)>0?`<div class="r"><span>Delivery</span><span>${money(r.totals.deliveryFee)}</span></div>`:''}<div class="r"><span>Discount</span><span>${money(r.totals.discount)}</span></div><div class="r total"><b>Total</b><b>${money(r.totals.total)}</b></div><div class="sep"></div>${payments}<div class="sep"></div><div class="c">${esc(r.footer||'Thank you')}</div></div>`;
}
function openOpenShift(){ openModal(`<div class="modal-head"><h2>Open Shift</h2><button class="x" onclick="closeModal()">×</button></div><div class="field"><label>Opening Cash</label><input id="openingCash" type="number" value="5000"></div><button class="primary-btn" style="width:100%" id="doOpenShift">Start Shift</button>`); $('#doOpenShift').onclick=async()=>{try{await api('/api/shift/open',{openingCash:Number($('#openingCash').value||0)});closeModal();await loadState();renderShell();toast('Shift opened');}catch(e){toast(e.message,true);}}; }
function openCloseShift(){ openModal(`<div class="modal-head"><h2>Close Shift</h2><button class="x" onclick="closeModal()">×</button></div><p class="muted-note">Count physical cash and close the active shift.</p><div class="field"><label>Counted Cash</label><input id="countedCash" type="number" value="0"></div><button class="primary-btn" style="width:100%" id="doCloseShift">Close Shift</button>`); $('#doCloseShift').onclick=async()=>{try{const j=await api('/api/shift/close',{countedCash:Number($('#countedCash').value||0)});closeModal();await loadState();renderShell();toast(`Shift closed. Difference ${money(j.shift.difference)}`);}catch(e){toast(e.message,true);}}; }
function safeArr(v){ return Array.isArray(v) ? v : []; }
function reportMenuButton(key,label,sub=''){
  return `<button class="${reportType===key?'active':''}" data-report-type="${key}"><b>${esc(label)}</b>${sub?`<span>${esc(sub)}</span>`:''}</button>`;
}
function reportDateDefaults(kind){
  const d = new Date();
  const today = d.toISOString().slice(0,10);
  if(kind==='daily' || kind==='x' || kind==='z') return { from: today, to: today };
  if(kind==='y'){ const y=new Date(d.getFullYear(),0,1); return { from: y.toISOString().slice(0,10), to: today }; }
  d.setDate(d.getDate()-30); return { from: d.toISOString().slice(0,10), to: today };
}
function currentReportTitle(){
  return ({daily:'Daily Sales Report',itemwise:'Item Wise Sales Report',category:'Category Wise Report',payment:'Payment Mode Report',custom:'Custom Detailed Report',x:'X Report - Current Shift Snapshot',y:'Y Report - Period Summary',z:'Z Report - Closed Shift Summary',discount:'Discount Report',voidrefund:'Void / Refund Report',ordertype:'Order Type Report'}[reportType] || 'Sales Report');
}
function renderReports(ws){
  try{
    const defs = reportDateDefaults(reportType);
    const users = safeArr(state.users), takers = safeArr(state.orderTakers), items = safeArr(state.items), deals = safeArr(state.deals), cats = safeArr(state.categories), shifts = safeArr(state.shifts), pays = safeArr(state.paymentMethods);
    const userOptions = users.map(u=>`<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
    const takerOptions = takers.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    const itemOptions = items.map(i=>`<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('') + deals.map(d=>`<option value="${esc(d.id)}">${esc(d.name)} (Deal)</option>`).join('');
    const catOptions = cats.filter(c=>c.id!=='cat_all' && c.id!=='all').map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    const shiftOptions = shifts.map(s=>`<option value="${esc(s.id)}">Shift #${s.number} - ${esc(s.cashierName||'')} - ${s.openedAt?new Date(s.openedAt).toLocaleString():''}</option>`).join('');
    const paymentOptions = pays.filter(p=>p.active!==false).map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
    ws.innerHTML=`<div class="report-page admin-report-shell">
      <div class="module-title"><div><h3>Reports</h3><p class="muted-note">Separate restaurant reports with relevant filters, Excel export and bill-style print format.</p></div><div class="actions-mini"><button class="ghost-btn" id="exportReport">Export Excel</button><button class="ghost-btn" id="printReportBtn">Print</button></div></div>
      <div class="reports-layout">
        <div class="report-menu card subcard">
          <h4>Main Reports</h4>
          ${reportMenuButton('daily','Daily','Today sales and bills')}
          ${reportMenuButton('itemwise','Item Wise','Item quantity and sales')}
          ${reportMenuButton('category','Category Wise','Category totals')}
          ${reportMenuButton('payment','Payment Mode','Cash/card/online')}
          ${reportMenuButton('custom','Custom','Full detailed report')}
          <h4>Shift Reports</h4>
          ${reportMenuButton('x','X Report','Current shift snapshot')}
          ${reportMenuButton('y','Y Report','Period summary')}
          ${reportMenuButton('z','Z Report','Closed shift summary')}
          <h4>Control Reports</h4>
          ${reportMenuButton('discount','Discounts','Discounted bills')}
          ${reportMenuButton('voidrefund','Void / Refund','Refund and void history')}
          ${reportMenuButton('ordertype','Order Type','Dine-in/delivery/takeaway')}
        </div>
        <div class="report-work card subcard">
          <div class="report-headline"><h3 id="reportTitle">${esc(currentReportTitle())}</h3><span>${esc(state.settings?.businessName||'SwiftTill POS')}</span></div>
          <div class="report-filter-grid compact-filters" id="reportFilters">
            <div class="field report-filter date-filter"><label>From</label><input type="date" id="fromDate" value="${defs.from}"></div>
            <div class="field report-filter date-filter"><label>To</label><input type="date" id="toDate" value="${defs.to}"></div>
            <div class="field report-filter payment-filter"><label>Payment Mode</label><select id="paymentMode"><option value="">All</option>${paymentOptions}</select></div>
            <div class="field report-filter ordertype-filter"><label>Order Type</label><select id="orderType"><option value="">All</option><option value="DINE_IN">Dine In</option><option value="DELIVERY">Delivery</option><option value="TAKEAWAY">Takeaway</option></select></div>
            <div class="field report-filter item-filter"><label>Item / Deal</label><select id="itemId"><option value="">All</option>${itemOptions}</select></div>
            <div class="field report-filter category-filter"><label>Category</label><select id="categoryFilter"><option value="">All</option>${catOptions}</select></div>
            <div class="field report-filter cashier-filter"><label>Cashier</label><select id="cashierId"><option value="">All</option>${userOptions}</select></div>
            <div class="field report-filter taker-filter"><label>Order Taker</label><select id="orderTakerId"><option value="">All</option>${takerOptions}</select></div>
            <div class="field report-filter shift-filter"><label>Shift</label><select id="shiftId"><option value="">All</option>${shiftOptions}</select></div>
            <label class="check report-filter discount-filter"><input type="checkbox" id="discountOnly"> Discounted only</label>
            <label class="check report-filter refund-filter"><input type="checkbox" id="refundOnly"> Refunded only</label>
          </div>
          <div class="quick-fill-row"><button class="primary-btn" id="runReport">Run ${esc(currentReportTitle())}</button><button class="ghost-btn" id="todayReport" type="button">Today</button><button class="ghost-btn" id="lastMonthReport" type="button">Last 30 Days</button></div>
          <div id="reportResult" class="mt"><div class="empty-cart compact-empty"><b>Report ready.</b><p>Select report and click Run.</p></div></div>
        </div>
      </div>
    </div>`;
    applyReportFilterVisibility();
    $$('[data-report-type]').forEach(b=>b.onclick=()=>{ reportType=b.dataset.reportType; renderReports(ws); });
    $('#runReport').onclick=loadReport;
    $('#todayReport').onclick=()=>{ const d=new Date().toISOString().slice(0,10); $('#fromDate').value=d; $('#toDate').value=d; loadReport(); };
    $('#lastMonthReport').onclick=()=>{ const d=new Date(); const to=d.toISOString().slice(0,10); d.setDate(d.getDate()-30); $('#fromDate').value=d.toISOString().slice(0,10); $('#toDate').value=to; loadReport(); };
    $('#exportReport').onclick=()=>downloadApi(`/api/export?${reportQuery()}`,`swifttill-${reportType}-report-${Date.now()}.csv`).catch(e=>toast(e.message,true));
    $('#printReportBtn').onclick=()=>printReportArea();
    setTimeout(loadReport, 20);
  }catch(e){ ws.innerHTML=`<div class="card subcard error-state"><h3>Reports failed to render</h3><p>${esc(e.message)}</p><button class="primary-btn" onclick="renderAdminContent()">Reload Reports</button></div>`; }
}
function applyReportFilterVisibility(){
  const visible={
    daily:['date','payment','ordertype','cashier','taker'],
    itemwise:['date','item','category','cashier','taker'],
    category:['date','category','cashier'],
    payment:['date','payment','cashier','shift'],
    custom:['date','payment','ordertype','item','category','cashier','taker','shift','discount','refund'],
    x:['shift','cashier'],
    y:['date','payment','ordertype','cashier'],
    z:['date','shift','cashier'],
    discount:['date','cashier','taker','discount'],
    voidrefund:['date','cashier','refund'],
    ordertype:['date','ordertype','cashier','taker']
  }[reportType]||['date'];
  $$('.report-filter').forEach(el=>{ el.style.display = visible.some(v=>el.classList.contains(v+'-filter')) ? '' : 'none'; });
  if(reportType==='discount' && $('#discountOnly')) $('#discountOnly').checked=true;
  if(reportType==='voidrefund' && $('#refundOnly')) $('#refundOnly').checked=true;
}
function reportQuery(){
  const params = new URLSearchParams();
  params.set('type', reportType);
  const map = {from:'fromDate',to:'toDate',paymentMode:'paymentMode',orderType:'orderType',itemId:'itemId',categoryId:'categoryFilter',cashierId:'cashierId',orderTakerId:'orderTakerId',shiftId:'shiftId'};
  for(const [k,id] of Object.entries(map)){ const el=$('#'+id); if(el && el.value) params.set(k,el.value); }
  if($('#discountOnly')?.checked) params.set('discountOnly','1');
  if($('#refundOnly')?.checked) params.set('refundOnly','1');
  return params.toString();
}
function reportHeaderHtml(r){
  const filters = r.filters || {};
  const range = `${filters.from||''} to ${filters.to||''}`;
  return `<div class="receipt report-receipt wide-report"><h3>${esc(state.settings.businessName||'SwiftTill POS')}</h3><div class="c">${esc(state.settings.branchName||'')}</div><div class="c">${esc(state.settings.address||'')} ${state.settings.phone?'• '+esc(state.settings.phone):''}</div><div class="sep"></div><div class="r"><span>Report</span><span>${esc(currentReportTitle())}</span></div><div class="r"><span>Range</span><span>${esc(range)}</span></div><div class="r"><span>Printed</span><span>${new Date().toLocaleString()}</span></div><div class="sep"></div>`;
}
function reportSummaryCards(r){
  return `<div class="report-grid">
    <div class="card metric"><p>Orders</p><h3>${r.summary.orders}</h3></div>
    <div class="card metric"><p>Gross</p><h3>${money(r.summary.gross)}</h3></div>
    <div class="card metric"><p>Discount</p><h3>${money(r.summary.discounts)}</h3></div>
    <div class="card metric"><p>Refund</p><h3>${money(r.summary.refunds)}</h3></div>
    <div class="card metric"><p>Net</p><h3>${money(r.summary.net)}</h3></div>
    <div class="card metric"><p>Avg Bill</p><h3>${money(r.summary.averageBill)}</h3></div>
  </div>`;
}
function rowsHtml(rows, cols){ return `<div class="report-table-wrap"><table class="admin-table"><thead><tr>${cols.map(c=>`<th>${esc(c[0])}</th>`).join('')}</tr></thead><tbody>${rows.length?rows.map(row=>`<tr>${cols.map(c=>`<td>${esc(c[2]?c[2](row[c[1]],row):row[c[1]])}</td>`).join('')}</tr>`).join(''):`<tr><td colspan="${cols.length}">No data for selected filters.</td></tr>`}</tbody></table></div>`; }
function reportBodyHtml(r){
  if(reportType==='itemwise') return `<div class="card subcard"><h3>Item Wise Sales</h3>${rowsHtml(r.itemWise,[['Item','item'],['Category','category'],['Qty','qty'],['Sales','sales',v=>money(v)]])}</div>`;
  if(reportType==='category') return `<div class="card subcard"><h3>Category Wise Sales</h3>${rowsHtml(Object.entries(r.categoryWise).map(([category,sales])=>({category,sales})),[['Category','category'],['Sales','sales',v=>money(v)]])}</div>`;
  if(reportType==='payment') return `<div class="card subcard"><h3>Payment Mode Summary</h3>${rowsHtml(Object.entries(r.paymentWise).map(([method,amount])=>({method,amount})),[['Payment Mode','method'],['Amount','amount',v=>money(v)]])}</div>`;
  if(reportType==='discount') return `<div class="card subcard"><h3>Discount Report</h3><p>Discounted Bills: <b>${r.discountWise.count}</b></p><p>Total Discount: <b>${money(r.discountWise.amount)}</b></p>${billDetailsTable(r.orders.filter(o=>Number(o.discount||0)>0))}</div>`;
  if(reportType==='voidrefund') return `<div class="card subcard"><h3>Void / Refund Report</h3><p>Void Orders: <b>${r.voidOrders.length}</b></p><p>Refund Entries: <b>${r.refunds.length}</b></p><p>Refund Amount: <b>${money(r.summary.refunds)}</b></p>${rowsHtml(r.refunds||[],[['Bill','orderNumber'],['Date','createdAt',v=>v?new Date(v).toLocaleString():'' ],['Method','method'],['Amount','amount',v=>money(v)],['Reason','reason'],['By','by']])}</div>`;
  if(reportType==='ordertype') return `<div class="card subcard"><h3>Order Type Summary</h3>${rowsHtml(Object.entries(r.orderTypeWise).map(([type,amount])=>({type:formatType(type),amount})),[['Order Type','type'],['Sales','amount',v=>money(v)]])}</div>${billDetailsTable(r.orders)}`;
  if(reportType==='x'||reportType==='z') return `<div class="grid2"><div class="card subcard"><h3>${esc(currentReportTitle())}</h3><p>Active shift: <b>${state.activeShift ? '#'+state.activeShift.number+' open' : 'No active shift'}</b></p><p>Opening Cash: <b>${money(r.shiftSummary?.openingCash||0)}</b></p><p>Cash Sales: <b>${money(r.shiftSummary?.cashSales||0)}</b></p><p>Expected Cash: <b>${money(r.shiftSummary?.expectedCash||0)}</b></p></div><div class="card subcard"><h3>Payments</h3>${Object.entries(r.paymentWise).map(([k,v])=>`<p>${esc(k)}: <b>${money(v)}</b></p>`).join('')||'<p>No payments.</p>'}</div></div>${billDetailsTable(r.orders)}`;
  return `${reportSummaryCards(r)}<div class="grid2 mt"><div class="card subcard"><h3>Payment Mode</h3>${Object.entries(r.paymentWise).map(([k,v])=>`<p>${esc(k)}: <b>${money(v)}</b></p>`).join('')||'<p>No payments.</p>'}</div><div class="card subcard"><h3>Order Type</h3>${Object.entries(r.orderTypeWise).map(([k,v])=>`<p>${formatType(k)}: <b>${money(v)}</b></p>`).join('')||'<p>No sales.</p>'}</div></div>${billDetailsTable(r.orders)}`;
}
function billDetailsTable(orders){ return `<div class="card subcard mt"><h3>Bill Details</h3>${rowsHtml(orders||[],[['Bill','number',v=>'#'+v],['Date','date',v=>v?new Date(v).toLocaleString():'' ],['Type','type',v=>formatType(v)],['Table','table'],['Customer','customer'],['Taker','orderTaker'],['Cashier','cashier'],['Discount','discount',v=>money(v)],['Total','total',v=>money(v)],['Payments','payments']])}</div>`; }
async function loadReport(){
  const target=$('#reportResult');
  if(target) target.innerHTML='<div class="empty-cart"><b>Loading report...</b><p>Reading paid bills from Neon.</p></div>';
  try{
    const j=await api(`/api/reports?${reportQuery()}`,null,'GET'); const r=j.data;
    if(!$('#reportResult')) return;
    $('#reportResult').innerHTML=`<div id="printReportArea" class="report-print-wrap">${reportHeaderHtml(r)}${reportBodyHtml(r)}<div class="sep"></div><div class="c">${esc(state.settings.reportFooter||'Generated by SwiftTill POS')}</div></div></div>`;
  }catch(e){ const target=$('#reportResult'); if(target) target.innerHTML=`<div class="empty-cart error-state"><b>Report failed</b><p>${esc(e.message)}</p></div>`; toast(e.message,true);}
}
function renderAdmin(ws){
  const tabs=['dashboard','setup','reports','paid','categories','items','deals','tables','takers','payments','users','roles','settings'];
  ws.innerHTML=`<div class="admin-layout"><div class="panel admin-nav"><div class="admin-nav-title"><b>Admin Panel</b><span>Back office</span></div>${tabs.map(t=>`<button class="${adminTab===t?'active':''}" data-admin-tab="${t}"><span class="admin-nav-icon">${tabIcon(t)}</span><span>${labelTab(t)}</span></button>`).join('')}</div><div class="panel admin-content" id="adminContent"></div></div>`;
  $$('[data-admin-tab]').forEach(b=>b.onclick=()=>{adminTab=b.dataset.adminTab;renderAdmin(ws);});
  renderAdminContent();
}
function labelTab(t){ return ({setup:'Restaurant Setup',takers:'Order Takers',roles:'Roles & Permissions',settings:'Company / Branding',payments:'Payment Methods',paid:'Paid Orders',backup:'Backup / History'}[t] || t[0].toUpperCase()+t.slice(1)); }
function tabIcon(t){ return ({dashboard:'⌂',setup:'✓',reports:'▥',paid:'▤',categories:'◫',items:'🍔',deals:'%',tables:'▣',takers:'👥',payments:'₨',users:'👤',roles:'🔐',settings:'⚙',backup:'↧'}[t]||'•'); }
function renderAdminContent(){
  const c=$('#adminContent');
  if(adminTab==='dashboard') return c.innerHTML=`<div class="admin-hero"><div class="admin-hero-title"><h3>Control Center</h3><p>Restaurant setup, menu management, reports, printing and secure access controls.</p></div><div class="admin-status-pill ${state.setup?.complete?'ok':'warn'}">${state.setup?.complete?'Ready':'Setup Pending'}</div></div><div class="report-grid admin-kpi-grid"><div class="card metric"><p>Categories</p><h3>${state.categories.length}</h3></div><div class="card metric"><p>Menu Items</p><h3>${state.items.length}</h3></div><div class="card metric"><p>Tables</p><h3>${state.tables.length}</h3></div><div class="card metric"><p>Open Orders</p><h3>${state.openOrders.length}</h3></div><div class="card metric"><p>Paid Bills</p><h3>${state.paidOrders.length}</h3></div><div class="card metric"><p>Users</p><h3>${state.users.length}</h3></div></div><div class="grid2 mt"><div class="card subcard admin-action-card"><h3>Operational Shortcuts</h3><button class="ghost-btn" onclick="adminTab='reports';renderAdminContent()">Reports</button><button class="ghost-btn" onclick="adminTab='items';renderAdminContent()">Menu Items</button><button class="ghost-btn" onclick="adminTab='settings';renderAdminContent()">Company & Receipt</button><button class="ghost-btn" onclick="adminTab='setup';renderAdminContent()">Setup Checklist</button></div><div class="card subcard recent-audit-card"><h3>Recent Audit</h3>${state.auditLogs.slice(0,8).map(a=>`<p><b>${esc(a.action.replace(/_/g,' '))}</b><span>${esc(a.userName)} • ${new Date(a.createdAt).toLocaleString()}</span></p>`).join('') || '<p>No audit yet.</p>'}</div></div>`;
  if(adminTab==='setup') return renderSetup(c);
  if(adminTab==='reports') return renderReports(c);
  if(adminTab==='paid') return renderPaidOrders(c);
  if(adminTab==='categories') return adminList(c,'categories','category',['name','sort','active']);
  if(adminTab==='items') return adminList(c,'items','item',['name','categoryId','price','active','soldOut']);
  if(adminTab==='deals') return adminList(c,'deals','deal',['name','price','active']);
  if(adminTab==='tables') return adminList(c,'tables','table',['name','seats','active']);
  if(adminTab==='takers') return adminList(c,'orderTakers','taker',['name','active']);
  if(adminTab==='payments') return adminList(c,'paymentMethods','payment',['name','active']);
  if(adminTab==='users') return adminList(c,'users','user',['name','email','roleIds','active']);
  if(adminTab==='roles') return adminList(c,'roles','role',['name','description','permissions','active']);
  if(adminTab==='settings') return renderSettings(c);
  if(adminTab==='cloud'){ adminTab='settings'; return renderSettings(c); }
  if(adminTab==='backup') return renderBackup(c);
}
function adminList(c,key,apiName,fields){ const rows=state[key]||[]; c.innerHTML=`<div class="admin-wrap"><div class="module-title"><h3>${labelTab(key)}</h3><button class="primary-btn" onclick="openAdminEditor('${apiName}')">Add New</button></div><table class="admin-table"><thead><tr><th>Image</th>${fields.map(f=>`<th>${esc(f)}</th>`).join('')}<th>Action</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.imageUrl?`<img class="thumb" src="${esc(r.imageUrl)}">`:''}</td>${fields.map(f=>`<td>${esc(renderVal(r[f],f))}</td>`).join('')}<td><button class="ghost-btn" onclick='openAdminEditor("${apiName}",${JSON.stringify(r).replace(/'/g,"&#39;")})'>Edit</button><button class="danger-btn tiny" onclick='deleteAdminRecord("${apiName}","${esc(r.id)}")'>Delete</button></td></tr>`).join('')}</tbody></table></div>`; }
function renderVal(v,f){ if(v===true)return'Yes'; if(v===false)return'No'; if(f==='categoryId') return state.categories.find(c=>c.id===v)?.name || v || ''; if(f==='roleIds') return (v||[]).map(id=>state.roles.find(r=>r.id===id)?.name||id).join(', '); if(f==='permissions') return (v||[]).length + ' permissions'; return Array.isArray(v) ? v.join(', ') : (v ?? ''); }
function hiddenId(r){return r.id?`<input type="hidden" name="id" value="${esc(r.id)}">`:''} function input(n,l,v='',type='text',attrs=''){return `<div class="field"><label>${l}</label><input name="${n}" type="${type}" value="${esc(v)}" ${attrs}></div>`} function priceInput(v,label='Price'){return `<div class="field price-field"><label>${label} <b class="required-star">*</b></label><input name="price" type="number" min="1" step="1" value="${esc(v || '')}" required placeholder="Enter sale price, e.g. 450"><small>Required for billing. Rs 0 items cannot be sold.</small></div>`} function check(n,l,v){return `<label class="check mb"><input type="checkbox" name="${n}" ${v?'checked':''}> ${l}</label>`} function select(n,l,v,opts){return `<div class="field"><label>${l}</label><select name="${n}">${opts.map(o=>`<option value="${esc(o[0])}" ${o[0]===v?'selected':''}>${esc(o[1])}</option>`).join('')}</select></div>`} function multiRoles(selected=[]){return `<div class="field"><label>Roles</label><div class="perm-grid">${state.roles.filter(r=>r.active).map(r=>`<label class="perm-chip"><input type="checkbox" name="roleIds" value="${esc(r.id)}" ${selected.includes(r.id)?'checked':''}> ${esc(r.name)}</label>`).join('')}</div></div>`} function permChecks(selected=[]){return `<div class="field"><label>Permissions</label><div class="perm-grid">${state.permissionCatalog.map(p=>`<label class="perm-chip"><input type="checkbox" name="permissions" value="${esc(p)}" ${selected.includes(p)?'checked':''}> ${esc(p)}</label>`).join('')}</div></div>`} function imageField(v){return `<div class="field"><label>Image</label>${v?`<img class="thumb" src="${esc(v)}">`:''}<input name="uploadFile" type="file" accept="image/*"><input name="imageUrl" value="${esc(v||'')}" placeholder="Or image URL"></div>`}
function openAdminEditor(kind, record={}){ let body=''; if(kind==='category') body=`${hiddenId(record)}${input('name','Name',record.name)}${input('sort','Sort',record.sort||0,'number')}${imageField(record.imageUrl)}${check('active','Active',record.active!==false)}`; if(kind==='item') body=`${hiddenId(record)}${input('name','Item Name',record.name)}${select('categoryId','Category',record.categoryId,state.categories.filter(c=>c.id!=='cat_all' && c.id!=='all').map(c=>[c.id,c.name]))}${priceInput(record.price,'Sale Price')}${imageField(record.imageUrl)}${check('active','Active',record.active!==false)}${check('soldOut','Sold Out',!!record.soldOut)}`; if(kind==='deal') body=`${hiddenId(record)}${input('name','Deal Name',record.name)}${input('description','Description',record.description||'')}${priceInput(record.price,'Sale Price')}${imageField(record.imageUrl)}${check('active','Active',record.active!==false)}`; if(kind==='table') body=`${hiddenId(record)}${input('name','Table Name',record.name)}${input('seats','Seats',record.seats||4,'number')}${check('active','Active',record.active!==false)}`; if(kind==='taker') body=`${hiddenId(record)}${input('name','Order Taker Name',record.name)}${check('active','Active',record.active!==false)}`; if(kind==='payment') body=`${hiddenId(record)}${input('name','Payment Method Name',record.name)}${check('active','Active',record.active!==false)}`; if(kind==='user') body=`${hiddenId(record)}${input('name','Name',record.name)}${input('email','Email',record.email||'')}<div class="field"><label>${record.id?'New Password':'Password'} ${record.id?'':'*'}</label><input name="password" type="password" value="" minlength="8" placeholder="${record.id?'Leave blank to keep current password':'Minimum 8 characters'}"></div>${multiRoles(record.roleIds||[])}<div class="field"><label>PIN</label><input name="pin" type="password" value="" placeholder="Leave blank to keep current PIN"></div>${check('active','Active',record.active!==false)}`; if(kind==='role') body=`${hiddenId(record)}${input('name','Role Name',record.name)}${input('description','Description',record.description||'')}${permChecks(record.permissions||[])}${check('active','Active',record.active!==false)}`; openModal(`<div class="modal-head"><h2>${record.id?'Edit':'Add'} ${esc(kind)}</h2><button class="x" onclick="closeModal()">×</button></div><form id="adminForm">${body}<button class="primary-btn" style="width:100%">Save</button></form>`, kind==='role'); $('#adminForm').onsubmit=async e=>{e.preventDefault(); const fd=new FormData(e.target); const data=Object.fromEntries(fd); ['active','soldOut'].forEach(k=>{ if(kind==='item'||kind==='category'||kind==='deal'||kind==='table'||kind==='taker'||kind==='payment'||kind==='user'||kind==='role') data[k]=fd.has(k); }); if(kind==='user') data.roleIds=fd.getAll('roleIds'); if(kind==='role') data.permissions=fd.getAll('permissions'); ['price','sort','seats'].forEach(k=>{if(k in data)data[k]=Number(data[k]||0)}); if((kind==='item'||kind==='deal') && Number(data.price||0)<=0){ toast('Sale Price is required and must be greater than 0', true); return; } try{ const file=fd.get('uploadFile'); if(file && file.size){ data.imageUrl = await uploadFile(file, kind); } delete data.uploadFile; await api(`/api/admin/${kind}`,data); closeModal(); await loadState(); renderShell(); toast('Saved'); }catch(err){toast(err.message,true);} }; }
function uploadFile(file, folder='uploads'){ setBusy(true); return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=async()=>{try{const j=await api('/api/upload-image',{filename:file.name,dataUrl:r.result,folder});resolve(j.url)}catch(e){reject(e)} finally { setBusy(false); }}; r.onerror=()=>{ setBusy(false); reject(new Error('File read failed')); }; r.readAsDataURL(file); }); }
async function deleteAdminRecord(kind,id){ if(!confirm('Delete this record?')) return; try{ await api(`/api/admin/${kind}`,{id},'DELETE'); await loadState(); renderShell(); toast('Deleted'); }catch(e){ toast(e.message,true); } }
function renderPaidOrders(c){
  const orders = state.paidOrders || [];
  c.innerHTML=`<div class="module-title"><div><h3>Paid Orders</h3><p class="muted-note">Admin-controlled paid bills. Refund, payment correction and reopen/edit require manager PIN and permissions.</p></div></div><div class="card subcard"><div class="report-table-wrap"><table class="admin-table"><thead><tr><th>Bill</th><th>Date</th><th>Type</th><th>Table</th><th>Customer</th><th>Total</th><th>Payments</th><th>Actions</th></tr></thead><tbody>${orders.map(o=>{ const tt=calcTotals(o); const table=state.tables.find(t=>t.id===o.tableId)?.name||''; const payments=(o.payments||[]).map(p=>`${p.method} ${money(p.amount)}`).join(', '); return `<tr><td>#${esc(o.number)}</td><td>${esc(new Date(o.paidAt||o.createdAt).toLocaleString())}</td><td>${formatType(o.type)}</td><td>${esc(table)}</td><td>${esc(o.customerName||o.mobile||'')}</td><td><b>${money(tt.total)}</b></td><td>${esc(payments)}</td><td><button class="ghost-btn tiny" data-paid-view="${esc(o.id)}">View</button><button class="ghost-btn tiny" data-paid-correct="${esc(o.id)}">Change Payment</button><button class="danger-btn tiny" data-paid-refund="${esc(o.id)}">Refund</button><button class="secondary-btn tiny" data-paid-reopen="${esc(o.id)}">Reopen/Edit</button></td></tr>`; }).join('') || '<tr><td colspan="8">No paid orders yet.</td></tr>'}</tbody></table></div></div>`;
  $$('[data-paid-view]').forEach(b=>b.onclick=()=>{ const o=orders.find(x=>x.id===b.dataset.paidView); if(!o)return; const r=receiptFromOrder(o); showReceiptModal(r,false); });
  $$('[data-paid-refund]').forEach(b=>b.onclick=()=>openRefundModal(b.dataset.paidRefund));
  $$('[data-paid-correct]').forEach(b=>b.onclick=()=>openPaymentCorrectionModal(b.dataset.paidCorrect));
  $$('[data-paid-reopen]').forEach(b=>b.onclick=()=>openReopenPaidModal(b.dataset.paidReopen));
}
function receiptFromOrder(o){ const table=state.tables.find(t=>t.id===o.tableId)?.name||''; return {business:state.settings.businessName,branchName:state.settings.branchName,phone:state.settings.phone,address:state.settings.address,logoUrl:state.settings.logoUrl,header:state.settings.receiptHeader,footer:state.settings.receiptFooter,receiptWidth:state.settings.receiptWidth,showLogoOnReceipt:state.settings.showLogoOnReceipt,showCustomerOnReceipt:state.settings.showCustomerOnReceipt,showOrderTakerOnReceipt:state.settings.showOrderTakerOnReceipt,showCashierOnReceipt:state.settings.showCashierOnReceipt,showPaymentBreakdown:state.settings.showPaymentBreakdown,number:o.number,date:o.paidAt||o.createdAt,cashier:o.cashierName,type:o.type,table,guests:o.guests,orderTaker:o.orderTakerName,customer:o.customerName,mobile:o.mobile,lines:o.lines,totals:calcTotals(o),payments:o.payments||[]}; }
function openRefundModal(orderId){
  const o=(state.paidOrders||[]).find(x=>x.id===orderId); if(!o)return; const tt=calcTotals(o);
  openModal(`<div class="modal-head"><h2>Refund Bill #${esc(o.number)}</h2><button class="x" onclick="closeModal()">×</button></div><div class="pay-total-card"><span>Paid total</span><b>${money(tt.total)}</b></div><div class="grid2"><div class="field"><label>Refund Amount</label><input id="refundAmount" type="number" value="${tt.total}"></div><div class="field"><label>Refund Method</label><select id="refundMethod"><option>Cash</option><option>Card</option><option>Online</option></select></div></div><div class="field"><label>Reason</label><input id="refundReason" value="Customer return / correction"></div><div class="field"><label>Manager PIN</label><input id="refundPin" type="password"></div><button class="danger-btn" id="doRefund" style="width:100%">Refund</button>`);
  $('#doRefund').onclick=async()=>{try{await api('/api/orders/refund',{id:orderId,amount:Number($('#refundAmount').value||0),method:$('#refundMethod').value,reason:$('#refundReason').value,managerPin:$('#refundPin').value}); closeModal(); await loadState(); renderShell(); toast('Refund saved');}catch(e){toast(e.message,true)}};
}
function openPaymentCorrectionModal(orderId){
  const o=(state.paidOrders||[]).find(x=>x.id===orderId); if(!o)return; const tt=calcTotals(o);
  openModal(`<div class="modal-head"><h2>Change Payment #${esc(o.number)}</h2><button class="x" onclick="closeModal()">×</button></div><div class="pay-total-card"><span>Bill Total</span><b>${money(tt.total)}</b></div><div class="grid3"><div class="field"><label>Cash</label><input id="pcCash" type="number" value="${(o.payments||[]).find(p=>p.method==='Cash')?.received || (o.payments||[]).find(p=>p.method==='Cash')?.amount || 0}"></div><div class="field"><label>Card</label><input id="pcCard" type="number" value="${(o.payments||[]).find(p=>p.method==='Card')?.amount || 0}"></div><div class="field"><label>Online</label><input id="pcOnline" type="number" value="${(o.payments||[]).find(p=>p.method==='Online')?.amount || 0}"></div></div><div class="split-summary"><div><span>Received</span><b id="pcPaid">${money(0)}</b></div><div><span id="pcBalanceLabel">Remaining</span><b id="pcRemain">${money(tt.total)}</b></div><div><span>Total</span><b>${money(tt.total)}</b></div></div><div class="field"><label>Manager PIN</label><input id="pcPin" type="password"></div><button class="primary-btn" id="doPaymentCorrection" style="width:100%">Save Payment Correction</button>`);
  const upd=()=>{ const cash=Number($('#pcCash').value||0), card=Number($('#pcCard').value||0), online=Number($('#pcOnline').value||0); const paid=cash+card+online; const rem=tt.total-paid; $('#pcPaid').textContent=money(paid); $('#pcBalanceLabel').textContent=rem<0?'Change / Extra':'Remaining'; $('#pcRemain').textContent=money(Math.abs(rem)); $('#pcRemain').classList.toggle('danger-text',rem>0); $('#pcRemain').classList.toggle('ok-text',rem<=0); };
  ['pcCash','pcCard','pcOnline'].forEach(id=>$('#'+id).addEventListener('input',upd)); upd();
  $('#doPaymentCorrection').onclick=async()=>{try{await api('/api/admin/payment-correction',{id:orderId,cash:Number($('#pcCash').value||0),card:Number($('#pcCard').value||0),online:Number($('#pcOnline').value||0),managerPin:$('#pcPin').value}); closeModal(); await loadState(); renderShell(); toast('Payment corrected');}catch(e){toast(e.message,true)}};
}
function openReopenPaidModal(orderId){
  const o=(state.paidOrders||[]).find(x=>x.id===orderId); if(!o)return;
  openModal(`<div class="modal-head"><h2>Reopen Paid Bill #${esc(o.number)}</h2><button class="x" onclick="closeModal()">×</button></div><p class="muted-note">This moves the bill back to Open Orders for edit and repayment. Admin/manager control only.</p><div class="field"><label>Manager PIN</label><input id="reopenPin" type="password"></div><button class="danger-btn" id="doReopenPaid" style="width:100%">Reopen for Edit</button>`);
  $('#doReopenPaid').onclick=async()=>{try{const j=await api('/api/admin/reopen-paid',{id:orderId,managerPin:$('#reopenPin').value}); currentOrder=j.order; screen='pos'; centerMode='menu'; closeModal(); await loadState(); renderShell(); toast('Bill reopened');}catch(e){toast(e.message,true)}};
}
function renderSettings(c){
  const s=state.settings;
  c.innerHTML=`<div class="module-title"><div><h3>Company, Branding, Receipt & Printer</h3><p class="muted-note">Manage restaurant profile, branch, receipt layout, report header and local print-agent settings.</p></div></div><form id="settingsForm" class="settings-layout">
    <div class="card subcard"><h3>Organization / Company</h3>${input('businessName','Display Business Name',s.businessName)}${input('legalName','Legal / Organization Name',s.legalName||s.businessName)}${input('branchName','Branch Name',s.branchName)}${input('branchCode','Branch Code',s.branchCode||'MAIN')}${input('phone','Phone / Contact',s.phone)}${input('email','Email',s.email||'')}${input('website','Website',s.website||'')}${input('city','City',s.city||'')}${input('country','Country',s.country||'Pakistan')}<div class="field"><label>Complete Address</label><textarea name="address" rows="3">${esc(s.address||'')}</textarea></div></div>
    <div class="card subcard"><h3>Branding</h3>${imageField(s.logoUrl)}<p class="muted-note">Logo is used on admin, receipt preview and future cloud/customer reports.</p>${input('currency','Currency',s.currency||'PKR')}${input('taxRegistrationNo','Tax / NTN / STRN No.',s.taxRegistrationNo||'')}${input('invoicePrefix','Invoice Prefix',s.invoicePrefix||'ST')}${input('legalInvoiceFooter','Legal Invoice Footer',s.legalInvoiceFooter||'')}</div>
    <div class="card subcard"><h3>Receipt Format</h3>${select('receiptWidth','Thermal Paper Width',s.receiptWidth||'80mm',[['80mm','80mm'],['58mm','58mm']])}${input('receiptCopies','Receipt Copies',s.receiptCopies||1,'number')}${input('receiptHeader','Receipt Header',s.receiptHeader)}${input('receiptFooter','Receipt Footer',s.receiptFooter)}<label class="check mb"><input type="checkbox" name="showLogoOnReceipt" ${s.showLogoOnReceipt?'checked':''}> Show logo on receipt</label><label class="check mb"><input type="checkbox" name="showCustomerOnReceipt" ${s.showCustomerOnReceipt?'checked':''}> Show customer details</label><label class="check mb"><input type="checkbox" name="showOrderTakerOnReceipt" ${s.showOrderTakerOnReceipt?'checked':''}> Show order taker</label><label class="check mb"><input type="checkbox" name="showCashierOnReceipt" ${s.showCashierOnReceipt?'checked':''}> Show cashier</label><label class="check mb"><input type="checkbox" name="showPaymentBreakdown" ${s.showPaymentBreakdown?'checked':''}> Show payment breakdown</label><button type="button" class="ghost-btn" id="receiptPreviewBtn">Preview Receipt</button><button type="button" class="ghost-btn" id="testPrintAgentBtn">Test Print Agent</button><button type="button" class="ghost-btn" id="changePasswordBtn">Change Password</button></div>
    <div class="card subcard"><h3>Printer / Report</h3>${input('printerName','Printer Name',s.printerName||'Windows Default Printer')}${input('localAgentUrl','Local Print Agent URL',s.localAgentUrl||'http://127.0.0.1:9721/print')}${input('defaultDeliveryFee','Default Delivery Fee',s.defaultDeliveryFee,'number')}<div class="field"><label>Manager PIN</label><input name="managerPin" type="password" value="" placeholder="Leave blank to keep current PIN"></div>${input('reportTitle','Report Title',s.reportTitle||'Sales Report')}${input('reportFooter','Report Footer',s.reportFooter||'Generated by SwiftTill POS')}<label class="check mb"><input type="checkbox" name="autoPrintReceipt" ${s.autoPrintReceipt?'checked':''}> Auto print receipt</label><label class="check mb"><input type="checkbox" name="rememberPrintChoice" ${s.rememberPrintChoice?'checked':''}> Remember print choice</label><label class="check mb"><input type="checkbox" name="reportShowBranding" ${s.reportShowBranding?'checked':''}> Show branding on reports</label></div>
    <div class="settings-save"><button class="primary-btn">Save Company & Format Settings</button></div>
  </form>`;
  $('#testPrintAgentBtn') && ($('#testPrintAgentBtn').onclick=()=>testPrintAgent()); $('#changePasswordBtn') && ($('#changePasswordBtn').onclick=()=>openChangePasswordModal());
  $('#receiptPreviewBtn').onclick=()=>{ const latest=(state.paidOrders&&state.paidOrders[0]) || (currentOrder&&currentOrder.lines&&currentOrder.lines.length?currentOrder:null); if(!latest) return toast('No real order available for receipt preview. Create or open an order first.', true); ensurePrintArea().innerHTML=receiptHTML(receiptFromOrder(latest)); setTimeout(()=>window.print(),120); };
  $('#settingsForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);const data=Object.fromEntries(fd);['autoPrintReceipt','rememberPrintChoice','showLogoOnReceipt','showCustomerOnReceipt','showOrderTakerOnReceipt','showCashierOnReceipt','showPaymentBreakdown','reportShowBranding'].forEach(k=>data[k]=fd.has(k));['defaultDeliveryFee','receiptCopies'].forEach(k=>{data[k]=Number(data[k]||0)}); if(!String(data.managerPin||'').trim()) delete data.managerPin; try{ const file=fd.get('uploadFile'); if(file && file.size){ data.logoUrl = await uploadFile(file, 'logo'); } else if(data.imageUrl){ data.logoUrl = data.imageUrl; } delete data.uploadFile; delete data.imageUrl; await api('/api/admin/settings',data);await loadState();renderShell();toast('Settings saved');}catch(err){toast(err.message,true);}};
}
function renderCloud(c){ c.innerHTML=`<div class="card subcard"><h3>Cloud settings hidden</h3><p class="muted-note">Render, Neon and Cloudflare credentials are owner/developer settings and are not shown to restaurant staff.</p></div>`; }
function renderBackup(c){ const b=state.backup||{}; c.innerHTML=`<div class="module-title"><div><h3>Backup, History & Retention</h3><p class="muted-note">Orders/reports history stays in Neon. Daily backup snapshots use Cloudflare R2 when configured.</p></div></div><div class="grid2"><div class="card subcard"><h3>Backup Status</h3><p>Mode: <b>${esc(b.mode||'cloud/database')}</b></p><p>Backups indexed: <b>${b.total||0}</b></p><p>Daily retention: <b>${b.dailyRetentionDays||30} days</b></p><p>Monthly retention: <b>${b.monthlyRetentionMonths||12} months</b></p><p>Latest: <b>${b.latest?new Date(b.latest.exportedAt).toLocaleString():'Not created yet'}</b></p><button class="ghost-btn" id="refreshBackupStatus">Refresh Status</button></div><div class="card subcard"><h3>Create Backup</h3><p class="muted-note">Creates a R2 JSON backup if R2 is configured and also indexes it in Neon state.</p><button class="primary-btn" id="createBackup">Create Cloud Backup</button><button class="ghost-btn mt" id="downloadBackup">Download Backup JSON</button></div><div class="card subcard"><h3>Restore Backup</h3><p class="muted-note">Use only with a SwiftTill backup JSON file. Paid order history is restored exactly from file.</p><input type="file" id="restoreFile" accept="application/json"><button class="danger-btn mt" id="restoreBtn">Restore</button></div><div class="card subcard"><h3>History Rule</h3><p>Deleting menu item/category/deal removes it from live menu only.</p><p>Old paid bills and reports keep line name, price and category snapshot.</p><p>Replacing/deleting media removes old R2 object when it is not reused.</p></div></div>`; $('#refreshBackupStatus').onclick=async()=>{try{const j=await api('/api/backup/status',null,'GET'); state.backup=j.backup; renderBackup(c);}catch(e){toast(e.message,true)}}; $('#createBackup').onclick=async()=>{try{const j=await api('/api/backup/create',{type:'manual'}); state.backup=j.summary; toast('Backup created'); renderBackup(c);}catch(e){toast(e.message,true)}}; $('#downloadBackup').onclick=()=>downloadApi('/api/backup/download',`swifttill-backup-${Date.now()}.json`).catch(e=>toast(e.message,true)); $('#restoreBtn').onclick=()=>{const file=$('#restoreFile').files[0];if(!file)return toast('Choose backup file',true);const r=new FileReader();r.onload=async()=>{try{await api('/api/backup/restore',JSON.parse(r.result));await loadState();renderShell();toast('Backup restored');}catch(e){toast(e.message,true)}};r.readAsText(file);}; }
setInterval(refreshLiveTimers,1000);
// SwiftTill V30: boot delayed until all overrides are registered.

/* V23 Professional POS Reports: rebuilt screen, totals, closeout layout and receipt-style print. */
function currentReportTitle(){
  return ({daily:'Daily Sales Summary',itemwise:'Item Wise Sales Report',category:'Category Wise Sales Report',payment:'Payment Method Reconciliation',custom:'Custom Detailed Sales Report',x:'X Report - Live Shift',y:'Y Report - Period Summary',z:'Z Report - End Shift Closeout',discount:'Discount Report',voidrefund:'Void / Refund Report',ordertype:'Order Type Performance'}[reportType] || 'Sales Report');
}
function moneyCell(v){ return money(Number(v||0)); }
function reportHeaderHtml(r){
  const range = `${r.range?.from || 'Start'} to ${r.range?.to || 'Now'}`;
  return `<div class="receipt report-receipt wide-report professional-report"><div class="report-slip-head"><h3>${esc(state.settings.businessName||'SwiftTill POS')}</h3><div class="c">${esc(state.settings.branchName||'Main Branch')}</div><div class="c small">${esc(state.settings.address||'')} ${state.settings.phone?'• '+esc(state.settings.phone):''}</div></div><div class="sep"></div><div class="r"><span>Report</span><b>${esc(currentReportTitle())}</b></div><div class="r"><span>Range</span><span>${esc(range)}</span></div><div class="r"><span>Printed</span><span>${new Date().toLocaleString()}</span></div><div class="r"><span>Cashier/User</span><span>${esc(state.user?.name||'')}</span></div><div class="sep"></div>`;
}
function metric(label,value,sub=''){ return `<div class="pro-metric"><span>${esc(label)}</span><b>${esc(value)}</b>${sub?`<small>${esc(sub)}</small>`:''}</div>`; }
function reportSummaryCards(r){
  const s=r.summary||{};
  return `<div class="pro-summary-grid">
    ${metric('Gross Sales',moneyCell(s.gross),'Before discounts/refunds')}
    ${metric('Discounts',moneyCell(s.discounts),'Bill level discount')}
    ${metric('Refunds',moneyCell(s.refunds),'Returned amount')}
    ${metric('Net Sales',moneyCell(s.net),'Final revenue')}
    ${metric('Total Orders',String(s.orders||0),'Paid bills')}
    ${metric('Guests',String(s.guests||0),'Dine-in guests')}
    ${metric('Average Bill',moneyCell(s.averageBill),'Net ÷ orders')}
    ${metric('Change Returned',moneyCell(s.changeReturned),'Cash change only')}
  </div>`;
}
function rowsHtml(rows, cols, totals){
  const body = rows.length ? rows.map(row=>`<tr>${cols.map(c=>`<td class="${c[3]||''}">${esc(c[2]?c[2](row[c[1]],row):row[c[1]])}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${cols.length}" class="empty-td">No data for selected filters.</td></tr>`;
  const foot = totals ? `<tfoot><tr>${cols.map((c,i)=>`<th>${esc(totals[c[1]] ?? (i===0?'TOTAL':''))}</th>`).join('')}</tr></tfoot>` : '';
  return `<div class="report-table-wrap"><table class="admin-table pro-table"><thead><tr>${cols.map(c=>`<th>${esc(c[0])}</th>`).join('')}</tr></thead><tbody>${body}</tbody>${foot}</table></div>`;
}
function sumRows(rows,k){ return (rows||[]).reduce((s,r)=>s+Number(r[k]||0),0); }
function billDetailsTable(rows){
  return `<div class="card subcard report-block"><h3>Bill Details</h3>${rowsHtml(rows||[],[
    ['Bill','number'],['Date','date',v=>v?new Date(v).toLocaleString():'' ],['Type','type',v=>formatType(v)],['Table','table'],['Guest','guests'],['Customer','customer'],['Cashier','cashier'],['Subtotal','subtotal',moneyCell,'num'],['Discount','discount',moneyCell,'num'],['Delivery','deliveryFee',moneyCell,'num'],['Total','total',moneyCell,'num'],['Payments','payments']
  ], { number:'TOTAL', subtotal:moneyCell(sumRows(rows,'subtotal')), discount:moneyCell(sumRows(rows,'discount')), deliveryFee:moneyCell(sumRows(rows,'deliveryFee')), total:moneyCell(sumRows(rows,'total')) })}</div>`;
}
function paymentSection(r){ return `<div class="card subcard report-block"><h3>Payments / Cash Reconciliation</h3>${rowsHtml(r.paymentDetails||[],[['Method','method'],['Transactions','count'],['Received','received',moneyCell,'num'],['Change','change',moneyCell,'num'],['Revenue','revenue',moneyCell,'num']],{method:'TOTAL',count:(r.paymentDetails||[]).reduce((s,p)=>s+Number(p.count||0),0),received:moneyCell(sumRows(r.paymentDetails,'received')),change:moneyCell(sumRows(r.paymentDetails,'change')),revenue:moneyCell(sumRows(r.paymentDetails,'revenue'))})}</div>`; }
function shiftCashSection(r){ const sh=r.shiftSummary||{}; return `<div class="card subcard report-block"><h3>Cash Drawer / Shift Closeout</h3><div class="closeout-grid">
  ${metric('Shift',sh.shiftNumber?`#${sh.shiftNumber}`:'No active shift',sh.shiftStatus||'')}
  ${metric('Opening Cash',moneyCell(sh.openingCash))}
  ${metric('Cash Sales',moneyCell(sh.cashSales))}
  ${metric('Cash Refunds',moneyCell(sh.cashRefunds))}
  ${metric('Expected Cash',moneyCell(sh.expectedCash),'Opening + cash sales - cash refunds')}
  ${metric('Counted Cash',sh.countedCash==null?'Not entered':moneyCell(sh.countedCash))}
  ${metric('Difference',sh.difference==null?'Not closed':moneyCell(sh.difference))}
</div></div>`; }
function reportBodyHtml(r){
  const s=r.summary||{};
  if(reportType==='itemwise') return `${reportSummaryCards(r)}<div class="card subcard report-block"><h3>Item Wise Sales</h3>${rowsHtml(r.itemWise||[],[['Item','item'],['Category','category'],['Qty Sold','qty'],['Gross','gross',moneyCell,'num'],['Discount Share','discountShare',moneyCell,'num'],['Net Sales','net',moneyCell,'num']],{item:'TOTAL',qty:sumRows(r.itemWise,'qty'),gross:moneyCell(sumRows(r.itemWise,'gross')),discountShare:moneyCell(sumRows(r.itemWise,'discountShare')),net:moneyCell(sumRows(r.itemWise,'net'))})}</div>`;
  if(reportType==='category') return `${reportSummaryCards(r)}<div class="card subcard report-block"><h3>Category Wise Sales</h3>${rowsHtml(r.categoryDetails||[],[['Category','category'],['Qty Sold','qty'],['Gross Sales','gross',moneyCell,'num'],['Net Sales','net',moneyCell,'num']],{category:'TOTAL',qty:sumRows(r.categoryDetails,'qty'),gross:moneyCell(sumRows(r.categoryDetails,'gross')),net:moneyCell(sumRows(r.categoryDetails,'net'))})}</div>`;
  if(reportType==='payment') return `${reportSummaryCards(r)}${paymentSection(r)}${billDetailsTable(r.orders)}`;
  if(reportType==='discount') return `${reportSummaryCards(r)}<div class="card subcard report-block"><h3>Discounted Bills</h3>${rowsHtml(r.discountWise?.rows||[],[['Bill','number'],['Date','date',v=>v?new Date(v).toLocaleString():'' ],['Type','type',v=>formatType(v)],['Cashier','cashier'],['Discount Type','discountType'],['Discount Value','discountValue'],['Discount','discount',moneyCell,'num'],['Bill Total','total',moneyCell,'num']],{number:'TOTAL',discount:moneyCell(r.discountWise?.amount||0),total:moneyCell(sumRows(r.discountWise?.rows||[],'total'))})}</div>`;
  if(reportType==='voidrefund') return `${reportSummaryCards(r)}<div class="grid2"><div class="card subcard report-block"><h3>Refunds</h3>${rowsHtml(r.refunds||[],[['Bill','orderNumber'],['Date','createdAt',v=>v?new Date(v).toLocaleString():'' ],['Method','method'],['Amount','amount',moneyCell,'num'],['Reason','reason'],['By','by']],{orderNumber:'TOTAL',amount:moneyCell(sumRows(r.refunds,'amount'))})}</div><div class="card subcard report-block"><h3>Voids</h3>${rowsHtml(r.voidOrders||[],[['Bill','number'],['Date','voidedAt',v=>v?new Date(v).toLocaleString():'' ],['Reason','voidReason'],['Cashier','cashierName'],['Total','total',moneyCell,'num']])}</div></div>`;
  if(reportType==='ordertype') return `${reportSummaryCards(r)}<div class="card subcard report-block"><h3>Order Type Performance</h3>${rowsHtml(r.orderTypeDetails||[],[['Type','type',v=>formatType(v)],['Orders','orders'],['Guests','guests'],['Gross','gross',moneyCell,'num'],['Discount','discount',moneyCell,'num'],['Net','net',moneyCell,'num'],['Average Bill','avg',(_,row)=>moneyCell((Number(row.net)||0)/Math.max(1,Number(row.orders)||0)),'num']],{type:'TOTAL',orders:sumRows(r.orderTypeDetails,'orders'),guests:sumRows(r.orderTypeDetails,'guests'),gross:moneyCell(sumRows(r.orderTypeDetails,'gross')),discount:moneyCell(sumRows(r.orderTypeDetails,'discount')),net:moneyCell(sumRows(r.orderTypeDetails,'net'))})}</div>`;
  if(reportType==='x'||reportType==='z') return `${reportSummaryCards(r)}${shiftCashSection(r)}${paymentSection(r)}<div class="card subcard report-block"><h3>Category Revenue</h3>${rowsHtml(r.categoryDetails||[],[['Category','category'],['Qty','qty'],['Net Sales','net',moneyCell,'num']],{category:'TOTAL',qty:sumRows(r.categoryDetails,'qty'),net:moneyCell(sumRows(r.categoryDetails,'net'))})}</div>${billDetailsTable(r.orders)}`;
  return `${reportSummaryCards(r)}${shiftCashSection(r)}${paymentSection(r)}<div class="grid2"><div class="card subcard report-block"><h3>Order Types</h3>${rowsHtml(r.orderTypeDetails||[],[['Type','type',v=>formatType(v)],['Orders','orders'],['Net','net',moneyCell,'num']],{type:'TOTAL',orders:sumRows(r.orderTypeDetails,'orders'),net:moneyCell(sumRows(r.orderTypeDetails,'net'))})}</div><div class="card subcard report-block"><h3>Top Items</h3>${rowsHtml((r.itemWise||[]).slice(0,8),[['Item','item'],['Qty','qty'],['Net','net',moneyCell,'num']],{item:'TOTAL',qty:sumRows((r.itemWise||[]).slice(0,8),'qty'),net:moneyCell(sumRows((r.itemWise||[]).slice(0,8),'net'))})}</div></div>${billDetailsTable(r.orders)}`;
}
function renderReports(ws){
  try{
    const defs = reportDateDefaults(reportType);
    const paymentOptions=(state.paymentMethods||[]).filter(p=>p.active).map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
    const itemOptions=[...(state.items||[]).map(i=>`<option value="${esc(i.id)}">${esc(i.name)}</option>`),...(state.deals||[]).map(d=>`<option value="${esc(d.id)}">Deal: ${esc(d.name)}</option>`)].join('');
    const catOptions=(state.categories||[]).filter(c=>c.id!=='cat_all').map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    const userOptions=(state.users||[]).map(u=>`<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
    const takerOptions=(state.orderTakers||[]).map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    const shiftOptions=(state.shifts||[]).map(s=>`<option value="${esc(s.id)}">#${s.number} ${s.status}</option>`).join('');
    ws.innerHTML=`<div class="report-page admin-report-shell pro-report-screen">
      <div class="module-title"><div><h3>Reports</h3><p class="muted-note">Admin-only POS sales, cash drawer, item, payment and X/Z closeout reports.</p></div><div class="actions-mini"><button class="ghost-btn" id="exportReport" disabled>Export Excel</button><button class="ghost-btn" id="printReportBtn" disabled>Print</button></div></div>
      <div class="reports-layout">
        <div class="report-menu card subcard">
          <h4>Sales</h4>${reportMenuButton('daily','Daily Summary','Totals + payments')}${reportMenuButton('custom','Custom Detailed','Full bill details')}${reportMenuButton('ordertype','Order Type','Dine-in / takeaway / delivery')}
          <h4>Menu</h4>${reportMenuButton('itemwise','Item Wise','Qty, gross, net')}${reportMenuButton('category','Category Wise','Category revenue')}
          <h4>Cash & Payments</h4>${reportMenuButton('payment','Payment Mode','Received / change / revenue')}${reportMenuButton('discount','Discounts','Discounted bills')}${reportMenuButton('voidrefund','Void / Refund','Manager actions')}
          <h4>Closeout</h4>${reportMenuButton('x','X Report','Live shift snapshot')}${reportMenuButton('y','Y Report','Period summary')}${reportMenuButton('z','Z Report','End-day closeout')}
        </div>
        <div class="report-work card subcard">
          <div class="report-headline"><h3 id="reportTitle">${esc(currentReportTitle())}</h3><span>${esc(state.settings?.businessName||'SwiftTill POS')}</span></div>
          <div class="report-filter-grid compact-filters" id="reportFilters">
            <div class="field report-filter date-filter"><label>From</label><input type="date" id="fromDate" value="${defs.from}"></div>
            <div class="field report-filter date-filter"><label>To</label><input type="date" id="toDate" value="${defs.to}"></div>
            <div class="field report-filter payment-filter"><label>Payment Mode</label><select id="paymentMode"><option value="">All</option>${paymentOptions}</select></div>
            <div class="field report-filter ordertype-filter"><label>Order Type</label><select id="orderType"><option value="">All</option><option value="DINE_IN">Dine In</option><option value="DELIVERY">Delivery</option><option value="TAKEAWAY">Takeaway</option></select></div>
            <div class="field report-filter item-filter"><label>Item / Deal</label><select id="itemId"><option value="">All</option>${itemOptions}</select></div>
            <div class="field report-filter category-filter"><label>Category</label><select id="categoryFilter"><option value="">All</option>${catOptions}</select></div>
            <div class="field report-filter cashier-filter"><label>Cashier</label><select id="cashierId"><option value="">All</option>${userOptions}</select></div>
            <div class="field report-filter taker-filter"><label>Order Taker</label><select id="orderTakerId"><option value="">All</option>${takerOptions}</select></div>
            <div class="field report-filter shift-filter"><label>Shift</label><select id="shiftId"><option value="">All</option>${shiftOptions}</select></div>
            <label class="check report-filter discount-filter"><input type="checkbox" id="discountOnly"> Discounted only</label>
            <label class="check report-filter refund-filter"><input type="checkbox" id="refundOnly"> Refunded only</label>
            <button class="primary-btn" id="runReport">Run Report</button>
          </div>
          <div id="reportResult" class="mt"><div class="empty-cart compact-empty"><b>Select a report.</b><p>Run report to show totals, details, printable closeout and export.</p></div></div>
        </div>
      </div></div>`;
    updateReportFilterVisibility();
    $$('[data-report-type]').forEach(b=>b.onclick=()=>{ reportType=b.dataset.reportType; renderReports(ws); });
    $('#runReport').onclick=runReport;
    $('#printReportBtn').onclick=()=>{ const html=$('#printReportArea')?.innerHTML||''; if(!html.trim()) return toast('Run report first.', true); printReportHtml(html); };
    $('#exportReport').onclick=()=>downloadApi(`/api/export?${reportQuery()}`,`swifttill-${reportType}-report-${Date.now()}.csv`).catch(e=>toast(e.message,true));
  }catch(e){ ws.innerHTML=`<div class="card subcard error-state"><h3>Reports failed to render</h3><p>${esc(e.message)}</p><button class="primary-btn" onclick="renderAdminContent()">Reload Reports</button></div>`; }
}
function updateReportFilterVisibility(){ return applyReportFilterVisibility(); }
async function printReportHtml(html){
  if(!html || !String(html).trim()) return toast('Run report first.', true);
  const cleanHtml = String(html);
  if(state?.printAgent?.cloudQueueConfigured){
    try{
      const text = cleanHtml.replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
      const queued = await api('/api/print-jobs',{type:'report',html:cleanHtml,text});
      if(queued?.queued){ toast('Report sent to cloud print queue'); return; }
    }catch(e){ toast('Cloud report print failed; browser print opened', true); }
  }
  const area = ensurePrintArea();
  area.innerHTML = cleanHtml;
  setTimeout(()=>window.print(),100);
}
async function runReport(){
  const target=$('#reportResult');
  if(target) target.innerHTML='<div class="report-loading"><b>Generating report...</b><span>Reading paid bills, payments, items and shift totals from Neon.</span></div>';
  $('#exportReport')?.setAttribute('disabled','disabled'); $('#printReportBtn')?.setAttribute('disabled','disabled');
  try{
    const j=await api(`/api/reports?${reportQuery()}`,null,'GET'); const r=j.data;
    if(!$('#reportResult')) return;
    $('#reportResult').innerHTML=`<div id="printReportArea" class="report-print-wrap">${reportHeaderHtml(r)}${reportBodyHtml(r)}<div class="sep"></div><div class="report-signature"><span>Prepared By</span><span>Checked By</span><span>Manager Signature</span></div><div class="c">${esc(state.settings.reportFooter||'Generated by SwiftTill POS')}</div></div></div>`;
    $('#exportReport')?.removeAttribute('disabled'); $('#printReportBtn')?.removeAttribute('disabled');
  }catch(e){ if(target) target.innerHTML=`<div class="empty-cart error-state"><b>Report failed</b><p>${esc(e.message)}</p></div>`; toast(e.message,true); }
}


/* ============================================================
   SwiftTill V26 Formatting / Reports / Print Template Audit
   - Screen reports stay rich/professional.
   - PDF/A4 print uses QuickBooks-style clean tables, no rounded boxes.
   - Thermal print uses 80mm receipt slip, no boxes, no wide tables.
   ============================================================ */
function reportMoney(v){ return money(Number(v || 0)); }
function reportDateTime(v){ return v ? new Date(v).toLocaleString() : ''; }
function reportRangeText(r){ return `${r?.range?.from || 'Start'} to ${r?.range?.to || 'Now'}`; }
function reportStoreName(){ return state?.settings?.businessName || 'SwiftTill POS'; }
function reportBranchLine(){
  const s = state?.settings || {};
  return [s.branchName, s.address, s.phone].filter(Boolean).join(' • ');
}
function reportTable(headers, rows, footer){
  const body = (rows && rows.length) ? rows.map(row => `<tr>${row.map((v,i)=>`<td class="${typeof v==='number' || String(v).startsWith('Rs ') ? 'num' : ''}">${esc(v)}</td>`).join('')}</tr>`).join('') : `<tr><td colspan="${headers.length}" class="empty-td">No data for selected filters.</td></tr>`;
  const foot = footer ? `<tfoot><tr>${footer.map(v=>`<th class="${typeof v==='number' || String(v).startsWith('Rs ') ? 'num' : ''}">${esc(v ?? '')}</th>`).join('')}</tr></tfoot>` : '';
  return `<div class="qb-table-wrap"><table class="qb-table"><thead><tr>${headers.map(h=>`<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${body}</tbody>${foot}</table></div>`;
}
function reportScreenSummary(r){
  const s = r.summary || {};
  const cards = [
    ['Gross Sales', reportMoney(s.gross)], ['Discounts', reportMoney(s.discounts)], ['Refunds', reportMoney(s.refunds)], ['Net Sales', reportMoney(s.net)],
    ['Orders', s.orders || 0], ['Guests', s.guests || 0], ['Average Bill', reportMoney(s.averageBill)], ['Change Returned', reportMoney(s.changeReturned)]
  ];
  return `<div class="qb-screen-metrics">${cards.map(([k,v])=>`<div><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('')}</div>`;
}
function reportA4SummaryTable(r){
  const s = r.summary || {}, sh = r.shiftSummary || {};
  return `<div class="qb-two-col"><div>${reportTable(['Sales Summary','Amount'],[
    ['Gross Sales',reportMoney(s.gross)],['Discounts',reportMoney(s.discounts)],['Refunds',reportMoney(s.refunds)],['Net Sales',reportMoney(s.net)],['Total Orders',s.orders||0],['Guests',s.guests||0],['Average Bill',reportMoney(s.averageBill)],['Change Returned',reportMoney(s.changeReturned)]
  ])}</div><div>${reportTable(['Cash Drawer / Shift','Amount'],[
    ['Shift',sh.shiftNumber?`#${sh.shiftNumber} ${sh.shiftStatus||''}`:'No active shift'],['Opening Cash',reportMoney(sh.openingCash)],['Cash Sales',reportMoney(sh.cashSales)],['Cash Refunds',reportMoney(sh.cashRefunds)],['Expected Cash',reportMoney(sh.expectedCash)],['Counted Cash',sh.countedCash==null?'Not entered':reportMoney(sh.countedCash)],['Difference',sh.difference==null?'Not closed':reportMoney(sh.difference)]
  ])}</div></div>`;
}
function reportPaymentRows(r){ return (r.paymentDetails || []).map(p=>[p.method, p.count || 0, reportMoney(p.received), reportMoney(p.change), reportMoney(p.revenue)]); }
function reportItemRows(r){ return (r.itemWise || []).map(i=>[i.item, i.category, i.qty || 0, reportMoney(i.gross), reportMoney(i.discountShare), reportMoney(i.net)]); }
function reportCategoryRows(r){ return (r.categoryDetails || []).map(c=>[c.category, c.qty || 0, reportMoney(c.gross), reportMoney(c.net)]); }
function reportOrderTypeRows(r){ return (r.orderTypeDetails || []).map(o=>[formatType(o.type), o.orders || 0, o.guests || 0, reportMoney(o.gross), reportMoney(o.discount), reportMoney(o.net), reportMoney((Number(o.net)||0)/Math.max(1,Number(o.orders)||0))]); }
function reportBillRows(r){ return (r.orders || []).map(o=>[o.number, reportDateTime(o.date), formatType(o.type), o.table || '', o.guests || '', o.customer || '', o.cashier || '', reportMoney(o.subtotal), reportMoney(o.discount), reportMoney(o.deliveryFee), reportMoney(o.total), o.payments || '']); }
function reportDiscountRows(r){ return (r.discountWise?.rows || []).map(o=>[o.number, reportDateTime(o.date), formatType(o.type), o.cashier || '', o.discountType || '', o.discountValue || '', reportMoney(o.discount), reportMoney(o.total)]); }
function reportRefundRows(r){ return (r.refunds || []).map(x=>['Refund', x.orderNumber || '', reportDateTime(x.createdAt), x.method || '', reportMoney(x.amount), x.reason || '', x.by || '']).concat((r.voidOrders || []).map(o=>['Void', o.number || '', reportDateTime(o.voidedAt || o.createdAt), o.status || '', reportMoney((o.total || 0)), o.voidReason || '', o.cashierName || ''])); }
function sumReport(rows, index){ return rows.reduce((s,r)=>s+(Number(String(r[index]).replace(/[^0-9.-]/g,''))||0),0); }
function buildA4ReportHtml(r){
  const title=currentReportTitle();
  const s=r.summary||{};
  let details='';
  if(reportType==='itemwise'){
    const rows=reportItemRows(r); details=reportTable(['Item','Category','Qty','Gross','Discount Share','Net Sales'], rows, ['TOTAL','',sumReport(rows,2),reportMoney(sumReport(rows,3)),reportMoney(sumReport(rows,4)),reportMoney(sumReport(rows,5))]);
  } else if(reportType==='category'){
    const rows=reportCategoryRows(r); details=reportTable(['Category','Qty','Gross Sales','Net Sales'], rows, ['TOTAL',sumReport(rows,1),reportMoney(sumReport(rows,2)),reportMoney(sumReport(rows,3))]);
  } else if(reportType==='payment'){
    const rows=reportPaymentRows(r); details=reportTable(['Payment Method','Transactions','Received','Change','Revenue'], rows, ['TOTAL',sumReport(rows,1),reportMoney(sumReport(rows,2)),reportMoney(sumReport(rows,3)),reportMoney(sumReport(rows,4))]) + reportTable(['Bill','Date','Type','Table','Guest','Customer','Cashier','Subtotal','Discount','Delivery','Total','Payments'], reportBillRows(r), ['TOTAL','','','','','','',reportMoney(sumRows(r.orders||[],'subtotal')),reportMoney(sumRows(r.orders||[],'discount')),reportMoney(sumRows(r.orders||[],'deliveryFee')),reportMoney(sumRows(r.orders||[],'total')),'']);
  } else if(reportType==='discount'){
    const rows=reportDiscountRows(r); details=reportTable(['Bill','Date','Type','Cashier','Discount Type','Value','Discount','Bill Total'], rows, ['TOTAL','','','','','',reportMoney(sumReport(rows,6)),reportMoney(sumReport(rows,7))]);
  } else if(reportType==='voidrefund'){
    const rows=reportRefundRows(r); details=reportTable(['Type','Bill','Date','Method / Status','Amount','Reason','By'], rows, ['TOTAL','','','',reportMoney(sumReport(rows,4)),'','']);
  } else if(reportType==='ordertype'){
    const rows=reportOrderTypeRows(r); details=reportTable(['Order Type','Orders','Guests','Gross','Discount','Net','Average Bill'], rows, ['TOTAL',sumReport(rows,1),sumReport(rows,2),reportMoney(sumReport(rows,3)),reportMoney(sumReport(rows,4)),reportMoney(sumReport(rows,5)),'']);
  } else if(reportType==='x' || reportType==='y' || reportType==='z'){
    const pay=reportPaymentRows(r); const cat=reportCategoryRows(r); details=reportTable(['Payment Method','Transactions','Received','Change','Revenue'], pay, ['TOTAL',sumReport(pay,1),reportMoney(sumReport(pay,2)),reportMoney(sumReport(pay,3)),reportMoney(sumReport(pay,4))]) + reportTable(['Category','Qty','Gross Sales','Net Sales'], cat, ['TOTAL',sumReport(cat,1),reportMoney(sumReport(cat,2)),reportMoney(sumReport(cat,3))]) + reportTable(['Bill','Date','Type','Table','Guest','Customer','Cashier','Subtotal','Discount','Delivery','Total','Payments'], reportBillRows(r), ['TOTAL','','','','','','',reportMoney(sumRows(r.orders||[],'subtotal')),reportMoney(sumRows(r.orders||[],'discount')),reportMoney(sumRows(r.orders||[],'deliveryFee')),reportMoney(sumRows(r.orders||[],'total')),'']);
  } else {
    const pay=reportPaymentRows(r); const cat=reportCategoryRows(r); details=reportTable(['Payment Method','Transactions','Received','Change','Revenue'], pay, ['TOTAL',sumReport(pay,1),reportMoney(sumReport(pay,2)),reportMoney(sumReport(pay,3)),reportMoney(sumReport(pay,4))]) + reportTable(['Order Type','Orders','Guests','Gross','Discount','Net','Average Bill'], reportOrderTypeRows(r)) + reportTable(['Bill','Date','Type','Table','Guest','Customer','Cashier','Subtotal','Discount','Delivery','Total','Payments'], reportBillRows(r), ['TOTAL','','','','','','',reportMoney(sumRows(r.orders||[],'subtotal')),reportMoney(sumRows(r.orders||[],'discount')),reportMoney(sumRows(r.orders||[],'deliveryFee')),reportMoney(sumRows(r.orders||[],'total')),'']);
  }
  return `<div class="report-a4 qb-a4"><div class="qb-head"><div><h1>${esc(reportStoreName())}</h1><p>${esc(reportBranchLine())}</p></div><div><b>${esc(title)}</b><span>Range: ${esc(reportRangeText(r))}</span><span>Printed: ${esc(new Date().toLocaleString())}</span><span>User: ${esc(state?.user?.name || '')}</span></div></div><div class="qb-title-row"><h2>${esc(title)}</h2><b>Net Sales ${esc(reportMoney(s.net))}</b></div>${reportA4SummaryTable(r)}<h3 class="qb-section-title">Report Details</h3>${details}<div class="qb-signatures"><span>Prepared By</span><span>Checked By</span><span>Manager Signature</span></div><p class="qb-footer">${esc(state?.settings?.reportFooter || 'Generated by SwiftTill POS')}</p></div>`;
}
function thermalLine(left,right=''){ return `<div class="tr-line"><span>${esc(left)}</span><b>${esc(right)}</b></div>`; }
function thermalTableBlock(title, rows, columns=2){
  const lines=(rows && rows.length?rows:[[ 'No data', '' ]]).slice(0,60).map(r=>{
    if(columns===3) return `<div class="tr-grid3"><span>${esc(r[0]??'')}</span><span>${esc(r[1]??'')}</span><b>${esc(r[2]??'')}</b></div>`;
    return thermalLine(r[0]??'', r.slice(1).join('  '));
  }).join('');
  return `<div class="tr-section"><div class="tr-title">${esc(title)}</div>${lines}</div>`;
}
function buildThermalReportHtml(r){
  const s=r.summary||{}, sh=r.shiftSummary||{};
  const title=currentReportTitle();
  let body = `<div class="thermal-report"><div class="tr-center"><b>${esc(reportStoreName())}</b><br>${esc(state?.settings?.branchName||'')}<br>${esc(state?.settings?.phone||'')}</div><div class="tr-sep"></div>${thermalLine('REPORT',title)}${thermalLine('RANGE',reportRangeText(r))}${thermalLine('PRINTED',new Date().toLocaleString())}${thermalLine('USER',state?.user?.name||'')}<div class="tr-sep"></div><div class="tr-title">SUMMARY</div>${thermalLine('Gross Sales',reportMoney(s.gross))}${thermalLine('Discounts',reportMoney(s.discounts))}${thermalLine('Refunds',reportMoney(s.refunds))}${thermalLine('NET SALES',reportMoney(s.net))}${thermalLine('Orders',s.orders||0)}${thermalLine('Guests',s.guests||0)}${thermalLine('Average Bill',reportMoney(s.averageBill))}${thermalLine('Change Returned',reportMoney(s.changeReturned))}`;
  if(['daily','custom','payment','x','y','z'].includes(reportType)) body += `<div class="tr-sep"></div><div class="tr-title">CASH DRAWER</div>${thermalLine('Shift',sh.shiftNumber?`#${sh.shiftNumber} ${sh.shiftStatus||''}`:'No active shift')}${thermalLine('Opening Cash',reportMoney(sh.openingCash))}${thermalLine('Cash Sales',reportMoney(sh.cashSales))}${thermalLine('Cash Refunds',reportMoney(sh.cashRefunds))}${thermalLine('Expected Cash',reportMoney(sh.expectedCash))}${thermalLine('Counted Cash',sh.countedCash==null?'Not entered':reportMoney(sh.countedCash))}${thermalLine('Difference',sh.difference==null?'Not closed':reportMoney(sh.difference))}`;
  if(reportType==='itemwise') body += `<div class="tr-sep"></div>` + thermalTableBlock('ITEM WISE', (r.itemWise||[]).map(i=>[i.item, `x${i.qty}`, reportMoney(i.net)]), 3);
  else if(reportType==='category') body += `<div class="tr-sep"></div>` + thermalTableBlock('CATEGORY WISE', (r.categoryDetails||[]).map(c=>[c.category, `x${c.qty}`, reportMoney(c.net)]), 3);
  else if(reportType==='ordertype') body += `<div class="tr-sep"></div>` + thermalTableBlock('ORDER TYPE', (r.orderTypeDetails||[]).map(o=>[formatType(o.type), `${o.orders} bills`, reportMoney(o.net)]), 3);
  else if(reportType==='discount') body += `<div class="tr-sep"></div>` + thermalTableBlock('DISCOUNTS', (r.discountWise?.rows||[]).map(o=>[`#${o.number}`, reportDateTime(o.date), reportMoney(o.discount)]), 3);
  else if(reportType==='voidrefund') body += `<div class="tr-sep"></div>` + thermalTableBlock('VOID / REFUND', reportRefundRows(r).map(x=>[`${x[0]} #${x[1]}`, x[5], x[4]]), 3);
  else body += `<div class="tr-sep"></div>` + thermalTableBlock('PAYMENTS', reportPaymentRows(r).map(p=>[p[0], `${p[1]} trx`, p[4]]), 3) + `<div class="tr-sep"></div>` + thermalTableBlock('CATEGORY SALES', (r.categoryDetails||[]).map(c=>[c.category, `x${c.qty}`, reportMoney(c.net)]), 3);
  body += `<div class="tr-sep"></div><div class="tr-sign"><span>Prepared</span><span>Checked</span></div><div class="tr-center small">${esc(state?.settings?.reportFooter || 'Generated by SwiftTill POS')}</div></div>`;
  return body;
}
function thermalReportText(r){
  const tmp=document.createElement('div'); tmp.innerHTML=buildThermalReportHtml(r); return tmp.textContent.replace(/\n{3,}/g,'\n\n').trim();
}
function reportHeaderHtml(r){ return buildA4ReportHtml(r); }
function reportBodyHtml(){ return ''; }
function renderReports(ws){
  try{
    const defs = reportDateDefaults(reportType);
    const paymentOptions=(state.paymentMethods||[]).filter(p=>p.active).map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
    const itemOptions=[...(state.items||[]).map(i=>`<option value="${esc(i.id)}">${esc(i.name)}</option>`),...(state.deals||[]).map(d=>`<option value="${esc(d.id)}">Deal: ${esc(d.name)}</option>`)].join('');
    const catOptions=(state.categories||[]).filter(c=>c.id!=='cat_all').map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    const userOptions=(state.users||[]).map(u=>`<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
    const takerOptions=(state.orderTakers||[]).map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    const shiftOptions=(state.shifts||[]).map(s=>`<option value="${esc(s.id)}">#${s.number} ${s.status}</option>`).join('');
    ws.innerHTML=`<div class="report-page admin-report-shell pro-report-screen qb-report-module">
      <div class="module-title"><div><h3>Reports</h3><p class="muted-note">Screen reports are rich. PDF uses clean QuickBooks-style A4. Thermal print uses 80mm slip format.</p></div><div class="actions-mini"><button class="ghost-btn" id="exportReport" disabled>Export Excel</button><button class="ghost-btn" id="printReportPdfBtn" disabled>PDF / A4</button><button class="primary-btn" id="printReportThermalBtn" disabled>Thermal Print</button></div></div>
      <div class="reports-layout">
        <div class="report-menu card subcard">
          <h4>Sales</h4>${reportMenuButton('daily','Daily Summary','Totals + payments')}${reportMenuButton('custom','Custom Detailed','Full bill details')}${reportMenuButton('ordertype','Order Type','Dine-in / takeaway / delivery')}
          <h4>Menu</h4>${reportMenuButton('itemwise','Item Wise','Qty, gross, net')}${reportMenuButton('category','Category Wise','Category revenue')}
          <h4>Cash & Payments</h4>${reportMenuButton('payment','Payment Mode','Received / change / revenue')}${reportMenuButton('discount','Discounts','Discounted bills')}${reportMenuButton('voidrefund','Void / Refund','Manager actions')}
          <h4>Closeout</h4>${reportMenuButton('x','X Report','Live shift snapshot')}${reportMenuButton('y','Y Report','Period summary')}${reportMenuButton('z','Z Report','End-day closeout')}
        </div>
        <div class="report-work card subcard">
          <div class="report-headline"><h3 id="reportTitle">${esc(currentReportTitle())}</h3><span>${esc(state.settings?.businessName||'SwiftTill POS')}</span></div>
          <div class="report-filter-grid compact-filters" id="reportFilters">
            <div class="field report-filter date-filter"><label>From</label><input type="date" id="fromDate" value="${defs.from}"></div>
            <div class="field report-filter date-filter"><label>To</label><input type="date" id="toDate" value="${defs.to}"></div>
            <div class="field report-filter payment-filter"><label>Payment Mode</label><select id="paymentMode"><option value="">All</option>${paymentOptions}</select></div>
            <div class="field report-filter ordertype-filter"><label>Order Type</label><select id="orderType"><option value="">All</option><option value="DINE_IN">Dine In</option><option value="DELIVERY">Delivery</option><option value="TAKEAWAY">Takeaway</option></select></div>
            <div class="field report-filter item-filter"><label>Item / Deal</label><select id="itemId"><option value="">All</option>${itemOptions}</select></div>
            <div class="field report-filter category-filter"><label>Category</label><select id="categoryFilter"><option value="">All</option>${catOptions}</select></div>
            <div class="field report-filter cashier-filter"><label>Cashier</label><select id="cashierId"><option value="">All</option>${userOptions}</select></div>
            <div class="field report-filter taker-filter"><label>Order Taker</label><select id="orderTakerId"><option value="">All</option>${takerOptions}</select></div>
            <div class="field report-filter shift-filter"><label>Shift</label><select id="shiftId"><option value="">All</option>${shiftOptions}</select></div>
            <label class="check report-filter discount-filter"><input type="checkbox" id="discountOnly"> Discounted only</label>
            <label class="check report-filter refund-filter"><input type="checkbox" id="refundOnly"> Refunded only</label>
            <button class="primary-btn" id="runReport">Run Report</button>
          </div>
          <div id="reportResult" class="mt"><div class="empty-cart compact-empty"><b>Select a report.</b><p>Run report to show totals, QuickBooks-style PDF, thermal slip print and export.</p></div></div>
        </div>
      </div></div>`;
    updateReportFilterVisibility();
    $$('[data-report-type]').forEach(b=>b.onclick=()=>{ reportType=b.dataset.reportType; renderReports(ws); });
    $('#runReport').onclick=runReport;
    $('#printReportPdfBtn').onclick=()=>printReportHtml('a4');
    $('#printReportThermalBtn').onclick=()=>printReportHtml('thermal');
    $('#exportReport').onclick=()=>downloadApi(`/api/export?${reportQuery()}`,`swifttill-${reportType}-report-${Date.now()}.csv`).catch(e=>toast(e.message,true));
  }catch(e){ ws.innerHTML=`<div class="card subcard error-state"><h3>Reports failed to render</h3><p>${esc(e.message)}</p><button class="primary-btn" onclick="renderAdminContent()">Reload Reports</button></div>`; }
}
async function printReportHtml(mode='thermal'){
  const r = window.swiftLastReport;
  if(!r) return toast('Run report first.', true);
  const thermal = mode === 'thermal';
  const html = thermal ? buildThermalReportHtml(r) : buildA4ReportHtml(r);
  const area = ensurePrintArea();
  area.className = `print-only ${thermal ? 'print-thermal' : 'print-a4'}`;
  area.innerHTML = html;
  if(thermal && state?.printAgent?.cloudQueueConfigured){
    try{ const queued = await api('/api/print-jobs',{type:'report',html,text:thermalReportText(r)}); if(queued?.queued){ toast('Thermal report sent to cloud print queue'); return; } }
    catch(e){ toast('Cloud report queue failed; browser print opened', true); }
  }
  setTimeout(()=>window.print(),100);
}
async function runReport(){
  const target=$('#reportResult');
  if(target) target.innerHTML='<div class="report-loading"><b>Generating report...</b><span>Reading paid bills, payments, items and shift totals from Neon.</span></div>';
  $('#exportReport')?.setAttribute('disabled','disabled'); $('#printReportPdfBtn')?.setAttribute('disabled','disabled'); $('#printReportThermalBtn')?.setAttribute('disabled','disabled');
  try{
    const j=await api(`/api/reports?${reportQuery()}`,null,'GET'); const r=j.data; window.swiftLastReport = r;
    if(!$('#reportResult')) return;
    $('#reportResult').innerHTML=`<div class="qb-report-screen">${reportScreenSummary(r)}${buildA4ReportHtml(r)}</div>`;
    $('#exportReport')?.removeAttribute('disabled'); $('#printReportPdfBtn')?.removeAttribute('disabled'); $('#printReportThermalBtn')?.removeAttribute('disabled');
  }catch(e){ if(target) target.innerHTML=`<div class="empty-cart error-state"><b>Report failed</b><p>${esc(e.message)}</p></div>`; toast(e.message,true); }
}

/* ============================================================
   SwiftTill V28 Cart Density + Client Admin Cleanup
   - compact order details grid
   - more visible item/cart area
   - one-line bill actions
   - client-facing raw backup actions removed from Admin
============================================================ */
function orderMetaGrid(o){
  const tableName = o.type === 'DINE_IN' ? (state.tables.find(t=>t.id===o.tableId)?.name || '—') : '—';
  const rows = o.type === 'DINE_IN'
    ? [
        ['Type', formatType(o.type), '🍴'],
        ['Table', tableName, '▣'],
        ['Guests', `${Number(o.guests||0)}`, '👥'],
        ['Taker', o.orderTakerName || '—', '👤']
      ]
    : o.type === 'DELIVERY'
      ? [
          ['Type', 'Delivery', '🛵'],
          ['Customer', o.customerName || '—', '👤'],
          ['Mobile', o.mobile || '—', '☎'],
          ['Fee', money(o.deliveryFee || 0), '₨']
        ]
      : [
          ['Type', 'Takeaway', '🛍'],
          ['Customer', o.customerName || 'Walk-in', '👤'],
          ['Mobile', o.mobile || '—', '☎'],
          ['Taker', o.orderTakerName || state.user?.name || '—', '👤']
        ];
  return `<div class="order-meta-grid">${rows.map(([label,value,icon])=>`<div class="order-meta-cell"><span>${icon} ${esc(label)}</span><b>${esc(value)}</b></div>`).join('')}</div>`;
}
function renderBill(){
  const bp=$('#billPanel'); if(!bp) return;
  if(!currentOrder){
    bp.innerHTML=`<div class="bill-head compact-bill-head"><h2>Current Order</h2><b>—</b></div><div class="empty-cart compact-empty"><div><b>No active bill</b><p>Press New Order to start billing.</p></div></div>`;
    return;
  }
  currentOrder.lines = Array.isArray(currentOrder.lines) ? currentOrder.lines : [];
  const t=calcTotals(currentOrder);
  const hasLines = hasOrderLines(currentOrder);
  const printBillButton = `<button class="secondary-btn mini-action print-mini" id="printBillBtn" ${hasLines?'':'disabled title="Add item first"'}>🧾 Print</button>`;
  const moveButton = `<button class="secondary-btn mini-action move-mini" id="moveTableBtn" ${currentOrder.type==='DINE_IN'?'':'disabled title="Move table is only for dine-in"'}>⇄ Move</button>`;
  const splitButton = `<button class="secondary-btn mini-action split-mini" id="splitBillBtn" ${hasLines?'':'disabled title="Add item first"'}>⫶ Split</button>`;
  const deliveryRow = currentOrder.type==='DELIVERY' ? `<div class="total-row compact-row"><span>Delivery</span><b>${money(t.deliveryFee)}</b></div>` : '';
  bp.innerHTML=`
    <div class="bill-head compact-bill-head"><h2>Current Order</h2><b>#${esc(currentOrder.number||'Draft')}</b></div>
    <div class="orderbox compact-orderbox">${orderMetaGrid(currentOrder)}</div>
    <div class="line-list cart-density-list">${currentOrder.lines.length?currentOrder.lines.map(cartLine).join(''):'<div class="empty-cart cart-empty-compact">Add items from the center menu.</div>'}</div>
    <div class="totals compact-totals v28-totals">
      <div class="total-row compact-row"><span>Subtotal</span><b>${money(t.subtotal)}</b></div>
      <div class="discount-row compact-discount"><span>Discount</span><div class="switch"><button class="${currentOrder.discountType==='FIXED'?'active':''}" data-disc="FIXED">Rs</button><button class="${currentOrder.discountType==='PERCENT'?'active':''}" data-disc="PERCENT">%</button></div><input class="small-input" id="discountVal" value="${Number(currentOrder.discountValue||0)}"></div>
      ${deliveryRow}
      <div class="total-row big compact-total"><span>Total</span><b>${money(t.total)}</b></div>
    </div>
    <div class="bill-quick-actions one-line-actions">${printBillButton}${moveButton}${splitButton}</div>
    <label class="check print-check compact-check"><input type="checkbox" id="printRemember" ${getPrintDefault()?'checked':''}> Print receipt after payment</label>
    <div class="actions compact-main-actions"><button class="hold" id="holdBtn" ${hasLines?'':'disabled title="Add item first"'}>Ⅱ HOLD</button><button class="pay" id="payBtn" ${hasLines?'':'disabled title="Add item first"'}>▣ PAY ${money(t.total)}</button></div>`;
  $('#mobileCloseCart') && ($('#mobileCloseCart').onclick = () => setMobileBill(false));
  $$('[data-line-minus]').forEach(b=>b.onclick=()=>changeQty(b.dataset.lineMinus,-1));
  $$('[data-line-plus]').forEach(b=>b.onclick=()=>changeQty(b.dataset.linePlus,1));
  $$('[data-line-remove]').forEach(b=>b.onclick=()=>{currentOrder.lines=currentOrder.lines.filter(l=>l.lineId!==b.dataset.lineRemove);renderBill();});
  $$('[data-line-edit]').forEach(b=>b.onclick=()=>openLineModal(b.dataset.lineEdit));
  $$('[data-qty-input]').forEach(inp=>inp.onchange=()=>{const l=currentOrder.lines.find(x=>x.lineId===inp.dataset.qtyInput); if(l){l.qty=Math.max(1,Number(inp.value)||1); renderBill();}});
  $$('[data-disc]').forEach(b=>b.onclick=()=>{currentOrder.discountType=currentOrder.discountType===b.dataset.disc?'NONE':b.dataset.disc; if(currentOrder.discountType==='NONE') currentOrder.discountValue=0; renderBill();});
  const disc=$('#discountVal'); if(disc) disc.onchange=e=>{ currentOrder.discountValue=Math.max(0,Number(e.target.value)||0); if(currentOrder.discountValue>0 && currentOrder.discountType==='NONE') currentOrder.discountType='FIXED'; renderBill(); };
  const remember=$('#printRemember'); if(remember) remember.onchange=e=>localStorage.setItem('swifttill_print_default', e.target.checked?'1':'0');
  const hold=$('#holdBtn'); if(hold) hold.onclick=()=>saveOrder(true);
  const pay=$('#payBtn'); if(pay) pay.onclick=()=>openPayModal();
  const print=$('#printBillBtn'); if(print) print.onclick=()=>printCurrentBill();
  const move=$('#moveTableBtn'); if(move && currentOrder.type==='DINE_IN') move.onclick=()=>openMoveTableModal();
  const split=$('#splitBillBtn'); if(split) split.onclick=()=>openSplitBillModal();
}
const __v28BaseRenderAdminContent = renderAdminContent;
renderAdminContent = function(){
  if(adminTab === 'backup' || adminTab === 'cloud') adminTab = 'dashboard';
  return __v28BaseRenderAdminContent();
};
renderAdmin = function(ws){
  if(adminTab === 'backup' || adminTab === 'cloud') adminTab = 'dashboard';
  const tabs=['dashboard','setup','reports','paid','categories','items','deals','tables','takers','payments','users','roles','settings'];
  ws.innerHTML=`<div class="admin-layout"><div class="panel admin-nav"><div class="admin-nav-title"><b>Admin Panel</b><span>Back office</span></div>${tabs.map(t=>`<button class="${adminTab===t?'active':''}" data-admin-tab="${t}"><span class="admin-nav-icon">${tabIcon(t)}</span><span>${labelTab(t)}</span></button>`).join('')}</div><div class="panel admin-content" id="adminContent"></div></div>`;
  $$('[data-admin-tab]').forEach(b=>b.onclick=()=>{adminTab=b.dataset.adminTab;renderAdmin(ws);});
  renderAdminContent();
};
function renderBackup(c){
  const b=state.backup||{};
  c.innerHTML=`<div class="module-title"><div><h3>Backup & History</h3><p class="muted-note">Automatic backups run in the background. Raw backup files are owner/developer-only and hidden from restaurant staff.</p></div></div><div class="grid2"><div class="card subcard"><h3>Protected History</h3><p>Paid bills, refunds, voids, payment corrections and reports stay preserved in Neon.</p><p>Deleting menu data does not remove old paid bill/report history.</p></div><div class="card subcard"><h3>Automatic Backup Status</h3><p>Mode: <b>${esc(b.mode||'cloud/database')}</b></p><p>Daily retention: <b>${b.dailyRetentionDays||30} days</b></p><p>Monthly retention: <b>${b.monthlyRetentionMonths||12} months</b></p><p>Latest: <b>${b.latest?new Date(b.latest.exportedAt).toLocaleString():'Background backup pending'}</b></p></div></div>`;
}


/* ============================================================
   SwiftTill V29 Extreme Cart Compression
   - tighter right bill panel, max item visibility
============================================================ */
function orderMetaGridV29(o){
  const tableName = o.type === 'DINE_IN' ? (state.tables.find(t=>t.id===o.tableId)?.name || '—') : '—';
  const rows = o.type === 'DINE_IN'
    ? [['Type', formatType(o.type), '🍴'], ['Table', tableName, '▣'], ['Guests', `${Number(o.guests||0)}`, '👥'], ['Taker', o.orderTakerName || '—', '👤']]
    : o.type === 'DELIVERY'
      ? [['Type', 'Delivery', '🛵'], ['Customer', o.customerName || '—', '👤'], ['Mobile', o.mobile || '—', '☎'], ['Fee', money(o.deliveryFee || 0), '₨']]
      : [['Type', 'Takeaway', '🛍'], ['Customer', o.customerName || 'Walk-in', '👤'], ['Mobile', o.mobile || '—', '☎'], ['Taker', o.orderTakerName || state.user?.name || '—', '👤']];
  return `<div class="order-meta-grid v29-order-meta-grid">${rows.map(([label,value,icon])=>`<div class="order-meta-cell"><span>${icon} ${esc(label)}</span><b>${esc(value)}</b></div>`).join('')}</div>`;
}
renderBill = function(){
  const bp=$('#billPanel'); if(!bp) return;
  if(!currentOrder){
    bp.innerHTML=`<div class="bill-head compact-bill-head v29-bill-head"><h2>Current Order</h2><b>—</b></div><div class="empty-cart compact-empty"><div><b>No active bill</b><p>Press New Order to start billing.</p></div></div>`;
    return;
  }
  currentOrder.lines = Array.isArray(currentOrder.lines) ? currentOrder.lines : [];
  const t=calcTotals(currentOrder);
  const hasLines = hasOrderLines(currentOrder);
  const printBillButton = `<button class="secondary-btn mini-action print-mini" id="printBillBtn" ${hasLines?'':'disabled title="Add item first"'}>🧾 Print</button>`;
  const moveButton = `<button class="secondary-btn mini-action move-mini" id="moveTableBtn" ${currentOrder.type==='DINE_IN'?'':'disabled title="Move table is only for dine-in"'}>⇄ Move</button>`;
  const splitButton = `<button class="secondary-btn mini-action split-mini" id="splitBillBtn" ${hasLines?'':'disabled title="Add item first"'}>⫶ Split</button>`;
  const deliveryRow = currentOrder.type==='DELIVERY' ? `<div class="total-row compact-row"><span>Delivery</span><b>${money(t.deliveryFee)}</b></div>` : '';
  bp.innerHTML=`
    <div class="bill-head compact-bill-head v29-bill-head"><h2>Current Order</h2><b>#${esc(currentOrder.number||'Draft')}</b></div>
    <div class="orderbox compact-orderbox v29-orderbox">${orderMetaGridV29(currentOrder)}</div>
    <div class="line-list cart-density-list v29-cart-list">${currentOrder.lines.length?currentOrder.lines.map(cartLine).join(''):'<div class="empty-cart cart-empty-compact">Add items from the center menu.</div>'}</div>
    <div class="totals compact-totals v28-totals v29-totals">
      <div class="total-row compact-row"><span>Subtotal</span><b>${money(t.subtotal)}</b></div>
      <div class="discount-row compact-discount"><span>Discount</span><div class="switch"><button class="${currentOrder.discountType==='FIXED'?'active':''}" data-disc="FIXED">Rs</button><button class="${currentOrder.discountType==='PERCENT'?'active':''}" data-disc="PERCENT">%</button></div><input class="small-input" id="discountVal" value="${Number(currentOrder.discountValue||0)}"></div>
      ${deliveryRow}
      <div class="total-row big compact-total"><span>Total</span><b>${money(t.total)}</b></div>
    </div>
    <div class="bill-quick-actions one-line-actions v29-actions">${printBillButton}${moveButton}${splitButton}</div>
    <label class="check print-check compact-check v29-print-check"><input type="checkbox" id="printRemember" ${getPrintDefault()?'checked':''}> Print after pay</label>
    <div class="actions compact-main-actions v29-main-actions"><button class="hold" id="holdBtn" ${hasLines?'':'disabled title="Add item first"'}>Ⅱ HOLD</button><button class="pay" id="payBtn" ${hasLines?'':'disabled title="Add item first"'}>▣ PAY ${money(t.total)}</button></div>`;
  $('#mobileCloseCart') && ($('#mobileCloseCart').onclick = () => setMobileBill(false));
  $$('[data-line-minus]').forEach(b=>b.onclick=()=>changeQty(b.dataset.lineMinus,-1));
  $$('[data-line-plus]').forEach(b=>b.onclick=()=>changeQty(b.dataset.linePlus,1));
  $$('[data-line-remove]').forEach(b=>b.onclick=()=>{currentOrder.lines=currentOrder.lines.filter(l=>l.lineId!==b.dataset.lineRemove);renderBill();});
  $$('[data-line-edit]').forEach(b=>b.onclick=()=>openLineModal(b.dataset.lineEdit));
  $$('[data-qty-input]').forEach(inp=>inp.onchange=()=>{const l=currentOrder.lines.find(x=>x.lineId===inp.dataset.qtyInput); if(l){l.qty=Math.max(1,Number(inp.value)||1); renderBill();}});
  $$('[data-disc]').forEach(b=>b.onclick=()=>{currentOrder.discountType=currentOrder.discountType===b.dataset.disc?'NONE':b.dataset.disc; if(currentOrder.discountType==='NONE') currentOrder.discountValue=0; renderBill();});
  const disc=$('#discountVal'); if(disc) disc.onchange=e=>{ currentOrder.discountValue=Math.max(0,Number(e.target.value)||0); if(currentOrder.discountValue>0 && currentOrder.discountType==='NONE') currentOrder.discountType='FIXED'; renderBill(); };
  const remember=$('#printRemember'); if(remember) remember.onchange=e=>localStorage.setItem('swifttill_print_default', e.target.checked?'1':'0');
  const hold=$('#holdBtn'); if(hold) hold.onclick=()=>saveOrder(true);
  const pay=$('#payBtn'); if(pay) pay.onclick=()=>openPayModal();
  const print=$('#printBillBtn'); if(print) print.onclick=()=>printCurrentBill();
  const move=$('#moveTableBtn'); if(move && currentOrder.type==='DINE_IN') move.onclick=()=>openMoveTableModal();
  const split=$('#splitBillBtn'); if(split) split.onclick=()=>openSplitBillModal();
};


/* ============================================================
   SwiftTill V30 Media + Admin Filters + Branding System
   - safe food image frames, no half-cropped menu pictures
   - admin category filter/search/sorting
   - favicon/login/header/bill/report SwiftTill branding
============================================================ */
function productBrandMark(){
  return `<img class="swifttill-product-mark" src="/assets/img/icon-192.png" alt="SwiftTill POS">`;
}
renderLogin = function(){
  app.innerHTML = `<div class="login-screen v30-login-screen">
    <div class="login-watermark">${productBrandMark()}</div>
    <form class="login-card v30-login-card" id="loginForm">
      <div class="login-brand-visual">${productBrandMark()}<b>SwiftTill</b><span>Cloud POS</span></div>
      <h1>Sign in to POS</h1><p>Secure restaurant billing, reports and thermal printing workspace.</p>
      <div class="field"><label>Email</label><input name="email" autocomplete="username" required></div>
      <div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password" required></div>
      <button class="primary-btn" style="width:100%">Login</button>
      <p class="muted-note">Use credentials issued by the system owner.</p>
    </form>
  </div>`;
  $('#loginForm').addEventListener('submit', async e => { e.preventDefault(); const f = new FormData(e.target); try{ const j = await api('/api/login', Object.fromEntries(f)); token = j.token; localStorage.setItem('swifttill_token', token); await boot(); }catch(err){ toast(err.message,true); } });
};

renderTopbar = function(){
  const d = new Date(); const active = state.activeShift; const s = state.settings || {};
  const logo = s.logoUrl ? `<img class="topbar-company-logo" src="${esc(s.logoUrl)}" alt="${esc(s.businessName || 'Company Logo')}">` : `<span class="topbar-company-logo text-logo">ST</span>`;
  const back = screen === 'admin' ? `<button class="ghost-btn top-action back-pos-action" id="backPosBtn">← Back to POS</button>` : '';
  return `<div class="hello v30-hello"><div class="topbar-brand-wrap">${logo}<div><h2>${esc(s.businessName || 'SwiftTill POS')}</h2><p>${screen==='admin'?'Back office controls, reports and setup.':'Fast billing workspace for active restaurant operations.'}</p></div></div></div>
  <div class="top-items">
    <div class="top-pill date-pill">📅 <span><b>${d.toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short',year:'numeric'})}</b>${d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span></div>
    <div class="top-pill user-pill">👤 <span><b>${esc(state.user.name)}</b>${esc(state.user.roles.join(', ') || 'User')}</span></div>
    <div class="top-pill branch-pill"><span class="status-dot"></span><span><b>${esc(s.branchName || 'Main Branch')}</b>System Online</span></div>
    ${back}
    <button class="ghost-btn shift-action" id="shiftBtn">${active?'Close Shift':'Open Shift'}</button>
    <button class="ghost-btn logout-action" id="logoutBtn">Logout</button>
  </div>`;
};

function adminListFilters(key){
  window.swiftAdminListFilters ||= {};
  window.swiftAdminListFilters[key] ||= { search:'', category:'', active:'all', sort:'sortAsc' };
  return window.swiftAdminListFilters[key];
}
function adminListSortOptions(key){
  const base=[['sortAsc','Sort order'],['nameAsc','Name A-Z'],['nameDesc','Name Z-A']];
  if(key==='items'||key==='deals') base.push(['priceAsc','Price low-high'],['priceDesc','Price high-low']);
  if(key==='items') base.push(['categoryAsc','Category']);
  if(key==='tables') base.push(['seatsAsc','Seats low-high'],['seatsDesc','Seats high-low']);
  base.push(['activeFirst','Active first'],['inactiveFirst','Inactive first']);
  return base;
}
function adminListControls(key){
  const f=adminListFilters(key);
  const categoryControl = key==='items' ? `<div class="field admin-filter-field"><label>Category</label><select id="adminCategoryFilter"><option value="">All Categories</option>${(state.categories||[]).filter(c=>c.id!=='cat_all'&&c.id!=='all').map(c=>`<option value="${esc(c.id)}" ${f.category===c.id?'selected':''}>${esc(c.name)}</option>`).join('')}</select></div>` : '';
  const activeControl = ['categories','items','deals','tables','orderTakers','paymentMethods','users','roles'].includes(key) ? `<div class="field admin-filter-field"><label>Status</label><select id="adminActiveFilter"><option value="all" ${f.active==='all'?'selected':''}>All</option><option value="active" ${f.active==='active'?'selected':''}>Active</option><option value="inactive" ${f.active==='inactive'?'selected':''}>Inactive</option></select></div>` : '';
  return `<div class="admin-filterbar card"><div class="field admin-filter-field search-field"><label>Search</label><input id="adminSearchFilter" value="${esc(f.search)}" placeholder="Search ${esc(labelTab(key))}..."></div>${categoryControl}${activeControl}<div class="field admin-filter-field"><label>Sort By</label><select id="adminSortFilter">${adminListSortOptions(key).map(([v,l])=>`<option value="${v}" ${f.sort===v?'selected':''}>${l}</option>`).join('')}</select></div></div>`;
}
function adminApplyRows(key, rows){
  const f=adminListFilters(key);
  let out=[...rows];
  const search=(f.search||'').trim().toLowerCase();
  if(search) out=out.filter(r=>[r.name,r.email,r.description,r.categoryId,state.categories?.find(c=>c.id===r.categoryId)?.name].filter(Boolean).join(' ').toLowerCase().includes(search));
  if(key==='items' && f.category) out=out.filter(r=>r.categoryId===f.category);
  if(f.active==='active') out=out.filter(r=>r.active!==false);
  if(f.active==='inactive') out=out.filter(r=>r.active===false);
  const byName=(a,b)=>String(a.name||'').localeCompare(String(b.name||''));
  const sort=f.sort || 'sortAsc';
  out.sort((a,b)=>{
    if(sort==='nameAsc') return byName(a,b);
    if(sort==='nameDesc') return byName(b,a);
    if(sort==='priceAsc') return Number(a.price||0)-Number(b.price||0);
    if(sort==='priceDesc') return Number(b.price||0)-Number(a.price||0);
    if(sort==='categoryAsc') return String(state.categories?.find(c=>c.id===a.categoryId)?.name||'').localeCompare(String(state.categories?.find(c=>c.id===b.categoryId)?.name||'')) || byName(a,b);
    if(sort==='seatsAsc') return Number(a.seats||0)-Number(b.seats||0);
    if(sort==='seatsDesc') return Number(b.seats||0)-Number(a.seats||0);
    if(sort==='activeFirst') return (a.active===false)-(b.active===false) || byName(a,b);
    if(sort==='inactiveFirst') return (b.active===false)-(a.active===false) || byName(a,b);
    return Number(a.sort||9999)-Number(b.sort||9999) || byName(a,b);
  });
  return out;
}
function adminCell(r, f){
  if(f==='price') return `<b>${Number(r[f]||0)>0?money(r[f]):'<span class="danger-text">Set price</span>'}</b>`;
  if(f==='categoryId') return esc(state.categories.find(c=>c.id===r[f])?.name || r[f] || '');
  if(f==='roleIds') return esc((r[f]||[]).map(id=>state.roles.find(x=>x.id===id)?.name||id).join(', '));
  if(f==='permissions') return esc((r[f]||[]).length + ' permissions');
  if(r[f]===true) return '<span class="status-chip ok">Active</span>';
  if(r[f]===false) return '<span class="status-chip muted">Inactive</span>';
  return esc(Array.isArray(r[f]) ? r[f].join(', ') : (r[f] ?? ''));
}
adminList = function(c,key,apiName,fields){
  const allRows=state[key]||[]; const rows=adminApplyRows(key, allRows);
  c.innerHTML=`<div class="admin-wrap v30-admin-list"><div class="module-title"><div><h3>${esc(labelTab(key))}</h3><p class="muted-note">${rows.length} shown from ${allRows.length}. Use filters and sorting for fast admin work.</p></div><button class="primary-btn" onclick="openAdminEditor('${apiName}')">Add New</button></div>${adminListControls(key)}<div class="report-table-wrap admin-table-shell"><table class="admin-table"><thead><tr><th>Image</th>${fields.map(f=>`<th>${esc(f==='categoryId'?'Category':f==='roleIds'?'Roles':f)}</th>`).join('')}<th>Action</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.imageUrl?`<img class="thumb admin-thumb" src="${esc(r.imageUrl)}" alt="">`:''}</td>${fields.map(f=>`<td>${adminCell(r,f)}</td>`).join('')}<td><div class="row-actions"><button class="ghost-btn tiny" data-admin-edit="${esc(r.id)}">Edit</button><button class="danger-btn tiny" data-admin-delete="${esc(r.id)}">Delete</button></div></td></tr>`).join('') || `<tr><td colspan="${fields.length+2}" class="empty-td">No records match these filters.</td></tr>`}</tbody></table></div></div>`;
  const f=adminListFilters(key);
  $('#adminSearchFilter')?.addEventListener('input', e=>{ f.search=e.target.value; adminList(c,key,apiName,fields); });
  $('#adminCategoryFilter')?.addEventListener('change', e=>{ f.category=e.target.value; adminList(c,key,apiName,fields); });
  $('#adminActiveFilter')?.addEventListener('change', e=>{ f.active=e.target.value; adminList(c,key,apiName,fields); });
  $('#adminSortFilter')?.addEventListener('change', e=>{ f.sort=e.target.value; adminList(c,key,apiName,fields); });
  $$('[data-admin-edit]', c).forEach(b=>b.onclick=()=>{ const record=(state[key]||[]).find(x=>x.id===b.dataset.adminEdit); if(record) openAdminEditor(apiName, clone(record)); });
  $$('[data-admin-delete]', c).forEach(b=>b.onclick=()=>deleteAdminRecord(apiName,b.dataset.adminDelete));
};

const __v30BaseReceiptHTML = receiptHTML;
receiptHTML = function(r){
  let html = __v30BaseReceiptHTML(r || {});
  const brand = '<div class="sep"></div><div class="swifttill-powered">Powered by SwiftTill POS</div>';
  return html.replace(/<\/div>\s*$/, `${brand}</div>`);
};
const __v30BaseRenderBill = renderBill;
renderBill = function(){
  __v30BaseRenderBill();
  const bp=$('#billPanel');
  if(bp && currentOrder){ bp.insertAdjacentHTML('beforeend','<div class="billing-brand-footer">SwiftTill POS</div>'); }
};


/* ============================================================
   SwiftTill V34 Mobile + Reports Navigation + Operational Scenarios
   - visible favicon/branding support
   - reports submenu lives in Admin left navigation
   - organization logo on reports
   - mobile back/close/open-bills/pay controls
   - operational scenario checklist for local restaurant risks
============================================================ */
const V34_REPORT_GROUPS = [
  ['Sales', [['daily','Daily'],['custom','Custom'],['ordertype','Order Type']]],
  ['Menu', [['itemwise','Item Wise'],['category','Category Wise']]],
  ['Cash', [['payment','Payment'],['discount','Discounts'],['voidrefund','Void/Refund']]],
  ['Closeout', [['x','X Report'],['y','Y Report'],['z','Z Report']]]
];
function v34ReportNav(){
  return `<div class="admin-report-subnav">${V34_REPORT_GROUPS.map(([g,items])=>`<div class="report-nav-group"><small>${esc(g)}</small>${items.map(([key,label])=>`<button class="${reportType===key?'active':''}" data-report-type="${key}"><span>${esc(label)}</span></button>`).join('')}</div>`).join('')}</div>`;
}
function v34OrgLogoImg(cls='report-org-logo'){
  const s = state?.settings || {};
  const src = s.logoUrl || '/assets/img/icon-192.png';
  return `<img class="${cls}" src="${esc(src)}" alt="${esc(s.businessName || 'Restaurant logo')}">`;
}
const __v34BaseLabelTab = labelTab;
labelTab = function(t){ return t==='ops' ? 'Operational Safety' : __v34BaseLabelTab(t); };
const __v34BaseTabIcon = tabIcon;
tabIcon = function(t){ return t==='ops' ? '⚡' : __v34BaseTabIcon(t); };
renderAdmin = function(ws){
  if(adminTab === 'backup' || adminTab === 'cloud') adminTab = 'dashboard';
  const tabs=['dashboard','setup','reports','paid','categories','items','deals','tables','takers','payments','users','roles','settings','ops'];
  ws.innerHTML=`<div class="admin-layout v34-admin-layout"><div class="panel admin-nav v34-admin-nav"><div class="admin-nav-title"><b>Admin Panel</b><span>Back office</span></div>${tabs.map(t=>`<div class="admin-nav-slot ${adminTab===t?'active-slot':''}"><button class="${adminTab===t?'active':''}" data-admin-tab="${t}"><span class="admin-nav-icon">${tabIcon(t)}</span><span>${labelTab(t)}</span></button>${t==='reports'?v34ReportNav():''}</div>`).join('')}</div><div class="panel admin-content" id="adminContent"></div></div>`;
  $$('[data-admin-tab]').forEach(b=>b.onclick=()=>{adminTab=b.dataset.adminTab;renderAdmin(ws);});
  $$('[data-report-type]').forEach(b=>b.onclick=()=>{reportType=b.dataset.reportType; adminTab='reports'; renderAdmin(ws);});
  renderAdminContent();
};
const __v34BaseRenderAdminContent = renderAdminContent;
renderAdminContent = function(){
  const c=$('#adminContent');
  if(adminTab==='ops') return renderOpsSafety(c);
  return __v34BaseRenderAdminContent();
};
function renderReports(ws){
  try{
    const defs = reportDateDefaults(reportType);
    const paymentOptions=(state.paymentMethods||[]).filter(p=>p.active!==false).map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
    const itemOptions=[...(state.items||[]).map(i=>`<option value="${esc(i.id)}">${esc(i.name)}</option>`),...(state.deals||[]).map(d=>`<option value="${esc(d.id)}">Deal: ${esc(d.name)}</option>`)].join('');
    const catOptions=(state.categories||[]).filter(c=>c.id!=='cat_all' && c.id!=='all').map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    const userOptions=(state.users||[]).map(u=>`<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
    const takerOptions=(state.orderTakers||[]).map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    const shiftOptions=(state.shifts||[]).map(s=>`<option value="${esc(s.id)}">#${s.number} ${esc(s.status||'')}</option>`).join('');
    ws.innerHTML=`<div class="report-page admin-report-shell pro-report-screen qb-report-module v34-report-page">
      <div class="module-title v34-report-title"><div><h3>${esc(currentReportTitle())}</h3><p class="muted-note">Reports submenu left sidebar mein hai. Screen view rich hai; PDF/A4 aur Thermal print alag professional templates hain.</p></div><div class="actions-mini"><button class="ghost-btn" id="exportReport" disabled>Export Excel</button><button class="ghost-btn" id="printReportPdfBtn" disabled>PDF / A4</button><button class="primary-btn" id="printReportThermalBtn" disabled>Thermal Print</button></div></div>
      <div class="report-work card subcard v34-report-work">
        <div class="report-headline branded-report-headline"><div class="brand-report-name">${v34OrgLogoImg('report-org-logo screen-logo')}<div><h3 id="reportTitle">${esc(currentReportTitle())}</h3><span>${esc(state.settings?.businessName||'SwiftTill POS')}</span></div></div></div>
        <div class="report-filter-grid compact-filters" id="reportFilters">
          <div class="field report-filter date-filter"><label>From</label><input type="date" id="fromDate" value="${defs.from}"></div>
          <div class="field report-filter date-filter"><label>To</label><input type="date" id="toDate" value="${defs.to}"></div>
          <div class="field report-filter payment-filter"><label>Payment Mode</label><select id="paymentMode"><option value="">All</option>${paymentOptions}</select></div>
          <div class="field report-filter ordertype-filter"><label>Order Type</label><select id="orderType"><option value="">All</option><option value="DINE_IN">Dine In</option><option value="DELIVERY">Delivery</option><option value="TAKEAWAY">Takeaway</option></select></div>
          <div class="field report-filter item-filter"><label>Item / Deal</label><select id="itemId"><option value="">All</option>${itemOptions}</select></div>
          <div class="field report-filter category-filter"><label>Category</label><select id="categoryFilter"><option value="">All</option>${catOptions}</select></div>
          <div class="field report-filter cashier-filter"><label>Cashier</label><select id="cashierId"><option value="">All</option>${userOptions}</select></div>
          <div class="field report-filter taker-filter"><label>Order Taker</label><select id="orderTakerId"><option value="">All</option>${takerOptions}</select></div>
          <div class="field report-filter shift-filter"><label>Shift</label><select id="shiftId"><option value="">All</option>${shiftOptions}</select></div>
          <label class="check report-filter discount-filter"><input type="checkbox" id="discountOnly"> Discounted only</label>
          <label class="check report-filter refund-filter"><input type="checkbox" id="refundOnly"> Refunded only</label>
          <button class="primary-btn" id="runReport">Run Report</button>
        </div>
        <div id="reportResult" class="mt"><div class="empty-cart compact-empty"><b>Select report from left menu.</b><p>Run report to show totals, PDF/A4, thermal slip print and export.</p></div></div>
      </div>
    </div>`;
    updateReportFilterVisibility();
    $('#runReport').onclick=runReport;
    $('#printReportPdfBtn').onclick=()=>printReportHtml('a4');
    $('#printReportThermalBtn').onclick=()=>printReportHtml('thermal');
    $('#exportReport').onclick=()=>downloadApi(`/api/export?${reportQuery()}`,`swifttill-${reportType}-report-${Date.now()}.csv`).catch(e=>toast(e.message,true));
  }catch(e){ ws.innerHTML=`<div class="card subcard error-state"><h3>Reports failed to render</h3><p>${esc(e.message)}</p><button class="primary-btn" onclick="renderAdminContent()">Reload Reports</button></div>`; }
}
const __v34BaseA4ReportHtml = buildA4ReportHtml;
buildA4ReportHtml = function(r){
  let html = __v34BaseA4ReportHtml(r);
  const logo = v34OrgLogoImg('report-org-logo a4-logo');
  html = html.replace('<div class="qb-head"><div><h1>', '<div class="qb-head"><div class="qb-brand-block">'+logo+'<div><h1>');
  html = html.replace('</p></div><div><b>', '</p></div></div><div><b>');
  return html;
};
const __v34BaseThermalReportHtml = buildThermalReportHtml;
buildThermalReportHtml = function(r){
  let html = __v34BaseThermalReportHtml(r);
  const logo = v34OrgLogoImg('thermal-logo');
  return html.replace('<div class="thermal-report"><div class="tr-center"><b>', '<div class="thermal-report"><div class="tr-center">'+logo+'<br><b>');
};
const __v34BaseRenderShell = renderShell;
renderShell = function(){
  __v34BaseRenderShell();
  if(screen === 'pos') injectMobilePosControls();
};
function injectMobilePosControls(){
  const topbar = document.querySelector('.topbar');
  if(topbar && !document.querySelector('.mobile-pos-strip')){
    topbar.insertAdjacentHTML('afterend', `<div class="mobile-pos-strip panel"><button id="mobileBackMenu" type="button">← Menu</button><button id="mobileOpenBills" type="button">Open Bills <b>${state.openOrders?.length||0}</b></button><button id="mobilePayBill" type="button">${currentOrder && hasOrderLines(currentOrder) ? 'Pay Now' : 'Open Bill'}</button></div>`);
    $('#mobileBackMenu').onclick=()=>{ setMobileBill(false); screen='pos'; centerMode='menu'; renderShell(); };
    $('#mobileOpenBills').onclick=()=>{ setMobileBill(false); screen='pos'; centerMode='open'; renderShell(); };
    $('#mobilePayBill').onclick=()=>{ if(currentOrder && hasOrderLines(currentOrder)) openPayModal(); else setMobileBill(true); };
  }
  addMobileCartClose();
}
function addMobileCartClose(){
  const bp=$('#billPanel'); const head=bp?.querySelector('.bill-head');
  if(head && !head.querySelector('#mobileCloseCart')){
    head.insertAdjacentHTML('beforeend','<button class="mobile-close-cart" id="mobileCloseCart" type="button" aria-label="Close bill">×</button>');
    $('#mobileCloseCart').onclick=()=>setMobileBill(false);
  }
}
const __v34BaseRenderBill = renderBill;
renderBill = function(){
  __v34BaseRenderBill();
  addMobileCartClose();
  const fab=$('#mobileCartFab b'); if(fab) fab.textContent=mobileCartSummary();
  const pay=$('#mobilePayBill'); if(pay) pay.textContent=currentOrder && hasOrderLines(currentOrder) ? 'Pay Now' : 'Open Bill';
};
async function renderOpsSafety(c){
  c.innerHTML = `<div class="module-title"><div><h3>Operational Safety</h3><p class="muted-note">Local restaurant scenarios: crash, power cut, internet drop, printer offline and recovery steps.</p></div><button class="ghost-btn" id="refreshOps">Refresh</button></div><div id="opsScenarioBox" class="ops-grid"><div class="report-loading"><b>Loading safety matrix...</b><span>Checking live system readiness.</span></div></div>`;
  $('#refreshOps').onclick=()=>renderOpsSafety(c);
  try{
    const j=await api('/api/ops/scenarios', null, 'GET');
    const ready=j.readiness||{};
    $('#opsScenarioBox').innerHTML=`<div class="ops-status card subcard"><h3>Readiness</h3>${Object.entries(ready).map(([k,v])=>`<p><span>${esc(k.replace(/([A-Z])/g,' $1'))}</span><b>${esc(v)}</b></p>`).join('')}</div><div class="ops-list">${(j.scenarios||[]).map(x=>`<div class="card subcard ops-card"><h3>${esc(x.scenario)}</h3><p><b>Protection:</b> ${esc(x.protection)}</p><p><b>Action:</b> ${esc(x.action)}</p></div>`).join('')}</div>`;
  }catch(e){ $('#opsScenarioBox').innerHTML=`<div class="empty-cart error-state"><b>Safety matrix failed</b><p>${esc(e.message)}</p></div>`; }
}


/* ============================================================
   SwiftTill V37 Mobile Add-Item Flow Fix
   - mobile item/deal taps no longer force-open the bill drawer
   - bill drawer opens only from Bill/Open Bill/Pay controls
   - cashier can add many items quickly from menu during rush hours
============================================================ */
addItem = async function(itemId){
  if(!requireNotRapidClick()) return;
  const i=state.items.find(x=>x.id===itemId);
  if(!i||i.soldOut) return;
  if(numericPrice(i.price)<=0) return toast('Set item price in Admin before billing', true);
  if(!(await ensureOrder())) return;
  const line=currentOrder.lines.find(l=>l.kind==='ITEM'&&l.itemId===i.id&&(!l.modifiers||!l.modifiers.length)&&!l.note);
  if(line) line.qty++;
  else currentOrder.lines.push({lineId:uid(),kind:'ITEM',itemId:i.id,categoryId:i.categoryId,name:i.name,price:i.price,imageUrl:i.imageUrl,qty:1,note:'',modifiers:[]});
  renderBill();
  const fab=$('#mobileCartFab b'); if(fab) fab.textContent=mobileCartSummary();
  const pay=$('#mobilePayBill'); if(pay) pay.textContent=currentOrder && hasOrderLines(currentOrder) ? 'Pay Now' : 'Open Bill';
  if(!isMobileViewport()) setMobileBill(mobileBillOpen);
  toast(line ? `${i.name} quantity updated` : `${i.name} added`);
};
addDeal = async function(dealId){
  if(!requireNotRapidClick()) return;
  const d=state.deals.find(x=>x.id===dealId);
  if(!d) return;
  if(numericPrice(d.price)<=0) return toast('Set deal price in Admin before billing', true);
  if(!(await ensureOrder())) return;
  const line=currentOrder.lines.find(l=>l.kind==='DEAL'&&l.dealId===d.id&&!l.note);
  if(line) line.qty++;
  else currentOrder.lines.push({lineId:uid(),kind:'DEAL',dealId:d.id,categoryId:'cat_deals',name:d.name,price:d.price,imageUrl:d.imageUrl,qty:1,note:'',modifiers:[],dealItems:d.items});
  renderBill();
  const fab=$('#mobileCartFab b'); if(fab) fab.textContent=mobileCartSummary();
  const pay=$('#mobilePayBill'); if(pay) pay.textContent=currentOrder && hasOrderLines(currentOrder) ? 'Pay Now' : 'Open Bill';
  if(!isMobileViewport()) setMobileBill(mobileBillOpen);
  toast(line ? `${d.name} quantity updated` : `${d.name} added`);
};


/* ============================================================
   SwiftTill V38 Live Cross-Device Sync
   - mobile/PC both refresh from Neon state automatically
   - cart changes auto-save after short debounce
   - paid/closed order on one device disappears from other device
   - open bills/tables/pay state stay current without manual refresh
============================================================ */
let __syncTimer = null;
let __syncInFlight = false;
let __lastSyncRevision = 0;
let __localDirtyOrder = false;
let __cartSaveTimer = null;
let __cartSaveInFlight = false;
let __lastRemoteNoticeAt = 0;
let __suspendSyncUntil = 0;

async function apiQuiet(path, data=null, method='GET'){
  const res = await fetch(path, { method, headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body:data ? JSON.stringify(data) : undefined, cache:'no-store' });
  const json = await res.json().catch(()=>({ok:false,error:'Invalid server response'}));
  if(res.status===401){ localStorage.removeItem('swifttill_token'); token=''; stopLiveSync(); renderLogin(); throw new Error('Session expired. Login again.'); }
  if(!res.ok || json.ok===false) throw new Error(json.error || 'Request failed');
  return json;
}
const __v38BaseLoadState = loadState;
loadState = async function(){
  await __v38BaseLoadState();
  if(state?.sync?.revision) __lastSyncRevision = Number(state.sync.revision || __lastSyncRevision || 0);
};
async function loadStateQuiet(){
  const j = await apiQuiet('/api/state', null, 'GET');
  state = j.data;
  if(state?.sync?.revision) __lastSyncRevision = Number(state.sync.revision || __lastSyncRevision || 0);
  return state;
}
function orderServerCopy(orderId){ return (state?.openOrders||[]).find(o=>o.id===orderId) || (state?.paidOrders||[]).find(o=>o.id===orderId) || null; }
function showRemoteToast(msg){ const n=Date.now(); if(n-__lastRemoteNoticeAt>2500){ __lastRemoteNoticeAt=n; toast(msg); } }
function reconcileRemoteState(sync){
  const id = currentOrder?.id || '';
  let rerender = false;
  if(id){
    const current = sync?.currentOrder || orderServerCopy(id);
    const serverPaid = current?.status === 'PAID' || (state?.paidOrders||[]).some(o=>o.id===id);
    const serverOpen = (state?.openOrders||[]).find(o=>o.id===id);
    if(serverPaid){
      currentOrder = null;
      __localDirtyOrder = false;
      closeModal();
      setMobileBill(false);
      showRemoteToast('This bill was paid/closed on another device.');
      rerender = true;
    } else if(serverOpen && !__localDirtyOrder){
      currentOrder = clone(serverOpen);
      rerender = true;
    } else if(!serverOpen && !__localDirtyOrder && !hasOrderLines(currentOrder)){
      currentOrder = null;
      rerender = true;
    }
  }
  if(screen==='pos'){
    if(centerMode==='open' || centerMode==='tables' || rerender) renderShell();
    else { renderBill(); const fab=$('#mobileCartFab b'); if(fab) fab.textContent=mobileCartSummary(); const pay=$('#mobilePayBill'); if(pay) pay.textContent=currentOrder && hasOrderLines(currentOrder) ? 'Pay Now' : 'Open Bill'; }
  } else if(screen==='admin' && adminTab==='reports') {
    renderAdminContent();
  }
}
async function syncNow(reason='poll'){
  if(!token || !state || __syncInFlight || Date.now()<__suspendSyncUntil) return;
  __syncInFlight = true;
  try{
    const q = currentOrder?.id ? `?orderId=${encodeURIComponent(currentOrder.id)}` : '';
    const j = await apiQuiet('/api/sync/status'+q, null, 'GET');
    const rev = Number(j.sync?.revision || 0);
    if(rev && rev !== __lastSyncRevision){
      const remoteSync = j.sync;
      await loadStateQuiet();
      reconcileRemoteState(remoteSync);
    }
  }catch(e){
    if(navigator.onLine) console.warn('SwiftTill sync check failed:', e.message);
  }finally{ __syncInFlight = false; }
}
function startLiveSync(){
  if(__syncTimer) return;
  __syncTimer = setInterval(()=>syncNow('interval'), 1800);
  window.addEventListener('focus', ()=>syncNow('focus'));
  document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) syncNow('visible'); });
  window.addEventListener('online', ()=>syncNow('online'));
}
function stopLiveSync(){ if(__syncTimer){ clearInterval(__syncTimer); __syncTimer=null; } }
function markCartDirty(){
  if(!currentOrder?.id) return;
  __localDirtyOrder = true;
  clearTimeout(__cartSaveTimer);
  __cartSaveTimer = setTimeout(autoSaveCurrentOrder, 550);
}
async function autoSaveCurrentOrder(){
  if(!token || !currentOrder?.id || __cartSaveInFlight) return;
  if(!hasOrderLines(currentOrder)) return;
  __cartSaveInFlight = true;
  __suspendSyncUntil = Date.now()+1200;
  const payload = clone(currentOrder);
  try{
    const j = await apiQuiet('/api/orders/cart-sync', payload, 'POST');
    if(currentOrder?.id === j.order?.id) currentOrder = j.order;
    __localDirtyOrder = false;
    if(j.sync?.revision) __lastSyncRevision = Number(j.sync.revision || __lastSyncRevision || 0);
    await loadStateQuiet();
    const fab=$('#mobileCartFab b'); if(fab) fab.textContent=mobileCartSummary();
    const pay=$('#mobilePayBill'); if(pay) pay.textContent=currentOrder && hasOrderLines(currentOrder) ? 'Pay Now' : 'Open Bill';
  }catch(e){
    if(/already paid|Order already paid/i.test(e.message)){
      __localDirtyOrder = false;
      currentOrder = null;
      closeModal();
      await loadStateQuiet().catch(()=>null);
      renderShell();
      toast('Bill already paid on another device.', true);
    } else {
      console.warn('SwiftTill cart autosave failed:', e.message);
    }
  }finally{ __cartSaveInFlight = false; }
}
const __v38BaseAddItem = addItem;
addItem = async function(itemId){ await __v38BaseAddItem(itemId); markCartDirty(); };
const __v38BaseAddDeal = addDeal;
addDeal = async function(dealId){ await __v38BaseAddDeal(dealId); markCartDirty(); };
const __v38BaseChangeQty = changeQty;
changeQty = function(lineId, delta){ __v38BaseChangeQty(lineId, delta); markCartDirty(); };
const __v38BaseRenderBill = renderBill;
renderBill = function(){
  __v38BaseRenderBill();
  $$('[data-line-remove]').forEach(b=>b.addEventListener('click',()=>setTimeout(markCartDirty,0)));
  $$('[data-qty-input]').forEach(inp=>inp.addEventListener('change',()=>setTimeout(markCartDirty,0)));
  $$('[data-disc]').forEach(b=>b.addEventListener('click',()=>setTimeout(markCartDirty,0)));
  const disc=$('#discountVal'); if(disc) disc.addEventListener('change',()=>setTimeout(markCartDirty,0));
};
const __v38BaseOpenPayModal = openPayModal;
openPayModal = async function(){
  await syncNow('before-pay');
  if(!currentOrder) return toast('This bill was closed on another device.', true);
  return __v38BaseOpenPayModal();
};
const __v38BaseSaveOrder = saveOrder;
saveOrder = async function(hold=false){
  clearTimeout(__cartSaveTimer);
  __localDirtyOrder = false;
  const result = await __v38BaseSaveOrder(hold);
  await syncNow('after-save');
  return result;
};
const __v38BaseRenderShell = renderShell;
renderShell = function(){
  __v38BaseRenderShell();
  startLiveSync();
};


/* ============================================================
   SwiftTill V39 Discount + Cash Calculation Guards
   - switching Rs/% resets value so old Rs amount cannot remain as %
   - fixed discount cannot exceed current bill amount
   - percent discount cannot exceed 100%
   - payment uses freshly sanitized totals
   - button text stays visible on compact screens
============================================================ */
function discountBaseClient(order){
  const subtotal=(order?.lines||[]).reduce((sum,line)=>sum+((Number(line.price)||0)+(line.modifiers||[]).reduce((a,m)=>a+Number(m.price||0),0))*Number(line.qty||0),0);
  return Math.max(0, Math.round((subtotal + Number(order?.deliveryFee||0))*100)/100);
}
function sanitizeDiscountClient(order, showToast=false){
  if(!order) return {changed:false, base:0, max:0};
  const base = discountBaseClient(order);
  let type = ['FIXED','PERCENT','NONE'].includes(order.discountType) ? order.discountType : 'NONE';
  let val = Math.max(0, Number(order.discountValue||0));
  let changed = false;
  if(type === 'NONE' || val <= 0 || base <= 0){
    if(order.discountType !== 'NONE' || Number(order.discountValue||0)!==0) changed = true;
    order.discountType = 'NONE'; order.discountValue = 0;
    return {changed, base, max:0};
  }
  const max = type === 'PERCENT' ? 100 : base;
  if(val > max){
    val = max; changed = true;
    if(showToast) toast(type === 'PERCENT' ? 'Percent discount cannot exceed 100%.' : `Discount cannot exceed bill amount ${money(base)}.`, true);
  }
  order.discountType = type;
  order.discountValue = Math.round(val*100)/100;
  return {changed, base, max};
}
calcTotals = function(o){
  if(o) sanitizeDiscountClient(o, false);
  const subtotal=(o?.lines||[]).reduce((s,l)=>s+((Number(l.price)||0)+(l.modifiers||[]).reduce((a,m)=>a+Number(m.price||0),0))*Number(l.qty||0),0);
  const deliveryFee=Number(o?.deliveryFee||0);
  const base = Math.max(0, subtotal + deliveryFee);
  let discount=0;
  if(o?.discountType==='PERCENT') discount=base*Math.max(0,Math.min(100,Number(o.discountValue||0)))/100;
  if(o?.discountType==='FIXED') discount=Number(o.discountValue||0);
  discount=Math.round(Math.min(Math.max(discount,0),base)*100)/100;
  return {subtotal:Math.round(subtotal*100)/100,deliveryFee:Math.round(deliveryFee*100)/100,discount,total:Math.round(Math.max(0,base-discount)*100)/100};
};
function refreshBillFooterControls(){
  const helper = document.createElement('div');
  helper.className = 'discount-helper';
  const base = discountBaseClient(currentOrder);
  const type = currentOrder?.discountType || 'NONE';
  helper.textContent = type === 'PERCENT' ? 'Max 100%. Switching Rs/% resets discount.' : type === 'FIXED' ? `Max ${money(base)}. Switching Rs/% resets discount.` : 'Select Rs or % then enter discount.';
  const row = document.querySelector('.compact-discount');
  if(row && !row.querySelector('.discount-helper')) row.appendChild(helper);
  $$('[data-disc]').forEach(btn=>{
    btn.onclick = ()=>{
      const next = currentOrder.discountType === btn.dataset.disc ? 'NONE' : btn.dataset.disc;
      currentOrder.discountType = next;
      currentOrder.discountValue = 0;
      renderBill();
      setTimeout(markCartDirty,0);
    };
  });
  const disc = $('#discountVal');
  if(disc){
    disc.setAttribute('type','number');
    disc.setAttribute('min','0');
    disc.setAttribute('inputmode','decimal');
    disc.setAttribute('aria-label','Discount value');
    disc.oninput = e=>{
      if(!currentOrder) return;
      let v=Math.max(0,Number(e.target.value||0));
      if(v>0 && currentOrder.discountType==='NONE') currentOrder.discountType='FIXED';
      currentOrder.discountValue=v;
      const res=sanitizeDiscountClient(currentOrder,true);
      if(res.changed) e.target.value=currentOrder.discountValue;
      const t=calcTotals(currentOrder);
      const totalEl=$('.compact-total b,.total-row.big b'); if(totalEl) totalEl.textContent=money(t.total);
      const subtotalEl=$('.total-row.compact-row b'); if(subtotalEl) subtotalEl.textContent=money(t.subtotal);
      setTimeout(markCartDirty,0);
    };
    disc.onchange = e=>{ sanitizeDiscountClient(currentOrder,true); renderBill(); setTimeout(markCartDirty,0); };
  }
}
const __v39BaseRenderBill = renderBill;
renderBill = function(){
  if(currentOrder) sanitizeDiscountClient(currentOrder,false);
  __v39BaseRenderBill();
  refreshBillFooterControls();
};
const __v39BaseSaveOrder = saveOrder;
saveOrder = async function(hold=false){
  if(currentOrder) sanitizeDiscountClient(currentOrder,true);
  return __v39BaseSaveOrder(hold);
};
const __v39BaseOpenPayModal = openPayModal;
openPayModal = async function(){
  if(!currentOrder) return;
  sanitizeDiscountClient(currentOrder,true);
  const t=calcTotals(currentOrder);
  if(t.total<=0) return toast('Total payable is Rs 0. Check prices/discount before payment.', true);
  await syncNow('before-pay');
  if(!currentOrder) return toast('This bill was closed on another device.', true);
  sanitizeDiscountClient(currentOrder,true);
  return __v39BaseOpenPayModal();
};




/* ============================================================
   SwiftTill V41 Single Counter Offline Mode + Manual Sync Center
   Safety model:
   - offline use is allowed only on one registered desktop/counter device
   - every local change is written immediately to two local WAL copies
   - paid/offline orders stay pending until the server confirms upload
   - automatic sync runs when internet returns; manual Sync Now is available
   - cash-only offline payment guard keeps reports/cash drawer safe
============================================================ */
const V41_OFFLINE = {
  deviceKey: 'swifttill_offline_device_id_v41',
  enabledKey: 'swifttill_offline_registered_counter_v41',
  cacheKey: 'swifttill_offline_state_cache_v41',
  ordersKey: 'swifttill_offline_orders_v41',
  backupOrdersKey: 'swifttill_offline_orders_backup_v41',
  walKey: 'swifttill_offline_wal_v41',
  metaKey: 'swifttill_offline_meta_v41',
  lastBackupAt: 0,
  syncTimer: null,
  syncing: false,
  progress: { active:false, done:0, total:0, message:'' }
};
function safeJsonParseV41(text, fallback){ try{return text?JSON.parse(text):fallback;}catch{return fallback;} }
function offlineDeviceId(){
  let id = localStorage.getItem(V41_OFFLINE.deviceKey);
  if(!id){ id = 'counter-' + Date.now().toString(36) + '-' + Math.random().toString(16).slice(2,8); localStorage.setItem(V41_OFFLINE.deviceKey, id); }
  return id;
}
function isTouchMobileDeviceV41(){ return /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) || isMobileViewport(); }
function isRegisteredCounterV41(){ return localStorage.getItem(V41_OFFLINE.enabledKey)==='1' && !isTouchMobileDeviceV41(); }
function ensureCounterRegisteredV41(){ if(!isTouchMobileDeviceV41() && localStorage.getItem(V41_OFFLINE.enabledKey)!=='1') localStorage.setItem(V41_OFFLINE.enabledKey,'1'); return isRegisteredCounterV41(); }
function localOrdersV41(){
  const main = safeJsonParseV41(localStorage.getItem(V41_OFFLINE.ordersKey), null);
  if(main && typeof main==='object') return main;
  const bak = safeJsonParseV41(localStorage.getItem(V41_OFFLINE.backupOrdersKey), {});
  return bak && typeof bak==='object' ? bak : {};
}
function saveLocalOrdersV41(orders, reason='save'){
  const stamp = new Date().toISOString();
  const payload = JSON.stringify(orders || {});
  const wal = { at: stamp, reason, deviceId: offlineDeviceId(), orderCount: Object.keys(orders||{}).length, checksum: String(payload.length)+':'+String([...payload].reduce((a,c)=>(a+c.charCodeAt(0))%1000000007,0)) };
  try{
    localStorage.setItem(V41_OFFLINE.walKey, JSON.stringify(wal));
    localStorage.setItem(V41_OFFLINE.backupOrdersKey, payload);
    localStorage.setItem(V41_OFFLINE.ordersKey, payload);
    localStorage.setItem(V41_OFFLINE.metaKey, JSON.stringify({ ...wal, lastPersistOk:true }));
    scheduleAgentBackupV41(orders, reason);
  }catch(e){
    console.error('SwiftTill local offline save failed:', e.message);
    toast('Local offline save failed. Stop billing and export backup.', true);
  }
}
function saveStateCacheV41(data){
  if(!data || !data.settings) return;
  try{ localStorage.setItem(V41_OFFLINE.cacheKey, JSON.stringify({ cachedAt:new Date().toISOString(), deviceId:offlineDeviceId(), data })); }catch{}
}
function cachedStateV41(){
  const c=safeJsonParseV41(localStorage.getItem(V41_OFFLINE.cacheKey), null);
  return c?.data || null;
}
function offlineRefV41(){
  const d=new Date(); const y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  const key='swifttill_offline_seq_'+y+m+day;
  const n=Number(localStorage.getItem(key)||0)+1; localStorage.setItem(key,String(n));
  return `OFF-${y}${m}${day}-${String(n).padStart(4,'0')}`;
}
function hasPendingOfflineV41(){ return Object.values(localOrdersV41()).some(o=>!o.serverConfirmedAt && hasOrderLines(o)); }
function pendingOfflineOrdersV41(){ return Object.values(localOrdersV41()).filter(o=>!o.serverConfirmedAt && hasOrderLines(o)).sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt)); }
function offlineStatusTextV41(){
  if(isTouchMobileDeviceV41() && !navigator.onLine) return 'Offline blocked on this device';
  if(!navigator.onLine && isRegisteredCounterV41()) return 'Offline Counter Mode';
  if(hasPendingOfflineV41()) return `${pendingOfflineOrdersV41().length} pending sync`;
  return navigator.onLine ? 'Online / Synced' : 'Offline unavailable';
}
function mergeOfflineStateV41(base){
  const data = clone(base || cachedStateV41() || {});
  if(!data.settings) return data;
  const orders = Object.values(localOrdersV41()).filter(o=>!o.serverConfirmedAt && hasOrderLines(o));
  data.openOrders = Array.isArray(data.openOrders) ? data.openOrders.filter(o=>!orders.some(x=>x.id===o.id || x.clientOrderId===o.id)) : [];
  data.paidOrders = Array.isArray(data.paidOrders) ? data.paidOrders : [];
  for(const o of orders){
    if(o.status==='PAID') data.paidOrders.unshift(o);
    else data.openOrders.push(o);
  }
  data.openOrders.sort((a,b)=>new Date(a.createdAt)-new Date(b.createdAt));
  if(Array.isArray(data.tables)){
    data.tables = data.tables.map(t=>{
      const local = orders.find(o=>o.status!=='PAID' && o.type==='DINE_IN' && o.tableId===t.id && hasOrderLines(o));
      return local ? { ...t, busy:true, orderId:local.id, occupiedAt:local.tableOccupiedAt||local.createdAt, guests:local.guests||0, offline:true } : t;
    });
  }
  data.offlineLocal = {
    enabled:isRegisteredCounterV41(),
    deviceId:offlineDeviceId(),
    pending:pendingOfflineOrdersV41().length,
    totalLocal:orders.length,
    online:navigator.onLine,
    lastMeta:safeJsonParseV41(localStorage.getItem(V41_OFFLINE.metaKey), {})
  };
  return data;
}
function makeLocalOrderV41(data){
  const id='off_'+offlineDeviceId().replace(/[^a-z0-9_-]/gi,'')+'_'+Date.now().toString(36)+'_'+Math.random().toString(16).slice(2,7);
  const taker=state?.orderTakers?.find(t=>t.id===data.orderTakerId);
  const ref=offlineRefV41();
  const createdAt=new Date().toISOString();
  return { id, localId:id, clientOrderId:id, offlineRef:ref, number:ref, type:data.type, status:'DRAFT', tableId:data.type==='DINE_IN'?data.tableId:null, guests:data.type==='DINE_IN'?Number(data.guests||1):0, orderTakerId:data.orderTakerId||null, orderTakerName:taker?.name||'', customerName:data.customerName||'', mobile:data.mobile||'', address:data.address||'', deliveryNotes:data.deliveryNotes||'', deliveryFee:data.type==='DELIVERY'?Number(data.deliveryFee||state?.settings?.defaultDeliveryFee||0):0, lines:[], discountType:'NONE', discountValue:0, createdAt, updatedAt:createdAt, tableOccupiedAt:null, cashierId:state?.user?.id||'', cashierName:state?.user?.name||'Offline Counter', offline:true, syncStatus:'PENDING', timeline:[{event:'OFFLINE_CREATED',at:createdAt,by:state?.user?.name||'Offline Counter'}] };
}
function upsertLocalOrderV41(order, reason='order-update'){
  if(!order?.id) return order;
  const orders=localOrdersV41();
  const next=clone(order);
  next.offline=true; next.syncStatus='PENDING'; next.updatedAt=new Date().toISOString();
  if(hasOrderLines(next) && next.type==='DINE_IN' && !next.tableOccupiedAt) next.tableOccupiedAt=next.createdAt||new Date().toISOString();
  orders[next.id]=next;
  saveLocalOrdersV41(orders, reason);
  const base=state || cachedStateV41();
  if(base) state=mergeOfflineStateV41(base);
  updateOfflineDockV41();
  return next;
}
function localReceiptV41(order){
  const table=state?.tables?.find(t=>t.id===order.tableId)?.name||'';
  return { business:state?.settings?.businessName||'SwiftTill POS', branchName:state?.settings?.branchName||'', phone:state?.settings?.phone||'', address:state?.settings?.address||'', logoUrl:state?.settings?.logoUrl||'', header:'OFFLINE BILL - PENDING SYNC', footer:'Offline sale saved locally. Sync to cloud when internet is available.', receiptWidth:state?.settings?.receiptWidth||'80mm', showLogoOnReceipt:state?.settings?.showLogoOnReceipt, showCustomerOnReceipt:state?.settings?.showCustomerOnReceipt, showOrderTakerOnReceipt:state?.settings?.showOrderTakerOnReceipt, showCashierOnReceipt:state?.settings?.showCashierOnReceipt, showPaymentBreakdown:state?.settings?.showPaymentBreakdown, number:order.number||order.offlineRef, offlineRef:order.offlineRef, date:order.paidAt||new Date().toISOString(), cashier:order.cashierName, type:order.type, table, guests:order.guests, orderTaker:order.orderTakerName, customer:order.customerName, mobile:order.mobile, addressLine:order.address, lines:order.lines, totals:calcTotals(order), payments:order.payments||[], offline:true };
}
function localPayGuardV41(order){
  const payments=Array.isArray(order.payments)?order.payments:[];
  if(payments.some(p=>p.method && p.method!=='Cash')) throw new Error('Offline payment mein sirf Cash allowed hai. Card/Online ke liye internet required hai.');
}
function localReportDataV41(path){
  const params=new URLSearchParams(String(path).split('?')[1]||'');
  const from=params.get('from')||'', to=params.get('to')||'';
  const inRange=(iso)=>{ const t=new Date(iso||0).getTime(); const a=from?new Date(from+'T00:00:00').getTime():0; const b=to?new Date(to+'T23:59:59').getTime():Date.now()+86400000; return t>=a&&t<=b; };
  const paid=[...(state?.paidOrders||[]), ...Object.values(localOrdersV41()).filter(o=>o.status==='PAID'&&!o.serverConfirmedAt)].filter(o=>inRange(o.paidAt||o.createdAt));
  const rows=paid.map(o=>{ const t=calcTotals(o); return { id:o.id, number:o.number||o.offlineRef, date:o.paidAt||o.createdAt, type:o.type, table:state?.tables?.find(x=>x.id===o.tableId)?.name||'', guests:o.guests||0, customer:o.customerName||'', mobile:o.mobile||'', orderTaker:o.orderTakerName||'', cashier:o.cashierName||'', subtotal:t.subtotal, discount:t.discount, deliveryFee:t.deliveryFee, total:t.total, payments:(o.payments||[]).map(p=>p.method).join(', '), lines:o.lines||[], discountType:o.discountType, discountValue:o.discountValue, offline:!o.serverConfirmedAt }; });
  const summary={orders:rows.length,gross:0,discounts:0,refunds:0,net:0,averageBill:0};
  const paymentWise={}, orderTypeWise={}, itemMap={}, catMap={};
  for(const o of paid){ const t=calcTotals(o); summary.gross+=t.subtotal+t.deliveryFee; summary.discounts+=t.discount; summary.net+=t.total; orderTypeWise[o.type]=(orderTypeWise[o.type]||0)+t.total; for(const p of (o.payments||[])) paymentWise[p.method]=(paymentWise[p.method]||0)+Number(p.amount||0); for(const l of (o.lines||[])){ const key=l.name||l.itemId||'Item'; if(!itemMap[key]) itemMap[key]={item:key,category:l.categoryName||l.categoryId||'Uncategorized',qty:0,sales:0,gross:0,discountShare:0,net:0}; const lineGross=((Number(l.price)||0)+(l.modifiers||[]).reduce((a,m)=>a+Number(m.price||0),0))*Number(l.qty||0); itemMap[key].qty+=Number(l.qty||0); itemMap[key].sales+=lineGross; itemMap[key].gross+=lineGross; itemMap[key].net+=lineGross; const cat=itemMap[key].category; catMap[cat]=(catMap[cat]||0)+lineGross; } }
  summary.gross=Math.round(summary.gross*100)/100; summary.discounts=Math.round(summary.discounts*100)/100; summary.net=Math.round(summary.net*100)/100; summary.averageBill=summary.orders?Math.round((summary.net/summary.orders)*100)/100:0;
  const paymentDetails=Object.entries(paymentWise).map(([method,amount])=>({method,count:rows.filter(r=>String(r.payments).includes(method)).length,received:amount,change:0,revenue:amount}));
  const categoryDetails=Object.entries(catMap).map(([category,gross])=>({category,qty:0,gross,net:gross}));
  const orderTypeDetails=Object.entries(orderTypeWise).map(([type,net])=>({type,orders:rows.filter(r=>r.type===type).length,guests:rows.filter(r=>r.type===type).reduce((s,r)=>s+Number(r.guests||0),0),gross:net,discount:0,net,averageBill:net/(rows.filter(r=>r.type===type).length||1)}));
  return { ok:true, data:{ filters:{from,to}, offline:true, warning:'Offline/local report includes unsynced counter data. Final cloud report updates after Sync Now.', summary, paymentWise, orderTypeWise, itemWise:Object.values(itemMap), categoryWise:catMap, categoryDetails, paymentDetails, orderTypeDetails, discountWise:{count:rows.filter(r=>r.discount>0).length,amount:rows.reduce((s,r)=>s+r.discount,0),rows:rows.filter(r=>r.discount>0)}, refunds:[], voidOrders:[], shiftSummary:{shiftNumber:state?.activeShift?.number||'',shiftStatus:state?.activeShift?.status||'',openingCash:state?.activeShift?.openingCash||0,cashSales:paymentWise.Cash||0,cashRefunds:0,expectedCash:(state?.activeShift?.openingCash||0)+(paymentWise.Cash||0)}, orders:rows } };
}
function canHandleOfflineApiV41(path, method){
  if(method==='GET' && (path==='/api/state' || path.startsWith('/api/reports'))) return true;
  if(method==='POST' && ['/api/orders/create','/api/orders/save','/api/orders/pay','/api/orders/cart-sync'].includes(path)) return true;
  return false;
}
async function offlineApiV41(path, data, method='POST'){
  if(!isRegisteredCounterV41()) throw new Error('Offline mode is only allowed on the registered counter PC. Mobile/second device needs internet.');
  if(method==='GET' && path==='/api/state'){
    const cached=cachedStateV41();
    if(!cached) throw new Error('No offline cache found. Open POS once with internet on this counter PC.');
    return { ok:true, data:mergeOfflineStateV41(cached) };
  }
  if(method==='GET' && path.startsWith('/api/reports')) return localReportDataV41(path);
  if(path==='/api/orders/create'){
    if(data.type==='DINE_IN' && !data.tableId) throw new Error('Select table for Dine In order');
    const busy = Object.values(localOrdersV41()).find(o=>!o.serverConfirmedAt && o.status!=='PAID' && o.type==='DINE_IN' && o.tableId===data.tableId && hasOrderLines(o));
    if(data.type==='DINE_IN' && busy) throw new Error('This table already has an active offline order on this counter PC.');
    const order=makeLocalOrderV41(data); upsertLocalOrderV41(order,'offline-create'); return { ok:true, order };
  }
  if(path==='/api/orders/save' || path==='/api/orders/cart-sync'){
    const order={...data};
    order.status = data.hold ? 'HELD' : (hasOrderLines(order) ? 'OPEN' : 'DRAFT');
    if(order.status==='HELD') order.heldAt=new Date().toISOString();
    const saved=upsertLocalOrderV41(order, data.hold?'offline-hold':'offline-cart-save');
    return { ok:true, order:saved, totals:calcTotals(saved), sync:{revision:Date.now(), updatedAt:new Date().toISOString(), reason:'offline-local'} };
  }
  if(path==='/api/orders/pay'){
    const order={...data, status:'PAID', paidAt:new Date().toISOString(), tableReleasedAt:new Date().toISOString()};
    localPayGuardV41(order);
    const t=calcTotals(order); if(t.total<=0) throw new Error('Order total must be greater than Rs 0.');
    order.payments=(order.payments||[]).map(p=>({...p, amount:Number(p.amount||0), received:Number(p.received??p.amount??0), change:Number(p.change||0)}));
    const saved=upsertLocalOrderV41(order,'offline-paid');
    return { ok:true, order:saved, totals:t, receipt:localReceiptV41(saved), offline:true };
  }
  throw new Error('This action requires internet.');
}
const __v41BaseApi = api;
api = async function(path, data, method='POST'){
  const cleanPath=String(path).split('?')[0];
  if(!navigator.onLine && canHandleOfflineApiV41(cleanPath, method)) return offlineApiV41(path, data||{}, method);
  try{
    const out = await __v41BaseApi(path, data, method);
    if(method==='GET' && cleanPath==='/api/state' && out?.data){ ensureCounterRegisteredV41(); saveStateCacheV41(out.data); out.data=mergeOfflineStateV41(out.data); }
    return out;
  }catch(e){
    const networkish = /Failed to fetch|NetworkError|Load failed|Internet connection required|fetch/i.test(e.message||'');
    if(networkish && canHandleOfflineApiV41(cleanPath, method)) return offlineApiV41(path, data||{}, method);
    throw e;
  }
};
const __v41BaseLoadState = loadState;
loadState = async function(){ const j=await api('/api/state', null, 'GET'); state=j.data; saveStateCacheV41(state); };
loadStateQuiet = async function(){ const j=await apiQuiet('/api/state', null, 'GET'); if(j?.data){ state=mergeOfflineStateV41(j.data); saveStateCacheV41(state); } };
boot = async function(){
  if(!token) return renderLogin();
  try{ await loadState(); renderShell(); startOfflineAutoSyncV41(); }
  catch(e){
    const cached=cachedStateV41();
    if(cached && isRegisteredCounterV41()){ state=mergeOfflineStateV41(cached); renderShell(); startOfflineAutoSyncV41(); toast('Offline Counter Mode: local data safe; sync when internet returns.', true); }
    else { renderOfflineSetupBlockedV41(e.message); }
  }
};
function renderOfflineSetupBlockedV41(msg){
  app.innerHTML=`<div class="login-screen"><div class="login-card"><div class="login-brand-text"><b>SwiftTill</b><span>POS</span></div><h1>Offline setup required</h1><p>${esc(msg||'Open this counter PC once with internet to cache POS data.')}</p><p class="muted-note">Mobile/second devices are online-only. Offline mode works only on registered counter PC.</p><button class="primary-btn" onclick="location.reload()" style="width:100%">Retry</button></div></div>`;
}
function updateOfflineDockV41(){
  const el=document.getElementById('offlineDockV41'); if(!el) return;
  const pending=pendingOfflineOrdersV41().length;
  const meta=safeJsonParseV41(localStorage.getItem(V41_OFFLINE.metaKey),{});
  const pct=V41_OFFLINE.progress.total?Math.round((V41_OFFLINE.progress.done/V41_OFFLINE.progress.total)*100):0;
  el.className='offline-dock-v41 '+(!navigator.onLine?'offline':pending?'pending':'ok');
  el.innerHTML=`<div><b>${esc(offlineStatusTextV41())}</b><span>${pending?`${pending} bill(s) pending cloud upload`:'Local queue clear'}${meta.at?` • Saved ${new Date(meta.at).toLocaleTimeString()}`:''}</span></div>${V41_OFFLINE.progress.active?`<div class="offline-progress"><i style="width:${pct}%"></i><em>${pct}%</em></div>`:''}<button type="button" id="dockSyncNowV41" ${(!navigator.onLine||!pending||V41_OFFLINE.syncing)?'disabled':''}>Sync Now</button>`;
  const b=document.getElementById('dockSyncNowV41'); if(b) b.onclick=()=>syncOfflineNowV41(true);
}
function ensureOfflineDockV41(){
  if(!document.getElementById('offlineDockV41')){ const el=document.createElement('div'); el.id='offlineDockV41'; document.body.appendChild(el); }
  updateOfflineDockV41();
}
const __v41BaseRenderShell = renderShell;
renderShell = function(){ __v41BaseRenderShell(); ensureOfflineDockV41(); };
const __v41BaseRenderAdminShell = renderAdminShell;
renderAdminShell = function(){ __v41BaseRenderAdminShell(); ensureOfflineDockV41(); };
const __v41BaseRenderTopbar = renderTopbar;
renderTopbar = function(){
  const html=__v41BaseRenderTopbar();
  const cls = !navigator.onLine ? 'offline' : hasPendingOfflineV41() ? 'pending' : 'ok';
  return html.replace('<div class="top-items">', `<div class="top-items"><div class="top-pill sync-pill ${cls}"><span class="status-dot"></span><span><b>${esc(offlineStatusTextV41())}</b>${pendingOfflineOrdersV41().length?`${pendingOfflineOrdersV41().length} pending`: 'Ready'}</span></div>`);
};
const __v41BaseLabelTab = labelTab;
labelTab = function(t){ return t==='sync' ? 'Sync Center' : __v41BaseLabelTab(t); };
const __v41BaseTabIcon = tabIcon;
tabIcon = function(t){ return t==='sync' ? '⇅' : __v41BaseTabIcon(t); };
const __v41BaseRenderAdmin = renderAdmin;
renderAdmin = function(ws){
  __v41BaseRenderAdmin(ws);
  const nav=document.querySelector('.admin-nav');
  if(nav && !nav.querySelector('[data-admin-tab="sync"]')){
    const wrap=document.createElement('div'); wrap.className='admin-nav-slot '+(adminTab==='sync'?'active-slot':'');
    wrap.innerHTML=`<button class="${adminTab==='sync'?'active':''}" data-admin-tab="sync"><span class="admin-nav-icon">⇅</span><span>Sync Center</span></button>`;
    nav.insertBefore(wrap, nav.children[2] || null);
    wrap.querySelector('button').onclick=()=>{adminTab='sync';renderAdmin(ws);};
  }
  if(adminTab==='sync') renderSyncCenterV41(document.getElementById('adminContent'));
};
const __v41BaseRenderAdminContent = renderAdminContent;
renderAdminContent = function(){
  const c=document.getElementById('adminContent');
  if(adminTab==='sync') return renderSyncCenterV41(c);
  return __v41BaseRenderAdminContent();
};
function renderSyncCenterV41(c){
  if(!c) return;
  const rows=pendingOfflineOrdersV41();
  const meta=safeJsonParseV41(localStorage.getItem(V41_OFFLINE.metaKey),{});
  const pct=V41_OFFLINE.progress.total?Math.round((V41_OFFLINE.progress.done/V41_OFFLINE.progress.total)*100):0;
  c.innerHTML=`<div class="module-title"><div><h3>Sync Center</h3><p class="muted-note">Single counter offline queue. Data clears only after cloud server confirms upload.</p></div><div class="actions-mini"><button class="primary-btn" id="syncNowV41" ${(!navigator.onLine||!rows.length||V41_OFFLINE.syncing)?'disabled':''}>Sync Now</button><button class="ghost-btn" id="exportOfflineV41">Export Emergency Backup</button></div></div>
    <div class="sync-status-grid"><div class="card metric"><p>Internet</p><h3>${navigator.onLine?'Online':'Offline'}</h3></div><div class="card metric"><p>Pending Upload</p><h3>${rows.length}</h3></div><div class="card metric"><p>Device</p><h3>${isRegisteredCounterV41()?'Counter PC':'Blocked'}</h3></div><div class="card metric"><p>Last Local Save</p><h3>${meta.at?new Date(meta.at).toLocaleTimeString():'—'}</h3></div></div>
    <div class="card subcard sync-card"><h3>Upload Progress</h3><div class="sync-progress-bar"><i style="width:${pct}%"></i></div><p>${esc(V41_OFFLINE.progress.message || (rows.length?'Ready to upload pending bills.':'No pending offline data.'))}</p><p class="muted-note">Cash sales, discounts, totals and lines are synced as final bill snapshots. If internet stays off for weeks, queue remains on this registered counter PC.</p></div>
    <div class="card subcard"><h3>Pending Bills</h3><div class="report-table-wrap"><table class="admin-table"><thead><tr><th>Offline Ref</th><th>Status</th><th>Type</th><th>Items</th><th>Total</th><th>Saved</th></tr></thead><tbody>${rows.length?rows.map(o=>`<tr><td>${esc(o.offlineRef||o.number)}</td><td>${esc(o.status)}</td><td>${esc(formatType(o.type))}</td><td>${(o.lines||[]).reduce((s,l)=>s+Number(l.qty||0),0)}</td><td>${money(calcTotals(o).total)}</td><td>${new Date(o.updatedAt||o.createdAt).toLocaleString()}</td></tr>`).join(''):'<tr><td colspan="6">No pending offline bills.</td></tr>'}</tbody></table></div></div>
    <div class="card subcard"><h3>Safety Rules</h3><p>✓ Mobile/second device offline billing blocked</p><p>✓ Cash-only offline payment</p><p>✓ Local WAL + backup copy written before screen update</p><p>✓ Manual Sync keeps failed/conflict bills pending</p><p>✓ Reports show offline warning until final cloud sync</p></div>`;
  $('#syncNowV41') && ($('#syncNowV41').onclick=()=>syncOfflineNowV41(true));
  $('#exportOfflineV41') && ($('#exportOfflineV41').onclick=exportOfflineBackupV41);
}
function exportOfflineBackupV41(){
  const payload={app:'SwiftTill POS',version:'44.0.0-offline-auth-operational-safety',exportedAt:new Date().toISOString(),deviceId:offlineDeviceId(),state:cachedStateV41(),orders:localOrdersV41(),meta:safeJsonParseV41(localStorage.getItem(V41_OFFLINE.metaKey),{})};
  const blob=new Blob([JSON.stringify(payload,null,2)],{type:'application/json'});
  const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=`swifttill-offline-backup-${Date.now()}.json`; a.click(); URL.revokeObjectURL(a.href);
}
async function syncOfflineNowV41(manual=false){
  if(V41_OFFLINE.syncing) return;
  const rows=pendingOfflineOrdersV41();
  if(!rows.length){ updateOfflineDockV41(); if(manual) toast('No pending offline data.'); return; }
  if(!navigator.onLine){ if(manual) toast('Internet required for Sync Now.', true); return; }
  V41_OFFLINE.syncing=true; V41_OFFLINE.progress={active:true,done:0,total:rows.length,message:'Preparing upload...'}; updateOfflineDockV41(); if(adminTab==='sync') renderAdminContent();
  try{
    const batchId='batch-'+Date.now().toString(36)+'-'+Math.random().toString(16).slice(2,8);
    V41_OFFLINE.progress.message='Uploading bills to cloud...'; updateOfflineDockV41(); if(adminTab==='sync') renderAdminContent();
    const out=await __v41BaseApi('/api/offline/sync',{deviceId:offlineDeviceId(),batchId,orders:rows},'POST');
    const orders=localOrdersV41();
    let synced=0, conflicts=0, failed=0;
    for(const r of (out.results||[])){
      V41_OFFLINE.progress.done += 1;
      if(['synced','already-synced','skipped-empty'].includes(r.status)){
        if(orders[r.localId]){ orders[r.localId].serverConfirmedAt=new Date().toISOString(); orders[r.localId].serverId=r.serverId||orders[r.localId].serverId; orders[r.localId].serverNumber=r.number||orders[r.localId].serverNumber; orders[r.localId].syncStatus='SYNCED'; }
        synced += 1;
      } else if(r.status==='conflict') { if(orders[r.localId]) orders[r.localId].syncStatus='CONFLICT'; conflicts += 1; }
      else { if(orders[r.localId]) orders[r.localId].syncStatus='FAILED'; failed += 1; }
      V41_OFFLINE.progress.message=`Uploaded ${V41_OFFLINE.progress.done}/${V41_OFFLINE.progress.total}`; updateOfflineDockV41();
    }
    saveLocalOrdersV41(orders,'offline-sync-result');
    await loadState().catch(()=>null);
    V41_OFFLINE.progress.message = conflicts||failed ? `Sync completed with ${conflicts} conflict(s), ${failed} failed.` : `Sync completed. ${synced} bill(s) confirmed.`;
    toast(V41_OFFLINE.progress.message, conflicts||failed);
  }catch(e){ V41_OFFLINE.progress.message='Sync failed: '+(e.message||'network error'); toast(V41_OFFLINE.progress.message,true); }
  finally{
    V41_OFFLINE.syncing=false;
    setTimeout(()=>{ V41_OFFLINE.progress.active=false; updateOfflineDockV41(); if(adminTab==='sync') renderAdminContent(); },1200);
  }
}
function startOfflineAutoSyncV41(){
  ensureCounterRegisteredV41();
  if(V41_OFFLINE.syncTimer) return;
  V41_OFFLINE.syncTimer=setInterval(()=>{ if(navigator.onLine && hasPendingOfflineV41()) syncOfflineNowV41(false); updateOfflineDockV41(); },30000);
  window.addEventListener('online',()=>{ updateOfflineDockV41(); setTimeout(()=>syncOfflineNowV41(false),1500); });
  window.addEventListener('offline',()=>{ updateOfflineDockV41(); toast(isRegisteredCounterV41()?'Offline Counter Mode enabled. Local billing is being saved safely.':'Offline blocked on this device.', true); });
  setTimeout(()=>{ if(navigator.onLine && hasPendingOfflineV41()) syncOfflineNowV41(false); updateOfflineDockV41(); },1800);
}
const __v41BaseMarkCartDirty = markCartDirty;
markCartDirty = function(){
  if(currentOrder && (!navigator.onLine || currentOrder.offline || String(currentOrder.id||'').startsWith('off_'))) upsertLocalOrderV41(currentOrder,'offline-cart-change');
  return __v41BaseMarkCartDirty();
};
const __v41BasePrintReceipt = printReceipt;
printReceipt = async function(r){
  if(r?.offline) r.header = r.header || 'OFFLINE BILL - PENDING SYNC';
  return __v41BasePrintReceipt(r);
};
async function scheduleAgentBackupV41(orders, reason){
  const nowMs=Date.now();
  if(nowMs - V41_OFFLINE.lastBackupAt < 5000) return;
  V41_OFFLINE.lastBackupAt = nowMs;
  const url=(state?.settings?.localAgentUrl||'http://127.0.0.1:9721/print').replace('/print','/offline-backup');
  try{ await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason,deviceId:offlineDeviceId(),at:new Date().toISOString(),orders})}); }catch{}
}
if('serviceWorker' in navigator){ navigator.serviceWorker.register('/sw.js').catch(()=>{}); }
setInterval(updateOfflineDockV41, 5000);



/* ============================================================
   SwiftTill V42 Professional Offline Payments + Full Reports
   Card/Online are complete captured payment records, not simple selections.
============================================================ */
const V42_PAYMENT_VERSION = '44.0.0-offline-auth-operational-safety';
function isOfflineRuntimeV42(){ return !navigator.onLine || Boolean(currentOrder?.offline) || String(currentOrder?.id||'').startsWith('off_'); }
function paymentRefRequiredV42(method, amount){ return false; /* V43: selection is enough; reference optional */ }
function paymentMetaV42(base={}){
  const method = base.method || '';
  const ref = String(base.reference || base.ref || base.transactionId || '').trim();
  const provider = String(base.provider || '').trim();
  const approvalCode = String(base.approvalCode || '').trim();
  const terminal = String(base.terminal || '').trim();
  const cardLast4 = String(base.cardLast4 || '').replace(/[^0-9]/g,'').slice(-4);
  const offline = isOfflineRuntimeV42();
  return { reference: ref, provider, approvalCode, terminal, cardLast4, capturedAt: new Date().toISOString(), verificationStatus: method==='Cash' ? 'VERIFIED' : (offline ? 'PENDING_SYNC' : 'VERIFIED'), settlementStatus: method==='Cash' ? 'SETTLED' : (offline ? 'PENDING_RECONCILIATION' : 'CAPTURED'), offlineCaptured: offline && method!=='Cash' };
}
function validateLocalPaymentRefV42(method, amount, ref, label){
  return true; // V43: reference/slip/transaction number is optional, not blocking
}
function buildPaymentBadgeV42(){
  const offline=isOfflineRuntimeV42();
  return `<div class="pay-system-note ${offline?'offline':''}"><b>${offline?'Offline Payment Capture':'Online Payment Capture'}</b><span>${offline?'Cash, card and online entries are saved locally with reference numbers and sync as final payment snapshots.':'Card/Online require terminal/app reference, then reports record method, reference, received, change and revenue.'}</span></div>`;
}
openPayModal = async function(){
  if(!currentOrder || !currentOrder.lines?.length) return toast('Add items before payment',true);
  if(currentOrder) sanitizeDiscountClient(currentOrder,true);
  const t = calcTotals(currentOrder);
  if(t.total<=0) return toast('Total payable is Rs 0. Check prices/discount before payment.', true);
  if(currentOrder.type==='DINE_IN' && !currentOrder.tableId) return toast('Select table before payment', true);
  if(navigator.onLine) await syncNow('before-pay');
  const offline = isOfflineRuntimeV42();
  openModal(`<div class="modal-head"><h2>Payment</h2><button class="x" onclick="closeModal()">×</button></div>${buildPaymentBadgeV42()}<div class="pay-total-card"><span>Total payable</span><b>${money(t.total)}</b></div><div class="seg pay-seg"><button class="active" data-paytab="cash">Cash</button><button data-paytab="card">Card</button><button data-paytab="online">Online</button></div><div id="payFields"></div><label class="check mt"><input id="payPrint" type="checkbox" ${getPrintDefault()?'checked':''}> Print receipt after payment</label><label class="check"><input id="splitPay" type="checkbox"> Split payment</label><button class="primary-btn mt full-width-btn" id="completePay">Complete Payment</button>`);
  let tab='cash';
  const exactNote = offline ? 'Offline Card/Online selection is saved locally. Reference/slip number is optional for audit only.' : 'Reference is optional; payment method, amount and cashier are still recorded in reports.';
  const amountBox=(prefix,label,value)=>`<div class="field"><label>${label}</label><input id="${prefix}Amount" type="number" value="${value}" min="0" step="0.01" inputmode="decimal"></div>`;
  const calcBox=(prefix,amount)=>`<div class="split-summary pay-calc"><div><span>Total</span><b>${money(t.total)}</b></div><div><span>Entered</span><b id="${prefix}Entered">${money(amount)}</b></div><div><span id="${prefix}BalanceLabel">Remaining</span><b id="${prefix}Balance">${money(Math.abs(amount-t.total))}</b></div></div>`;
  const updateSingleCalc=(prefix)=>{ const val=Number($('#'+prefix+'Amount')?.value||0); const diff=val-t.total; const bal=$('#'+prefix+'Balance'); if(!bal) return; $('#'+prefix+'Entered').textContent=money(val); $('#'+prefix+'BalanceLabel').textContent = diff<0 ? 'Remaining' : (prefix==='cash' ? 'Change' : 'Extra not allowed'); bal.textContent=money(Math.abs(diff)); bal.classList.toggle('danger-text', diff<0 || (diff>0 && prefix!=='cash')); bal.classList.toggle('ok-text', diff>=0 && (prefix==='cash' || diff===0)); };
  const draw=()=>{
    $$('[data-paytab]').forEach(b=>b.classList.toggle('active',b.dataset.paytab===tab));
    const split=$('#splitPay')?.checked; const f=$('#payFields');
    if(split){
      f.innerHTML=`<div class="split-summary"><div><span>Total</span><b>${money(t.total)}</b></div><div><span>Paid / Received</span><b id="splitPaid">${money(0)}</b></div><div><span id="splitBalanceLabel">Remaining</span><b id="splitRemaining">${money(t.total)}</b></div></div><div class="grid3 payment-auth-grid"><div class="field"><label>Cash Received</label><input id="cashAmt" class="split-amt" type="number" value="0" min="0" step="0.01"></div><div class="field"><label>Card Amount</label><input id="cardAmt" class="split-amt" type="number" value="0" min="0" step="0.01"></div><div class="field"><label>Online Amount</label><input id="onlineAmt" class="split-amt" type="number" value="0" min="0" step="0.01"></div></div><div class="grid2 payment-auth-grid"><div class="field"><label>Card Slip / Approval Ref</label><input id="splitCardRef" placeholder="Optional"></div><div class="field"><label>Online Provider</label><select id="splitOnlineProvider"><option value="">Select provider</option><option>Easypaisa</option><option>JazzCash</option><option>Bank Transfer</option><option>Raast</option><option>Other</option></select></div><div class="field"><label>Online Transaction Ref</label><input id="splitOnlineRef" placeholder="Optional"></div><div class="field"><label>Card Terminal</label><input id="splitCardTerminal" placeholder="POS terminal / bank name"></div></div><div class="quick-fill-row"><button type="button" class="ghost-btn" data-fill-remaining="cashAmt">Cash remaining</button><button type="button" class="ghost-btn" data-fill-remaining="cardAmt">Card remaining</button><button type="button" class="ghost-btn" data-fill-remaining="onlineAmt">Online remaining</button></div><p class="muted-note">${exactNote} Extra amount is accepted only through cash as change.</p>`;
      const update=()=>{ const cash=Number($('#cashAmt')?.value||0), card=Number($('#cardAmt')?.value||0), online=Number($('#onlineAmt')?.value||0); const paid=cash+card+online; const rem=t.total-paid; $('#splitPaid').textContent=money(paid); $('#splitBalanceLabel').textContent=rem<0?'Change / Extra':'Remaining'; $('#splitRemaining').textContent=money(Math.abs(rem)); $('#splitRemaining').classList.toggle('danger-text', rem>0 || (rem<0 && cash<Math.abs(rem))); $('#splitRemaining').classList.toggle('ok-text', rem<=0 && (rem>=0 || cash>=Math.abs(rem))); };
      $$('.split-amt').forEach(i=>i.addEventListener('input',update));
      $$('[data-fill-remaining]').forEach(btn=>btn.onclick=()=>{ const target=$('#'+btn.dataset.fillRemaining); const paidOther=['cashAmt','cardAmt','onlineAmt'].filter(id=>id!==btn.dataset.fillRemaining).reduce((s,id)=>s+Number($('#'+id)?.value||0),0); target.value=Math.max(0,t.total-paidOther); update(); });
      update(); return;
    }
    if(tab==='cash') f.innerHTML=`${amountBox('cash','Cash Received',Math.ceil(t.total/50)*50)}${calcBox('cash',Math.ceil(t.total/50)*50)}<p class="muted-note">Cash extra is returned as change. Change is not revenue.</p>`;
    if(tab==='card') f.innerHTML=`${amountBox('card','Card Approved Amount',t.total)}${calcBox('card',t.total)}<div class="grid2 payment-auth-grid"><div class="field"><label>Card Slip / Approval Ref <span class="optional-label">optional</span></label><input id="cardRef" placeholder="e.g. bank slip / approval code"></div><div class="field"><label>Terminal / Bank</label><input id="cardTerminal" placeholder="Optional terminal/bank"></div><div class="field"><label>Approval Code</label><input id="cardApproval" placeholder="Optional"></div><div class="field"><label>Card Last 4</label><input id="cardLast4" maxlength="4" inputmode="numeric" placeholder="Optional"></div></div><p class="muted-note">${exactNote}</p>`;
    if(tab==='online') f.innerHTML=`${amountBox('online','Online Approved Amount',t.total)}${calcBox('online',t.total)}<div class="grid2 payment-auth-grid"><div class="field"><label>Provider <span class="optional-label">optional</span></label><select id="onlineProvider"><option value="">Select provider</option><option>Easypaisa</option><option>JazzCash</option><option>Bank Transfer</option><option>Raast</option><option>Other</option></select></div><div class="field"><label>Transaction Ref <span class="optional-label">optional</span></label><input id="onlineRef" placeholder="Txn ID / transfer ref"></div></div><p class="muted-note">${exactNote}</p>`;
    ['cash','card','online'].forEach(prefix=>$('#'+prefix+'Amount')?.addEventListener('input',()=>updateSingleCalc(prefix)));
    updateSingleCalc(tab);
  };
  $$('[data-paytab]').forEach(b=>b.onclick=()=>{tab=b.dataset.paytab;draw();}); $('#splitPay').onchange=draw; draw();
  $('#completePay').onclick=async()=>{
    if(!requireOrderLines('Add at least one item before Payment')) return;
    sanitizeDiscountClient(currentOrder,true);
    const t2=calcTotals(currentOrder);
    try{
      const split=$('#splitPay').checked; let payments=[];
      if(split){
        const cash=Number($('#cashAmt').value||0), card=Number($('#cardAmt').value||0), online=Number($('#onlineAmt').value||0); const paid=cash+card+online; const remaining=t2.total-paid;
        if(remaining>0.009) throw new Error(`Remaining amount: ${money(remaining)}`);
        const extra=Math.max(0,paid-t2.total); if(extra>0.009 && cash<extra) throw new Error('Extra amount must be cash so change can be returned.');
        const cashRevenue=Math.max(0,cash-extra);
        if(card>0) validateLocalPaymentRefV42('Card',card,$('#splitCardRef').value,'Card');
        if(online>0) validateLocalPaymentRefV42('Online',online,$('#splitOnlineRef').value,'Online');
        payments=[
          cash>0?{method:'Cash',amount:cashRevenue,received:cash,change:extra}:null,
          card>0?{method:'Card',amount:card,received:card,reference:$('#splitCardRef').value,terminal:$('#splitCardTerminal').value,...paymentMetaV42({method:'Card',reference:$('#splitCardRef').value,terminal:$('#splitCardTerminal').value})}:null,
          online>0?{method:'Online',amount:online,received:online,reference:$('#splitOnlineRef').value,provider:$('#splitOnlineProvider').value,...paymentMetaV42({method:'Online',reference:$('#splitOnlineRef').value,provider:$('#splitOnlineProvider').value})}:null
        ].filter(Boolean);
      } else if(tab==='cash'){
        const rec=Number($('#cashAmount').value||0); if(rec<t2.total) throw new Error('Cash received is less than total'); payments=[{method:'Cash',amount:t2.total,received:rec,change:Math.max(0,rec-t2.total),...paymentMetaV42({method:'Cash'})}];
      } else if(tab==='card'){
        const entered=Number($('#cardAmount').value||0); if(entered<t2.total) throw new Error(`Remaining amount: ${money(t2.total-entered)}`); if(entered>t2.total) throw new Error('Card extra detected. Enter exact card amount.'); validateLocalPaymentRefV42('Card',entered,$('#cardRef').value,'Card'); payments=[{method:'Card',amount:t2.total,received:entered,reference:$('#cardRef').value,terminal:$('#cardTerminal').value,approvalCode:$('#cardApproval').value,cardLast4:$('#cardLast4').value,...paymentMetaV42({method:'Card',reference:$('#cardRef').value,terminal:$('#cardTerminal').value,approvalCode:$('#cardApproval').value,cardLast4:$('#cardLast4').value})}];
      } else {
        const entered=Number($('#onlineAmount').value||0); if(entered<t2.total) throw new Error(`Remaining amount: ${money(t2.total-entered)}`); if(entered>t2.total) throw new Error('Online extra detected. Enter exact online amount.'); validateLocalPaymentRefV42('Online',entered,$('#onlineRef').value,'Online'); payments=[{method:'Online',amount:t2.total,received:entered,reference:$('#onlineRef').value,provider:$('#onlineProvider').value,...paymentMetaV42({method:'Online',reference:$('#onlineRef').value,provider:$('#onlineProvider').value})}];
      }
      const j=await api('/api/orders/pay',{...currentOrder,payments}); lastReceipt=j.receipt; const doPrint=$('#payPrint').checked; localStorage.setItem('swifttill_print_default', doPrint?'1':'0'); currentOrder=null; screen='pos'; centerMode='menu'; await loadState().catch(()=>null); renderShell(); closeModal(); toast(offline?'Offline payment saved safely. Sync when internet is available.':'Payment completed'); showReceiptModal(lastReceipt, doPrint);
    }catch(e){toast(e.message,true);}
  };
};
function localPayGuardV41(order){
  const payments=Array.isArray(order.payments)?order.payments:[];
  for(const p of payments){
    if(p.method==='Card' || p.method==='Online') validateLocalPaymentRefV42(p.method, p.amount||p.received, p.reference || p.approvalCode || p.provider, p.method);
    if(p.method==='Card' || p.method==='Online'){ p.offlineCaptured=true; p.verificationStatus='PENDING_SYNC'; p.settlementStatus='PENDING_RECONCILIATION'; }
  }
}
function payRefLabelV42(p){
  const bits=[]; if(p.provider) bits.push(p.provider); if(p.terminal) bits.push(p.terminal); if(p.reference) bits.push('Ref '+p.reference); if(p.approvalCode) bits.push('Approval '+p.approvalCode); if(p.cardLast4) bits.push('****'+p.cardLast4); if(p.verificationStatus && p.verificationStatus!=='VERIFIED') bits.push(p.verificationStatus); return bits.join(' • ');
}
const __v42ReceiptText = receiptText;
receiptText = function(r){
  const base=__v42ReceiptText(r); const refs=(r.payments||[]).map(payRefLabelV42).filter(Boolean); return refs.length ? base.replace(/Thank you|Generated by SwiftTill POS|Offline sale saved locally\. Sync to cloud when internet is available\./, m=>`Payment Refs:\n${refs.join('\n')}\n${m}`) : base;
};
const __v42ReceiptHTML = receiptHTML;
receiptHTML = function(r){
  let html=__v42ReceiptHTML(r); const refs=(r.payments||[]).map(p=>({method:p.method,txt:payRefLabelV42(p)})).filter(x=>x.txt); if(refs.length){ const block=`<div class="sep"></div><div class="payment-ref-block"><b>Payment References</b>${refs.map(x=>`<div class="r sub"><span>${esc(x.method)}</span><span>${esc(x.txt)}</span></div>`).join('')}</div>`; html=html.replace('<div class="sep"></div><div class="c">', block+'<div class="sep"></div><div class="c">'); } return html;
};
function paymentRowsForReportsV42(orders){
  const out={};
  for(const o of orders){ for(const p of (o.payments||[])){ const m=p.method||'Unknown'; out[m] ||= {method:m,count:0,received:0,change:0,revenue:0,pending:0}; out[m].count+=1; out[m].received+=Number(p.received ?? p.amount ?? 0); out[m].change+=Number(p.change||0); out[m].revenue+=Number(p.amount||0); if(p.verificationStatus && p.verificationStatus!=='VERIFIED') out[m].pending+=1; } }
  Object.values(out).forEach(x=>{x.received=Math.round(x.received*100)/100;x.change=Math.round(x.change*100)/100;x.revenue=Math.round(x.revenue*100)/100;});
  return out;
}
function localReportDataV41(path){
  const params=new URLSearchParams(String(path).split('?')[1]||'');
  const from=params.get('from')||'', to=params.get('to')||'';
  const wantPayment=String(params.get('paymentMode')||'').toLowerCase(), wantItem=params.get('itemId')||'', wantCategory=params.get('categoryId')||'', wantOrderType=params.get('orderType')||'', wantCashier=params.get('cashierId')||'', wantTaker=params.get('orderTakerId')||'';
  const discountOnly=params.get('discountOnly')==='1';
  const inRange=(iso)=>{ const t=new Date(iso||0).getTime(); const a=from?new Date(from+'T00:00:00').getTime():0; const b=to?new Date(to+'T23:59:59').getTime():Date.now()+86400000; return t>=a&&t<=b; };
  const cloudPaid=[...(state?.paidOrders||[]), ...(state?.orders||[]).filter(o=>o.status==='PAID')];
  const localPaid=Object.values(localOrdersV41()).filter(o=>o.status==='PAID'&&!o.serverConfirmedAt);
  const seen=new Set();
  let paid=[...cloudPaid,...localPaid].filter(o=>{ const key=o.serverId||o.id||o.offlineRef||o.number; if(seen.has(key)) return false; seen.add(key); return inRange(o.paidAt||o.createdAt); });
  paid=paid.filter(o=>{ const ot=calcTotals(o); if(wantPayment && !(o.payments||[]).some(p=>String(p.method||'').toLowerCase()===wantPayment)) return false; if(wantItem && !(o.lines||[]).some(l=>l.itemId===wantItem||l.dealId===wantItem)) return false; if(wantCategory && !(o.lines||[]).some(l=>l.categoryId===wantCategory)) return false; if(wantOrderType && o.type!==wantOrderType) return false; if(wantCashier && o.cashierId!==wantCashier) return false; if(wantTaker && o.orderTakerId!==wantTaker) return false; if(discountOnly && ot.discount<=0) return false; return true; });
  const rows=paid.map(o=>{ const t=calcTotals(o); return { id:o.id, number:o.number||o.offlineRef, date:o.paidAt||o.createdAt, type:o.type, table:state?.tables?.find(x=>x.id===o.tableId)?.name||'', guests:o.guests||0, customer:o.customerName||'', mobile:o.mobile||'', orderTaker:o.orderTakerName||'', cashier:o.cashierName||'', subtotal:t.subtotal, discount:t.discount, deliveryFee:t.deliveryFee, total:t.total, payments:(o.payments||[]).map(p=>`${p.method}${p.reference?` Ref:${p.reference}`:''}${p.verificationStatus&&p.verificationStatus!=='VERIFIED'?` (${p.verificationStatus})`:''}`).join(', '), lines:o.lines||[], discountType:o.discountType, discountValue:o.discountValue, offline:!o.serverConfirmedAt && (o.offline||String(o.number||'').startsWith('OFF-')) }; });
  const summary={orders:rows.length,guests:rows.reduce((sum,r)=>sum+Number(r.guests||0),0),gross:0,discounts:0,refunds:0,net:0,averageBill:0,totalReceived:0,changeReturned:0};
  const orderTypeWise={}, itemMap={}, catMap={}, catDetail={}, orderTypeDetails={}, discountRows=[];
  const paymentDetailMap=paymentRowsForReportsV42(paid), paymentWise={}; Object.values(paymentDetailMap).forEach(p=>{paymentWise[p.method]=p.revenue; summary.totalReceived+=p.received; summary.changeReturned+=p.change;});
  for(const o of paid){ const t=calcTotals(o); summary.gross+=t.subtotal+t.deliveryFee; summary.discounts+=t.discount; summary.net+=t.total; orderTypeWise[o.type]=(orderTypeWise[o.type]||0)+t.total; orderTypeDetails[o.type] ||= {type:o.type,orders:0,guests:0,gross:0,discount:0,net:0}; orderTypeDetails[o.type].orders+=1; orderTypeDetails[o.type].guests+=Number(o.guests||0); orderTypeDetails[o.type].gross+=t.subtotal+t.deliveryFee; orderTypeDetails[o.type].discount+=t.discount; orderTypeDetails[o.type].net+=t.total; if(t.discount>0) discountRows.push(rows.find(r=>(r.id===o.id))||{}); for(const l of (o.lines||[])){ const key=l.name||l.itemId||'Item'; const cat=l.categoryName||state?.categories?.find(c=>c.id===l.categoryId)?.name||l.categoryId||'Uncategorized'; const lineGross=((Number(l.price)||0)+(l.modifiers||[]).reduce((a,m)=>a+Number(m.price||0),0))*Number(l.qty||0); itemMap[key] ||= {item:key,category:cat,qty:0,gross:0,discountShare:0,net:0,sales:0}; itemMap[key].qty+=Number(l.qty||0); itemMap[key].gross+=lineGross; itemMap[key].sales+=lineGross; itemMap[key].net+=lineGross; catMap[cat]=(catMap[cat]||0)+lineGross; catDetail[cat] ||= {category:cat,qty:0,gross:0,net:0}; catDetail[cat].qty+=Number(l.qty||0); catDetail[cat].gross+=lineGross; catDetail[cat].net+=lineGross; } }
  ['gross','discounts','net','totalReceived','changeReturned'].forEach(k=>summary[k]=Math.round(summary[k]*100)/100); summary.averageBill=summary.orders?Math.round((summary.net/summary.orders)*100)/100:0;
  Object.values(itemMap).forEach(row=>{ row.discountShare=summary.gross?Math.round((summary.discounts*(row.gross/summary.gross))*100)/100:0; row.net=Math.round((row.gross-row.discountShare)*100)/100; });
  Object.values(orderTypeDetails).forEach(row=>{ ['gross','discount','net'].forEach(k=>row[k]=Math.round(row[k]*100)/100); row.averageBill=row.orders?Math.round((row.net/row.orders)*100)/100:0; });
  const pendingRefs=paid.flatMap(o=>(o.payments||[]).filter(p=>p.verificationStatus&&p.verificationStatus!=='VERIFIED').map(p=>({bill:o.number||o.offlineRef,method:p.method,reference:p.reference||'',status:p.verificationStatus,amount:p.amount||0})));
  return { ok:true, data:{ filters:{from,to}, range:{from,to}, offline:true, warning:`OFFLINE REPORT: includes cached cloud sales + ${localPaid.length} unsynced local sale(s). Final cloud report will update after Sync Now.`, pendingPaymentRefs:pendingRefs, unsyncedOrders:localPaid.length, summary, paymentWise, orderTypeWise, itemWise:Object.values(itemMap).sort((a,b)=>b.net-a.net), categoryWise:catMap, categoryDetails:Object.values(catDetail), paymentDetails:Object.values(paymentDetailMap), orderTypeDetails:Object.values(orderTypeDetails), discountWise:{count:discountRows.length,amount:summary.discounts,rows:discountRows}, refunds:[], voidOrders:[], shiftSummary:{shiftNumber:state?.activeShift?.number||'',shiftStatus:state?.activeShift?.status||'',openingCash:state?.activeShift?.openingCash||0,cashSales:paymentWise.Cash||0,cashRefunds:0,expectedCash:(state?.activeShift?.openingCash||0)+(paymentWise.Cash||0)}, orders:rows } };
}
const __v42ReportHeaderHtml = reportHeaderHtml;
reportHeaderHtml = function(r){ const warn=r?.warning?`<div class="offline-report-banner"><b>Offline report mode</b><span>${esc(r.warning)}</span></div>`:''; const pending=(r?.pendingPaymentRefs||[]).length?`<div class="offline-report-banner amber"><b>Pending payment reconciliation</b><span>${r.pendingPaymentRefs.length} card/online payment(s) pending cloud sync/reconciliation.</span></div>`:''; return warn+pending+__v42ReportHeaderHtml(r); };
const __v42DownloadApi = downloadApi;
downloadApi = async function(path, filename){
  if(!navigator.onLine && String(path).startsWith('/api/export')) return exportOfflineReportCsvV42(path, filename);
  return __v42DownloadApi(path, filename);
};
function exportOfflineReportCsvV42(path, filename){
  const r=localReportDataV41(path).data; const rows=[['Report','Offline Export'],['Warning',r.warning],[],['Bill No','Date','Order Type','Table','Guests','Customer','Mobile','Order Taker','Cashier','Subtotal','Discount','Delivery Fee','Total','Payments']].concat((r.orders||[]).map(o=>[o.number,o.date,o.type,o.table,o.guests,o.customer,o.mobile,o.orderTaker,o.cashier,o.subtotal,o.discount,o.deliveryFee,o.total,o.payments]));
  const csv=rows.map(row=>row.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(',')).join('\n'); const blob=new Blob([csv],{type:'text/csv;charset=utf-8'}); const a=document.createElement('a'); a.href=URL.createObjectURL(blob); a.download=filename||`swifttill-offline-report-${Date.now()}.csv`; a.click(); URL.revokeObjectURL(a.href); toast('Offline report exported');
}
function renderSyncCenterV41(c){
  if(!c) return; const rows=pendingOfflineOrdersV41(); const all=Object.values(localOrdersV41()); const meta=safeJsonParseV41(localStorage.getItem(V41_OFFLINE.metaKey),{}); const pct=V41_OFFLINE.progress.total?Math.round((V41_OFFLINE.progress.done/V41_OFFLINE.progress.total)*100):0; const cardOnline=all.flatMap(o=>(o.payments||[]).filter(p=>['Card','Online'].includes(p.method)&&p.verificationStatus!=='VERIFIED'));
  c.innerHTML=`<div class="module-title"><div><h3>Sync Center</h3><p class="muted-note">Professional single-counter offline queue. Bills stay local until cloud confirms upload.</p></div><div class="actions-mini"><button class="primary-btn" id="syncNowV41" ${(!navigator.onLine||!rows.length||V41_OFFLINE.syncing)?'disabled':''}>Sync Now</button><button class="ghost-btn" id="exportOfflineV41">Export Emergency Backup</button></div></div>
  <div class="sync-hero-card"><div><span class="status-dot ${navigator.onLine?'ok':'offline'}"></span><b>${navigator.onLine?'Internet Online':'Internet Offline'}</b><p>${rows.length?`${rows.length} bill(s) waiting for upload. Local data is not deleted before server confirmation.`:'No pending upload. Local queue clear.'}</p></div><div class="sync-progress-bar"><i style="width:${pct}%"></i></div><em>${esc(V41_OFFLINE.progress.message || 'Ready')}</em></div>
  <div class="sync-status-grid"><div class="card metric"><p>Pending Upload</p><h3>${rows.length}</h3></div><div class="card metric"><p>Local Bills Stored</p><h3>${all.length}</h3></div><div class="card metric"><p>Card/Online Pending</p><h3>${cardOnline.length}</h3></div><div class="card metric"><p>Last Local Save</p><h3>${meta.at?new Date(meta.at).toLocaleTimeString():'—'}</h3></div></div>
  <div class="card subcard"><h3>Pending Bills</h3><div class="report-table-wrap"><table class="admin-table"><thead><tr><th>Offline Ref</th><th>Status</th><th>Type</th><th>Items</th><th>Total</th><th>Payments</th><th>Saved</th></tr></thead><tbody>${rows.length?rows.map(o=>`<tr><td>${esc(o.offlineRef||o.number)}</td><td>${esc(o.syncStatus||o.status)}</td><td>${esc(formatType(o.type))}</td><td>${(o.lines||[]).reduce((sum,l)=>sum+Number(l.qty||0),0)}</td><td>${money(calcTotals(o).total)}</td><td>${esc((o.payments||[]).map(p=>`${p.method}${p.reference?' #'+p.reference:''}`).join(', ')||'Unpaid')}</td><td>${new Date(o.updatedAt||o.createdAt).toLocaleString()}</td></tr>`).join(''):'<tr><td colspan="7">No pending offline bills.</td></tr>'}</tbody></table></div></div>
  <div class="card subcard"><h3>Safety & Stability</h3><div class="safety-list"><p>✓ Counter PC offline mode only</p><p>✓ Browser local queue + emergency export</p><p>✓ Server idempotency prevents duplicate uploads</p><p>✓ Card/Online selection saves even without real integration</p><p>✓ Reports work offline with clear unsynced warning</p><p>✓ Failed/conflict bills stay pending for retry</p></div></div>`;
  $('#syncNowV41') && ($('#syncNowV41').onclick=()=>syncOfflineNowV41(true)); $('#exportOfflineV41') && ($('#exportOfflineV41').onclick=exportOfflineBackupV41);
}



/* ============================================================
   SwiftTill V43 Complete Offline Safe Counter
   - Card/Online are normal POS selections; references are optional
   - local queue keeps dual browser copies + IndexedDB mirror + Counter Agent disk snapshots
   - failed uploads stay pending; confirmed uploads are pruned safely to protect storage
   - package is Defender-friendly: no exe, no registry/service install, no obfuscation
============================================================ */
const V43_SAFE_COUNTER_VERSION = '44.0.0-offline-auth-operational-safety';
const V43_SAFE = {
  indexedDbName: 'SwiftTillOfflineSafeCounterV43',
  indexedDbStore: 'snapshots',
  agentQueueKey: 'swifttill_agent_backup_queue_v43',
  snapshotKey: 'swifttill_offline_snapshot_v43',
  snapshotBackupKey: 'swifttill_offline_snapshot_backup_v43',
  maxConfirmedKeep: 50
};
function checksumV43(text){ text=String(text||''); let a=2166136261>>>0; for(let i=0;i<text.length;i++){ a^=text.charCodeAt(i); a=Math.imul(a,16777619)>>>0; } return text.length+':'+a.toString(16); }
function openIdbV43(){
  return new Promise((resolve,reject)=>{
    if(!('indexedDB' in window)) return resolve(null);
    const req=indexedDB.open(V43_SAFE.indexedDbName,1);
    req.onupgradeneeded=()=>{ const db=req.result; if(!db.objectStoreNames.contains(V43_SAFE.indexedDbStore)) db.createObjectStore(V43_SAFE.indexedDbStore,{keyPath:'id'}); };
    req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error||new Error('IndexedDB unavailable'));
  });
}
async function idbPutV43(id, value){
  const db=await openIdbV43(); if(!db) return false;
  return new Promise((resolve,reject)=>{ const tx=db.transaction(V43_SAFE.indexedDbStore,'readwrite'); tx.objectStore(V43_SAFE.indexedDbStore).put({id, value, updatedAt:new Date().toISOString()}); tx.oncomplete=()=>resolve(true); tx.onerror=()=>reject(tx.error||new Error('IndexedDB write failed')); });
}
async function idbGetV43(id){
  const db=await openIdbV43(); if(!db) return null;
  return new Promise((resolve,reject)=>{ const tx=db.transaction(V43_SAFE.indexedDbStore,'readonly'); const req=tx.objectStore(V43_SAFE.indexedDbStore).get(id); req.onsuccess=()=>resolve(req.result?.value||null); req.onerror=()=>reject(req.error||new Error('IndexedDB read failed')); });
}
async function restoreOfflineFromIndexedDbV43(){
  try{
    const value=await idbGetV43('latest-orders');
    if(value && (!localStorage.getItem(V41_OFFLINE.ordersKey) || Object.keys(localOrdersV41()).length===0)){
      localStorage.setItem(V41_OFFLINE.ordersKey, JSON.stringify(value.orders||{}));
      localStorage.setItem(V41_OFFLINE.backupOrdersKey, JSON.stringify(value.orders||{}));
      localStorage.setItem(V41_OFFLINE.metaKey, JSON.stringify({ at:new Date().toISOString(), reason:'indexeddb-restore', deviceId:offlineDeviceId(), checksum:value.checksum||'' }));
      return true;
    }
  }catch(e){ console.warn('SwiftTill IndexedDB restore skipped:', e.message); }
  return false;
}
function agentBackupQueueV43(){ return safeJsonParseV41(localStorage.getItem(V43_SAFE.agentQueueKey), []); }
function saveAgentBackupQueueV43(q){ try{ localStorage.setItem(V43_SAFE.agentQueueKey, JSON.stringify((q||[]).slice(-12))); }catch{} }
async function flushAgentBackupQueueV43(){
  const q=agentBackupQueueV43(); if(!q.length) return;
  const url=(state?.settings?.localAgentUrl||'http://127.0.0.1:9721/print').replace('/print','/offline-backup');
  const remain=[];
  for(const payload of q){
    try{ const r=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)}); if(!r.ok) throw new Error('agent backup failed '+r.status); }
    catch(e){ remain.push(payload); }
  }
  saveAgentBackupQueueV43(remain);
}
function pruneConfirmedLocalOrdersV43(orders){
  const entries=Object.entries(orders||{});
  const pending=entries.filter(([_,o])=>!o.serverConfirmedAt && hasOrderLines(o));
  const confirmed=entries.filter(([_,o])=>o.serverConfirmedAt || !hasOrderLines(o)).sort((a,b)=>new Date(b[1].serverConfirmedAt||b[1].updatedAt||b[1].createdAt||0)-new Date(a[1].serverConfirmedAt||a[1].updatedAt||a[1].createdAt||0)).slice(0,V43_SAFE.maxConfirmedKeep);
  return Object.fromEntries([...pending,...confirmed]);
}
function saveLocalOrdersV41(orders, reason='save'){
  const cleaned=pruneConfirmedLocalOrdersV43(orders||{});
  const stamp=new Date().toISOString();
  const payload=JSON.stringify(cleaned);
  const sum=checksumV43(payload);
  const meta={ at:stamp, reason, deviceId:offlineDeviceId(), orderCount:Object.keys(cleaned).length, pendingCount:Object.values(cleaned).filter(o=>!o.serverConfirmedAt && hasOrderLines(o)).length, checksum:sum, version:V43_SAFE_COUNTER_VERSION, lastPersistOk:false };
  try{
    localStorage.setItem(V41_OFFLINE.walKey, JSON.stringify(meta));
    localStorage.setItem(V43_SAFE.snapshotBackupKey, localStorage.getItem(V43_SAFE.snapshotKey)||payload);
    localStorage.setItem(V43_SAFE.snapshotKey, payload);
    localStorage.setItem(V41_OFFLINE.backupOrdersKey, payload);
    localStorage.setItem(V41_OFFLINE.ordersKey, payload);
    const verify=localStorage.getItem(V41_OFFLINE.ordersKey)||'';
    if(checksumV43(verify)!==sum) throw new Error('Local save verification failed');
    meta.lastPersistOk=true;
    localStorage.setItem(V41_OFFLINE.metaKey, JSON.stringify(meta));
  }catch(e){
    console.error('SwiftTill V43 local save failed:', e.message);
    toast('Local save warning. Data mirror/agent backup will retry. Do not clear browser data.', true);
  }
  idbPutV43('latest-orders',{orders:cleaned,meta,checksum:sum}).catch(e=>console.warn('IndexedDB mirror failed:',e.message));
  idbPutV43('snapshot-'+Date.now(),{orders:cleaned,meta,checksum:sum}).catch(()=>{});
  const agentPayload={reason,deviceId:offlineDeviceId(),at:stamp,orders:cleaned,meta,checksum:sum,version:V43_SAFE_COUNTER_VERSION};
  saveAgentBackupQueueV43([...agentBackupQueueV43(), agentPayload]);
  scheduleAgentBackupV41(cleaned, reason);
  flushAgentBackupQueueV43().catch(()=>{});
}
const __v43BaseBoot = boot;
boot = async function(){ await restoreOfflineFromIndexedDbV43(); return __v43BaseBoot(); };
const __v43BaseSyncOfflineNowV41 = syncOfflineNowV41;
syncOfflineNowV41 = async function(manual=false){ await flushAgentBackupQueueV43().catch(()=>{}); const result=await __v43BaseSyncOfflineNowV41(manual); await flushAgentBackupQueueV43().catch(()=>{}); return result; };
const __v43BaseBuildPaymentBadgeV42 = buildPaymentBadgeV42;
buildPaymentBadgeV42 = function(){
  const offline=isOfflineRuntimeV42();
  return `<div class="pay-system-note ${offline?'offline':''}"><b>${offline?'Offline Payment Selection':'Payment Selection'}</b><span>${offline?'Cash, Card and Online selections are saved locally. No real gateway integration needed. Reference is optional.':'Cash, Card and Online are recorded for reports. Reference is optional.'}</span></div>`;
};
const __v43BaseRenderSyncCenterV41 = renderSyncCenterV41;
renderSyncCenterV41 = function(c){
  __v43BaseRenderSyncCenterV41(c);
  if(!c) return;
  const q=agentBackupQueueV43().length;
  const meta=safeJsonParseV41(localStorage.getItem(V41_OFFLINE.metaKey),{});
  const card=c.querySelector('.sync-hero-card');
  if(card){ card.insertAdjacentHTML('beforeend', `<div class="sync-safe-strip"><b>Safe counter mode V43</b><span>Browser queue + IndexedDB mirror + Counter Agent disk backup. Agent backup queue: ${q}. Last verified save: ${meta.lastPersistOk?'OK':'Pending'}.</span></div>`); }
  c.querySelectorAll('.safety-list p').forEach(p=>{ p.innerHTML=p.innerHTML.replace('Card/Online require reference before save','Card/Online selection saves; reference optional'); });
};
window.addEventListener('online',()=>flushAgentBackupQueueV43().catch(()=>{}));
setInterval(()=>{ if(navigator.onLine) flushAgentBackupQueueV43().catch(()=>{}); },60000);



/* ============================================================
   SwiftTill V44 Offline Authentication + Operational Safety
   - first login requires internet; after that the registered counter PC can unlock offline
   - no plain password is stored; only salted WebCrypto hash per cached user
   - offline role/permission snapshot protects admin/report access
   - Sync Center gets auth/readiness/scenario controls and agent backup restore
============================================================ */
const V44_AUTH_VERSION = '44.0.0-offline-auth-operational-safety';
const V44_AUTH = {
  usersKey: 'swifttill_offline_auth_users_v44',
  sessionKey: 'swifttill_offline_session_v44',
  readinessKey: 'swifttill_offline_readiness_v44',
  sessionHours: 12,
  iterations: 120000
};
function v44Now(){ return new Date().toISOString(); }
function v44Users(){ return safeJsonParseV41(localStorage.getItem(V44_AUTH.usersKey), {}); }
function saveV44Users(users){ localStorage.setItem(V44_AUTH.usersKey, JSON.stringify(users || {})); }
function v44Hex(buffer){ return Array.from(new Uint8Array(buffer)).map(b=>b.toString(16).padStart(2,'0')).join(''); }
function v44Salt(){ const a=new Uint8Array(16); if(window.crypto?.getRandomValues) crypto.getRandomValues(a); else for(let i=0;i<a.length;i++) a[i]=Math.floor(Math.random()*256); return v44Hex(a); }
async function v44HashPassword(password, salt){
  const text = String(salt || '') + '|' + offlineDeviceId() + '|' + String(password || '');
  if(window.crypto?.subtle){
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(String(password || '')), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits({ name:'PBKDF2', salt:enc.encode(String(salt || '') + '|' + offlineDeviceId()), iterations:V44_AUTH.iterations, hash:'SHA-256' }, key, 256);
    return v44Hex(bits);
  }
  let h=2166136261>>>0; for(let i=0;i<text.length;i++){ h^=text.charCodeAt(i); h=Math.imul(h,16777619)>>>0; }
  return String(text.length)+':'+h.toString(16);
}
function v44Networkish(e){ return /Failed to fetch|NetworkError|Load failed|Internet connection required|fetch|offline|ERR_/i.test(e?.message || String(e || '')); }
function v44AuthSummary(){
  const users=Object.values(v44Users());
  const session=safeJsonParseV41(localStorage.getItem(V44_AUTH.sessionKey), null);
  return { cachedUsers:users.length, users, session, ready:Boolean(users.length && cachedStateV41() && isRegisteredCounterV41()) };
}
function v44OfflineSessionValid(){
  const s=safeJsonParseV41(localStorage.getItem(V44_AUTH.sessionKey), null);
  if(!s || !s.email || !s.expiresAt) return null;
  if(new Date(s.expiresAt).getTime() < Date.now()) return null;
  const rec=v44Users()[String(s.email).toLowerCase()];
  return rec ? { ...s, record:rec } : null;
}
function v44ApplyOfflineUser(rec){
  const cached=cachedStateV41();
  if(!cached) throw new Error('No offline POS cache found. Login once with internet on this counter PC.');
  state=mergeOfflineStateV41(cached);
  state.user=rec.user || state.user;
  state.permissions=Array.isArray(rec.permissions) ? rec.permissions : (state.permissions || []);
  state.offlineAuth={ enabled:true, version:V44_AUTH_VERSION, email:rec.email, cachedAt:rec.cachedAt, lastOnlineAt:rec.lastOnlineAt, permissionSnapshot:true, mode:'cached-counter-auth' };
  return state;
}
async function cacheOfflineAuthV44(email, password, loginUser){
  if(!email || !password || isTouchMobileDeviceV41()) return false;
  ensureCounterRegisteredV41();
  if(!isRegisteredCounterV41()) return false;
  const salt=v44Salt();
  const hash=await v44HashPassword(password, salt);
  const users=v44Users();
  const key=String(email).trim().toLowerCase();
  const userSnap=clone(state?.user || loginUser || { email:key, name:key });
  const permSnap=clone(state?.permissions || []);
  users[key]={
    email:key,
    name:userSnap.name || key,
    user:userSnap,
    permissions:permSnap,
    salt,
    hash,
    iterations:V44_AUTH.iterations,
    algorithm:window.crypto?.subtle?'PBKDF2-SHA256':'FNV1A-FALLBACK',
    cachedAt:v44Now(),
    lastOnlineAt:v44Now(),
    deviceId:offlineDeviceId(),
    stateRevision:state?.sync?.revision || null,
    version:V44_AUTH_VERSION
  };
  saveV44Users(users);
  localStorage.setItem(V44_AUTH.readinessKey, JSON.stringify({ at:v44Now(), ok:true, reason:'online-login-cached', email:key, deviceId:offlineDeviceId(), version:V44_AUTH_VERSION }));
  return true;
}
async function offlineUnlockV44(email, password){
  if(isTouchMobileDeviceV41()) throw new Error('Offline login is blocked on mobile/second devices. Use registered counter PC only.');
  if(!isRegisteredCounterV41()) throw new Error('This PC is not registered for offline counter mode. Login once online on the counter PC.');
  const key=String(email || '').trim().toLowerCase();
  const users=v44Users();
  const rec=users[key];
  if(!rec) throw new Error('This user is not cached for offline login. Connect internet and login once first.');
  const hash=await v44HashPassword(password, rec.salt);
  if(hash !== rec.hash) throw new Error('Offline password is incorrect.');
  const expiresAt=new Date(Date.now()+V44_AUTH.sessionHours*3600*1000).toISOString();
  const offlineToken='offline-v44:'+key+':'+Date.now().toString(36);
  localStorage.setItem(V44_AUTH.sessionKey, JSON.stringify({ email:key, userId:rec.user?.id || '', name:rec.name || key, startedAt:v44Now(), expiresAt, deviceId:offlineDeviceId(), version:V44_AUTH_VERSION }));
  localStorage.setItem('swifttill_token', offlineToken);
  token=offlineToken;
  v44ApplyOfflineUser(rec);
  renderShell();
  startOfflineAutoSyncV41();
  toast('Offline Counter unlocked. Data will sync when internet returns.');
}
function lockOfflineSessionV44(){ localStorage.removeItem(V44_AUTH.sessionKey); if(String(token||'').startsWith('offline-v44:')){ localStorage.removeItem('swifttill_token'); token=''; } toast('Offline session locked.'); renderLogin(); }
function offlineLoginReadyV44(){ const a=v44AuthSummary(); return Boolean(a.ready && a.cachedUsers>0); }

const __v44BaseRenderLogin = renderLogin;
renderLogin = function(){
  const auth=v44AuthSummary();
  const offlineMode=!navigator.onLine;
  const ready=offlineLoginReadyV44();
  const users=auth.users.map(u=>u.email);
  const defaultEmail=users[0] || '';
  app.innerHTML = `<div class="login-screen v30-login-screen v44-login-screen">
    <div class="login-watermark">${productBrandMark()}</div>
    <form class="login-card v30-login-card" id="loginForm">
      <div class="login-brand-visual">${productBrandMark()}<b>SwiftTill</b><span>${offlineMode?'Offline Counter':'Cloud POS'}</span></div>
      <h1>${offlineMode?'Offline Counter Unlock':'Login'}</h1>
      <p>${offlineMode ? (ready?'Internet unavailable. Unlock with a user that was already verified online on this counter PC.':'Internet unavailable. First login must be online before offline use.') : 'Login online once to refresh the secure offline counter cache.'}</p>
      <div class="field"><label>Email</label><input name="email" autocomplete="username" value="${esc(defaultEmail)}" ${offlineMode&&users.length===1?'readonly':''}></div>
      <div class="field"><label>Password</label><input name="password" type="password" autocomplete="current-password"></div>
      <button class="primary-btn" style="width:100%">${offlineMode?'Unlock Offline':'Login'}</button>
      <div class="offline-auth-note ${ready?'ok':'warn'}"><b>${ready?'Offline ready on this counter PC':'Offline auth not ready'}</b><span>${ready?`${auth.cachedUsers} cached user(s). No plain password stored.`:'Connect internet and login once on this PC. Mobile/second devices remain online-only.'}</span></div>
      ${offlineMode?'<button type="button" class="ghost-btn full-width-btn mt" id="retryOnlineV44">Retry Internet Login</button>':''}
    </form>
  </div>`;
  $('#loginForm').addEventListener('submit', async e => {
    e.preventDefault();
    const f = new FormData(e.target); const body = Object.fromEntries(f); const email=String(body.email||'').trim(); const password=String(body.password||'');
    try{
      if(!navigator.onLine){ await offlineUnlockV44(email,password); return; }
      const j = await api('/api/login', body);
      token = j.token; localStorage.setItem('swifttill_token', token);
      await boot();
      await cacheOfflineAuthV44(email,password,j.user).catch(err=>console.warn('Offline auth cache skipped:',err.message));
      if(state) saveStateCacheV41(state);
    }catch(err){
      if(v44Networkish(err) && ready){ try{ await offlineUnlockV44(email,password); return; }catch(offErr){ toast(offErr.message,true); return; } }
      toast(err.message,true);
    }
  });
  const retry=$('#retryOnlineV44'); if(retry) retry.onclick=()=>location.reload();
};

const __v44BaseBoot = boot;
boot = async function(){
  if(!navigator.onLine && isRegisteredCounterV41()){
    const sess=v44OfflineSessionValid();
    if(sess){ try{ v44ApplyOfflineUser(sess.record); renderShell(); startOfflineAutoSyncV41(); return; }catch(e){ renderLogin(); return; } }
    return renderLogin();
  }
  if(!token) return renderLogin();
  try{ await loadState(); renderShell(); startOfflineAutoSyncV41(); }
  catch(e){
    if(!navigator.onLine || v44Networkish(e)){
      const sess=v44OfflineSessionValid();
      if(sess){ try{ v44ApplyOfflineUser(sess.record); renderShell(); startOfflineAutoSyncV41(); toast('Offline Counter Mode: authenticated locally; sync when internet returns.', true); return; }catch{} }
    }
    const cached=cachedStateV41();
    if(cached && isRegisteredCounterV41() && v44OfflineSessionValid()){ state=mergeOfflineStateV41(cached); renderShell(); startOfflineAutoSyncV41(); toast('Offline Counter Mode: local data safe; sync when internet returns.', true); }
    else { renderLogin(); }
  }
};

const __v44BaseCanHandleOfflineApiV41 = canHandleOfflineApiV41;
canHandleOfflineApiV41 = function(path, method){
  if(method==='GET' && path==='/api/ops/scenarios') return true;
  return __v44BaseCanHandleOfflineApiV41(path, method);
};
function operationalScenarioMatrixV44Local(){
  const auth=v44AuthSummary();
  const meta=safeJsonParseV41(localStorage.getItem(V41_OFFLINE.metaKey),{});
  const pending=pendingOfflineOrdersV41().length;
  return { ok:true, version:V44_AUTH_VERSION, mode:navigator.onLine?'online-or-cached':'offline-counter', readiness:{ counterPc:isRegisteredCounterV41(), offlineAuthReady:auth.ready, cachedUsers:auth.cachedUsers, pendingUpload:pending, lastLocalSave:meta.at || '', agentBackupQueue:agentBackupQueueV43().length }, scenarios:[
    { scenario:'First setup / first login', protection:'Server authentication is required once. Offline mode is not allowed until this counter PC has cached POS data and a salted password hash.', action:'Connect internet, login, open POS once, then offline mode is ready.' },
    { scenario:'Regular offline login', protection:'Cashier enters the same password; browser verifies salted PBKDF2 hash locally. Plain password is never saved.', action:'Use Offline Counter Unlock on registered PC.' },
    { scenario:'Wrong user/password offline', protection:'Unknown users and wrong passwords are blocked because no server verification is available offline.', action:'Use a cached account or reconnect internet.' },
    { scenario:'Role/permission offline', protection:'Last-known permission snapshot controls Admin, Reports and POS buttons offline.', action:'Update roles online, then login again on counter PC to refresh offline cache.' },
    { scenario:'Mobile/second device offline', protection:'Offline billing is blocked outside registered counter PC.', action:'Reconnect internet or use main counter PC.' },
    { scenario:'Power cut / PC shutdown mid-order', protection:'Every bill change is written to localStorage, backup copy, IndexedDB and Counter Agent disk snapshot.', action:'Restart PC, unlock offline, continue from Open Bills or Sync Center.' },
    { scenario:'One month no internet', protection:'Pending bills remain local; server idempotency prevents duplicate upload later.', action:'Do not clear browser data or agent folder; use Sync Now when internet returns.' },
    { scenario:'Browser data cleared', protection:'Counter Agent stores dated offline backup files outside browser storage.', action:'Use Restore from Agent Backup in Sync Center, then Sync Now.' },
    { scenario:'Cash/Card/Online offline payment', protection:'All are POS selections; cash change is calculated; card/online extra is blocked. References remain optional.', action:'Select payment method and sync later.' },
    { scenario:'Offline reports', protection:'Reports include cached cloud sales + unsynced local sales with warning banner.', action:'Use final cloud report after sync for official closeout.' },
    { scenario:'Duplicate Sync Now click', protection:'Sync lock + idempotent offline keys prevent duplicate cloud bills.', action:'Wait for progress to complete.' },
    { scenario:'Printer disconnected', protection:'Receipt stays in print spool and order remains saved.', action:'Reconnect printer and retry failed prints.' },
    { scenario:'Local storage warning/full', protection:'Verified save shows warning and emergency export stays available.', action:'Export backup and free disk space before rush-hour billing.' }
  ] };
}
const __v44BaseOfflineApiV41 = offlineApiV41;
offlineApiV41 = async function(path, data, method='POST'){
  const cleanPath=String(path).split('?')[0];
  if(method==='GET' && cleanPath==='/api/ops/scenarios') return operationalScenarioMatrixV44Local();
  return __v44BaseOfflineApiV41(path, data, method);
};

async function restoreFromAgentBackupV44(){
  const url=(state?.settings?.localAgentUrl||'http://127.0.0.1:9721/print').replace('/print','/offline-backups/latest');
  try{
    const res=await fetch(url,{method:'GET'});
    const out=await res.json().catch(()=>({ok:false,error:'Invalid agent response'}));
    if(!res.ok || out.ok===false || !out.backup) throw new Error(out.error || 'No agent backup found');
    const backup=out.backup;
    const incoming=backup.orders || backup.value?.orders || {};
    if(!incoming || typeof incoming!=='object' || !Object.keys(incoming).length) throw new Error('Agent backup has no orders');
    const merged={...localOrdersV41(), ...incoming};
    saveLocalOrdersV41(merged,'agent-backup-restore');
    if(backup.state && !cachedStateV41()) saveStateCacheV41(backup.state);
    await restoreOfflineFromIndexedDbV43().catch(()=>{});
    if(adminTab==='sync') renderAdminContent();
    updateOfflineDockV41();
    toast(`Restored ${Object.keys(incoming).length} order record(s) from Counter Agent backup.`);
  }catch(e){ toast('Restore failed: '+(e.message||'Counter Agent unavailable'), true); }
}
function testOfflineReadinessV44(){
  const auth=v44AuthSummary(); const meta=safeJsonParseV41(localStorage.getItem(V41_OFFLINE.metaKey),{});
  const checks=[
    ['Registered counter PC', isRegisteredCounterV41()],
    ['Cached POS state', Boolean(cachedStateV41())],
    ['Offline auth user cache', auth.cachedUsers>0],
    ['Local queue readable', Boolean(localOrdersV41())],
    ['Last verified local save', meta.lastPersistOk!==false],
    ['Mobile blocked offline', !isTouchMobileDeviceV41()]
  ];
  const ok=checks.every(x=>x[1]);
  localStorage.setItem(V44_AUTH.readinessKey, JSON.stringify({ at:v44Now(), ok, checks, deviceId:offlineDeviceId(), version:V44_AUTH_VERSION }));
  toast(ok?'Offline readiness check passed.':'Offline readiness has warnings. Check Sync Center.', !ok);
  if(adminTab==='sync') renderAdminContent();
}
const __v44BaseRenderSyncCenterV41 = renderSyncCenterV41;
renderSyncCenterV41 = function(c){
  __v44BaseRenderSyncCenterV41(c);
  if(!c) return;
  const auth=v44AuthSummary();
  const session=v44OfflineSessionValid();
  const readiness=safeJsonParseV41(localStorage.getItem(V44_AUTH.readinessKey), null);
  const sc=operationalScenarioMatrixV44Local();
  const authCard=document.createElement('div');
  authCard.className='grid2 v44-sync-extra';
  authCard.innerHTML=`<div class="card subcard"><h3>Offline Authentication</h3><div class="safety-list"><p>✓ First login requires internet</p><p>✓ Cached users: <b>${auth.cachedUsers}</b></p><p>✓ Password stored: <b>Never</b></p><p>✓ Local hash: <b>PBKDF2/Salted</b></p><p>✓ Permission snapshot: <b>Enabled</b></p><p>✓ Session: <b>${session?'Unlocked until '+new Date(session.expiresAt).toLocaleTimeString():'Locked / online'}</b></p></div><div class="actions-mini mt"><button class="ghost-btn" id="testOfflineReadyV44">Test Offline Readiness</button><button class="danger-btn" id="lockOfflineV44">Lock Offline Session</button></div></div>
  <div class="card subcard"><h3>Recovery Tools</h3><p class="muted-note">Use only if browser storage was cleared or you need to recover a dated Counter Agent backup.</p><div class="actions-mini"><button class="ghost-btn" id="restoreAgentBackupV44">Restore from Counter Agent Backup</button><button class="ghost-btn" id="refreshScenariosV44">Refresh Scenario Matrix</button></div><p class="muted-note">Last readiness check: ${readiness?.at?new Date(readiness.at).toLocaleString():'Not checked yet'} ${readiness?.ok===false?'⚠ warnings':''}</p></div>`;
  c.appendChild(authCard);
  const scenario=document.createElement('div');
  scenario.className='card subcard v44-scenario-card';
  scenario.innerHTML=`<h3>Operational Scenario Guards</h3><div class="report-table-wrap"><table class="admin-table"><thead><tr><th>Scenario</th><th>Protection</th><th>Action</th></tr></thead><tbody>${sc.scenarios.map(s=>`<tr><td>${esc(s.scenario)}</td><td>${esc(s.protection)}</td><td>${esc(s.action)}</td></tr>`).join('')}</tbody></table></div>`;
  c.appendChild(scenario);
  $('#testOfflineReadyV44') && ($('#testOfflineReadyV44').onclick=testOfflineReadinessV44);
  $('#lockOfflineV44') && ($('#lockOfflineV44').onclick=lockOfflineSessionV44);
  $('#restoreAgentBackupV44') && ($('#restoreAgentBackupV44').onclick=restoreFromAgentBackupV44);
  $('#refreshScenariosV44') && ($('#refreshScenariosV44').onclick=()=>renderSyncCenterV41(c));
};

const __v44BaseSaveStateCacheV41 = saveStateCacheV41;
saveStateCacheV41 = function(data){
  if(data?.user && data?.permissions){
    try{ data.offlineAuth={...(data.offlineAuth||{}), cachedUsers:v44AuthSummary().cachedUsers, firstOnlineLoginRequired:true, permissionSnapshot:true, version:V44_AUTH_VERSION}; }catch{}
  }
  return __v44BaseSaveStateCacheV41(data);
};
window.addEventListener('online',()=>{ const s=v44OfflineSessionValid(); if(s && token && !String(token).startsWith('offline-v44:')) localStorage.removeItem(V44_AUTH.sessionKey); });

boot();
