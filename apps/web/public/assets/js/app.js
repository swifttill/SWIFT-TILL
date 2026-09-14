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
      <div class="module-title v34-report-title"><div><h3>${esc(currentReportTitle())}</h3><p class="muted-note">Use the report menu to review sales, tenders, items and close-day summaries. A4/PDF and Thermal prints use separate compact templates.</p></div><div class="actions-mini"><button class="ghost-btn" id="exportReport" disabled>Export Excel</button><button class="ghost-btn" id="printReportPdfBtn" disabled>PDF / A4</button><button class="primary-btn" id="printReportThermalBtn" disabled>Thermal Print</button></div></div>
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
   SwiftTill V46 Business Day Open/Close + compact reports
   Offline concept removed. Billing requires Open Day.
============================================================ */
function v46TodayKey(){ const d=new Date(); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return d.toISOString().slice(0,10); }
function v46Day(){ return state?.activeShift || state?.businessDay?.activeDay || null; }
function v46DayLabel(day=v46Day()){
  if(!day) return 'No Day Open';
  const dateText = day.businessDate || (day.openedAt ? new Date(day.openedAt).toLocaleDateString('en-CA') : '');
  const statusText = String(day.status || 'OPEN').toLowerCase().replace(/^./, c => c.toUpperCase());
  return `Business Day ${day.number || ''} · ${dateText} · ${statusText}`;
}
function v46RequireDay(){ if(v46Day()) return true; toast('Open Business Day first. Billing is locked until the day is opened.', true); return false; }
const __v46BaseSetupBanner = setupBanner;
setupBanner = function(){
  const old = __v46BaseSetupBanner ? __v46BaseSetupBanner() : '';
  if(v46Day()) return old;
  return old + `<div class="setup-banner day-lock-banner"><div><b>Business day is not open</b><p>Open a business day before starting orders, holding bills, taking payments, or reviewing sales reports. This keeps after-midnight sales under the correct restaurant day.</p></div><button class="primary-btn" onclick="openOpenShift()">Open Business Day</button></div>`;
};
renderTopbar = function(){
  const d = new Date(); const active = v46Day(); const s = state.settings || {};
  const logo = s.logoUrl ? `<img class="topbar-company-logo" src="${esc(s.logoUrl)}" alt="${esc(s.businessName || 'Company Logo')}">` : `<span class="topbar-company-logo text-logo">ST</span>`;
  const back = screen === 'admin' ? `<button class="ghost-btn top-action back-pos-action" id="backPosBtn">← Back to POS</button>` : '';
  return `<div class="hello v30-hello"><div class="topbar-brand-wrap">${logo}<div><h2>${esc(s.businessName || 'SwiftTill POS')}</h2><p>${screen==='admin'?'Back office, reports and day close.':(active?'Billing allowed for active business day.':'Open Day before billing.')}</p></div></div></div>
  <div class="top-items">
    <div class="top-pill date-pill">📅 <span><b>${d.toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short',year:'numeric'})}</b>${d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span></div>
    <div class="top-pill user-pill">👤 <span><b>${esc(state.user.name)}</b>${esc(state.user.roles.join(', ') || 'User')}</span></div>
    <div class="top-pill branch-pill ${active?'day-open':'day-closed'}"><span class="status-dot"></span><span><b>${esc(s.branchName || 'Main Branch')}</b>${esc(v46DayLabel(active))}</span></div>
    ${back}
    <button class="ghost-btn shift-action ${active?'close-day-btn':'open-day-btn'}" id="shiftBtn">${active?'Close Business Day':'Open Business Day'}</button>
    <button class="ghost-btn logout-action" id="logoutBtn">Logout</button>
  </div>`;
};
renderSidebar = function(){
  const logo = state?.settings?.logoUrl || '';
  const brand = logo ? `<img src="${esc(logo)}" alt="${esc(state?.settings?.businessName || 'SwiftTill POS')}">` : `<div class="brand-text"><b>SwiftTill</b><span>POS</span></div>`;
  const locked = !v46Day();
  return `<div class="brand">${brand}</div>
  <button class="new-order ${locked?'locked':''}" id="newOrderBtn" ${locked?'disabled title="Open Business Day first"':''}>＋ New Order</button>
  <div class="search"><span>⌕</span><input id="menuSearch" placeholder="Search menu items..." ${locked?'disabled':''}></div>
  <div class="sidebar-scroll">
    <div class="section-title"><h3>Categories</h3><button id="showAll">View All</button></div>
    <button class="cat-btn ${categoryId==='all'?'active':''}" data-cat="all"><span>All Items</span></button>
    ${state.categories.filter(c=>c.active).sort((a,b)=>(a.sort||0)-(b.sort||0)).map(c=>`<button class="cat-btn ${categoryTone(c.name)} ${categoryId===c.id?'active':''}" data-cat="${esc(c.id)}">${c.imageUrl?`<img src="${esc(c.imageUrl)}" alt="">`:''}<span>${esc(c.name)}</span></button>`).join('')}
    <div class="divider"></div>
    <div class="section-title"><h3>Deals</h3></div>
    <button class="cat-btn no-icon ${centerMode==='deals'?'active':''}" id="dealsBtn"><span>Special Deals</span></button>
    <button class="cat-btn no-icon" id="comboBtn"><span>Meal Combos</span></button>
  </div>`;
};
bindSidebar = function(){
  const newBtn=$('#newOrderBtn'); if(newBtn) newBtn.onclick = () => v46RequireDay() && openNewOrderModal();
  $$('[data-cat]').forEach(b => b.onclick = () => { setMobileBill(false); screen='pos'; centerMode='menu'; categoryId=b.dataset.cat; renderShell(); });
  $('#dealsBtn') && ($('#dealsBtn').onclick = () => { screen='pos'; centerMode='deals'; renderShell(); });
  $('#comboBtn') && ($('#comboBtn').onclick = () => { screen='pos'; centerMode='deals'; renderShell(); });
  $('#showAll') && ($('#showAll').onclick = () => { setMobileBill(false); categoryId='all'; centerMode='menu'; screen='pos'; renderShell(); });
  const search=$('#menuSearch'); if(search) search.oninput = e => { screen='pos'; centerMode='menu'; renderMenu(e.target.value); };
  $('#logoutBtn') && ($('#logoutBtn').onclick = logout);
  $('#shiftBtn') && ($('#shiftBtn').onclick = () => v46Day() ? openCloseShift() : openOpenShift());
};
const __v46BaseRenderWorkspace = renderWorkspace;
renderWorkspace = function(){
  if(!v46Day() && !currentOrder){
    const ws=$('#workspace');
    if(ws){
      ws.innerHTML = `<div class="day-lock-panel card subcard"><div class="lock-icon">🔒</div><h2>Business Day Required</h2><p>Restaurant billing starts only after the business day is opened. Sales are grouped from opening time to close time, including sales after midnight.</p><button class="primary-btn" onclick="openOpenShift()">Open Business Day</button><button class="ghost-btn" onclick="screen='admin';adminTab='reports';renderShell()">View Reports</button></div>`;
    }
    return;
  }
  return __v46BaseRenderWorkspace();
};
async function ensureOrder(){ if(currentOrder) return true; if(!v46RequireDay()) return false; openNewOrderModal(); return false; }
openOpenShift = function(){
  const today = v46TodayKey();
  openModal(`<div class="modal-head"><h2>Open Business Day</h2><button class="x" onclick="closeModal()">×</button></div>
  <p class="muted-note">Sales are recorded against the selected Business Date from opening until day close. If the restaurant closes after midnight, the sales remain under the opened business day.</p>
  <div class="grid2"><div class="field"><label>Business Date</label><input id="businessDate" type="date" value="${today}"></div><div class="field"><label>Opening Cash</label><input id="openingCash" type="number" value="0" min="0"></div></div>
  <div class="field"><label>Opening Note</label><input id="dayNote" placeholder="Optional"></div>
  <button class="primary-btn" style="width:100%" id="doOpenShift">Open Business Day & Start Billing</button>`);
  $('#doOpenShift').onclick=async()=>{try{await api('/api/day/open',{businessDate:$('#businessDate').value,openingCash:Number($('#openingCash').value||0),note:$('#dayNote').value||''});closeModal();await loadState();renderShell();toast('Business day opened. Billing is now available.');}catch(e){toast(e.message,true);}};
};
openCloseShift = function(){
  const d=v46Day();
  const openCount=state?.openOrders?.length||0;
  openModal(`<div class="modal-head"><h2>Close Business Day</h2><button class="x" onclick="closeModal()">×</button></div>
  <p class="muted-note">${esc(v46DayLabel(d))}. Please complete, pay, or void all open bills before closing the business day.</p>
  ${openCount?`<div class="empty-cart error-state"><b>${openCount} open bill(s)</b><p>Complete, pay, or void all open bills before closing the business day.</p></div>`:''}
  <div class="field"><label>Counted Cash</label><input id="countedCash" type="number" value="0" min="0"></div>
  <button class="primary-btn" style="width:100%" id="doCloseShift" ${openCount?'disabled':''}>Close Day</button>`);
  const btn=$('#doCloseShift'); if(btn) btn.onclick=async()=>{try{const j=await api('/api/day/close',{countedCash:Number($('#countedCash').value||0)});closeModal();await loadState();renderShell();toast(`Business day closed. Cash difference ${money(j.shift.difference)}`);}catch(e){toast(e.message,true);}};
};
addItem = async function(itemId){
  if(!v46RequireDay()) return;
  if(!requireNotRapidClick()) return;
  const i=state.items.find(x=>x.id===itemId);
  if(!i||i.soldOut) return;
  if(numericPrice(i.price)<=0) return toast('Set item price in Admin before billing', true);
  if(!(await ensureOrder())) return;
  const line=currentOrder.lines.find(l=>l.kind==='ITEM'&&l.itemId===i.id&&(!l.modifiers||!l.modifiers.length)&&!l.note);
  if(line) line.qty++; else currentOrder.lines.push({lineId:uid(),kind:'ITEM',itemId:i.id,categoryId:i.categoryId,name:i.name,price:i.price,imageUrl:i.imageUrl,qty:1,note:'',modifiers:[]});
  renderBill(); markCartDirty?.(); const fab=$('#mobileCartFab b'); if(fab) fab.textContent=mobileCartSummary(); toast(line ? `${i.name} quantity updated` : `${i.name} added`);
};
addDeal = async function(dealId){
  if(!v46RequireDay()) return;
  if(!requireNotRapidClick()) return;
  const d=state.deals.find(x=>x.id===dealId);
  if(!d) return;
  if(numericPrice(d.price)<=0) return toast('Set deal price in Admin before billing', true);
  if(!(await ensureOrder())) return;
  const line=currentOrder.lines.find(l=>l.kind==='DEAL'&&l.dealId===d.id&&!l.note);
  if(line) line.qty++; else currentOrder.lines.push({lineId:uid(),kind:'DEAL',dealId:d.id,categoryId:'cat_deals',name:d.name,price:d.price,imageUrl:d.imageUrl,qty:1,note:'',modifiers:[],dealItems:d.items});
  renderBill(); markCartDirty?.(); const fab=$('#mobileCartFab b'); if(fab) fab.textContent=mobileCartSummary(); toast(line ? `${d.name} quantity updated` : `${d.name} added`);
};
const __v46BaseSaveOrder = saveOrder;
saveOrder = async function(hold=false){ if(!v46RequireDay()) return; return __v46BaseSaveOrder(hold); };
const __v46BaseOpenPayModal = openPayModal;
openPayModal = async function(){ if(!v46RequireDay()) return; return __v46BaseOpenPayModal(); };
function currentReportTitle(){
  return ({daily:'Day Sales Summary',itemwise:'Item Sales',category:'Category Sales',payment:'Payment Summary',custom:'Detailed Bill Report',x:'X Report - Open Day',y:'Period Sales Summary',z:'Z Report - Closed Day',discount:'Discounts',voidrefund:'Void / Refund',ordertype:'Order Type Sales'}[reportType] || 'Sales Report');
}
function reportDateDefaults(kind){
  const day=v46Day() || state?.businessDay?.lastClosed;
  const today=v46TodayKey();
  if((kind==='daily'||kind==='x'||kind==='z') && day?.businessDate) return {from:day.businessDate,to:day.businessDate,shiftId:day.id};
  if(kind==='y'){ const d=new Date(); const y=new Date(d.getFullYear(),0,1); y.setMinutes(y.getMinutes()-y.getTimezoneOffset()); return {from:y.toISOString().slice(0,10),to:today,shiftId:''}; }
  const d=new Date(); d.setDate(d.getDate()-30); d.setMinutes(d.getMinutes()-d.getTimezoneOffset()); return {from:d.toISOString().slice(0,10),to:today,shiftId:''};
}
function v46ShiftOptions(selected=''){
  return (state.shifts||[]).map(s=>`<option value="${esc(s.id)}" ${selected===s.id?'selected':''}>Business Day ${esc(s.number)} · ${esc(s.businessDate || '')} · ${esc(String(s.status || '').toLowerCase().replace(/^./, c => c.toUpperCase()))}${s.closedAt?' · Closed':''}</option>`).join('');
}
function reportQuery(){
  const params = new URLSearchParams(); params.set('type', reportType);
  const shift=$('#shiftId')?.value||''; if(shift) params.set('shiftId', shift);
  const map = {from:'fromDate',to:'toDate',paymentMode:'paymentMode',orderType:'orderType',itemId:'itemId',categoryId:'categoryFilter',cashierId:'cashierId',orderTakerId:'orderTakerId'};
  for(const [k,id] of Object.entries(map)){ const el=$('#'+id); if(el && el.value) params.set(k,el.value); }
  if($('#discountOnly')?.checked) params.set('discountOnly','1'); if($('#refundOnly')?.checked) params.set('refundOnly','1'); return params.toString();
}
function updateReportFilterVisibility(){ return applyReportFilterVisibility(); }
function applyReportFilterVisibility(){
  const visible={daily:['businessday','payment','ordertype','cashier','taker'],itemwise:['businessday','date','item','category','cashier','taker'],category:['businessday','date','category','cashier'],payment:['businessday','date','payment','cashier'],custom:['businessday','date','payment','ordertype','item','category','cashier','taker','discount','refund'],x:['businessday','cashier'],y:['date','payment','ordertype','cashier'],z:['businessday','cashier'],discount:['businessday','date','cashier','taker','discount'],voidrefund:['businessday','date','cashier','refund'],ordertype:['businessday','date','ordertype','cashier','taker']}[reportType]||['date'];
  $$('.report-filter').forEach(el=>{ el.style.display = visible.some(v=>el.classList.contains(v+'-filter')) ? '' : 'none'; });
  if(reportType==='discount' && $('#discountOnly')) $('#discountOnly').checked=true; if(reportType==='voidrefund' && $('#refundOnly')) $('#refundOnly').checked=true;
}
function renderReports(ws){
  try{
    const defs=reportDateDefaults(reportType);
    const paymentOptions=(state.paymentMethods||[]).filter(p=>p.active!==false).map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
    const itemOptions=[...(state.items||[]).map(i=>`<option value="${esc(i.id)}">${esc(i.name)}</option>`),...(state.deals||[]).map(d=>`<option value="${esc(d.id)}">Deal: ${esc(d.name)}</option>`)].join('');
    const catOptions=(state.categories||[]).filter(c=>c.id!=='cat_all'&&c.id!=='all').map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
    const userOptions=(state.users||[]).map(u=>`<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
    const takerOptions=(state.orderTakers||[]).map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
    ws.innerHTML=`<div class="report-page admin-report-shell pro-report-screen qb-report-module v46-report-page">
      <div class="module-title v34-report-title"><div><h3>${esc(currentReportTitle())}</h3><p class="muted-note">Reports are based on the selected business day open-to-close period. A4/PDF and Thermal print layouts are compact to reduce paper waste.</p></div><div class="actions-mini"><button class="ghost-btn" id="exportReport" disabled>Export CSV</button><button class="ghost-btn" id="printReportPdfBtn" disabled>A4 / PDF</button><button class="primary-btn" id="printReportThermalBtn" disabled>Thermal</button></div></div>
      <div class="report-work card subcard v34-report-work">
        <div class="report-headline branded-report-headline"><div class="brand-report-name">${v34OrgLogoImg('report-org-logo screen-logo')}<div><h3 id="reportTitle">${esc(currentReportTitle())}</h3><span>${esc(v46DayLabel())}</span></div></div></div>
        <div class="report-filter-grid compact-filters v46-report-filters" id="reportFilters">
          <div class="field report-filter businessday-filter"><label>Business Day</label><select id="shiftId"><option value="">All / Date Range</option>${v46ShiftOptions(defs.shiftId||'')}</select></div>
          <div class="field report-filter date-filter"><label>From</label><input type="date" id="fromDate" value="${defs.from}"></div>
          <div class="field report-filter date-filter"><label>To</label><input type="date" id="toDate" value="${defs.to}"></div>
          <div class="field report-filter payment-filter"><label>Payment</label><select id="paymentMode"><option value="">All</option>${paymentOptions}</select></div>
          <div class="field report-filter ordertype-filter"><label>Order Type</label><select id="orderType"><option value="">All</option><option value="DINE_IN">Dine In</option><option value="DELIVERY">Delivery</option><option value="TAKEAWAY">Takeaway</option></select></div>
          <div class="field report-filter item-filter"><label>Item / Deal</label><select id="itemId"><option value="">All</option>${itemOptions}</select></div>
          <div class="field report-filter category-filter"><label>Category</label><select id="categoryFilter"><option value="">All</option>${catOptions}</select></div>
          <div class="field report-filter cashier-filter"><label>Cashier</label><select id="cashierId"><option value="">All</option>${userOptions}</select></div>
          <div class="field report-filter taker-filter"><label>Order Taker</label><select id="orderTakerId"><option value="">All</option>${takerOptions}</select></div>
          <label class="check report-filter discount-filter"><input type="checkbox" id="discountOnly"> Discounted only</label>
          <label class="check report-filter refund-filter"><input type="checkbox" id="refundOnly"> Refunded only</label>
          <button class="primary-btn" id="runReport">Run</button>
        </div>
        <div id="reportResult" class="mt"><div class="empty-cart compact-empty"><b>Select report.</b><p>Run report to show clean summary, relevant details, A4/PDF and thermal print.</p></div></div>
      </div></div>`;
    updateReportFilterVisibility();
    $('#runReport').onclick=runReport; $('#printReportPdfBtn').onclick=()=>printReportHtml('a4'); $('#printReportThermalBtn').onclick=()=>printReportHtml('thermal'); $('#exportReport').onclick=()=>downloadApi(`/api/export?${reportQuery()}`,`swifttill-${reportType}-report-${Date.now()}.csv`).catch(e=>toast(e.message,true));
  }catch(e){ ws.innerHTML=`<div class="card subcard error-state"><h3>Reports failed to render</h3><p>${esc(e.message)}</p><button class="primary-btn" onclick="renderAdminContent()">Reload Reports</button></div>`; }
}
function v46ReportRangeText(r){ const bd=r.businessDay||r.shiftSummary||{}; return bd.shiftId||bd.id ? `Business Day ${bd.businessDate||''} · ${bd.openedAt?new Date(bd.openedAt).toLocaleString():''} to ${bd.closedAt?new Date(bd.closedAt).toLocaleString():'Open'}` : reportRangeText(r); }
function v46SummaryBlock(r){ const s=r.summary||{}, sh=r.shiftSummary||{}; return `<div class="qb-two-col v46-summary"><div>${reportTable(['Sales','Amount'],[['Gross',reportMoney(s.gross)],['Discount',reportMoney(s.discounts)],['Refund',reportMoney(s.refunds)],['Net Sales',reportMoney(s.net)],['Orders',s.orders||0],['Average Bill',reportMoney(s.averageBill)]])}</div><div>${reportTable(['Cash Drawer','Amount'],[['Day',sh.shiftNumber?`#${sh.shiftNumber} ${sh.businessDate||''}`:'—'],['Opening Cash',reportMoney(sh.openingCash)],['Cash Sales',reportMoney(sh.cashSales)],['Cash Refunds',reportMoney(sh.cashRefunds)],['Expected Cash',reportMoney(sh.expectedCash)],['Counted Cash',sh.countedCash==null?'Not closed':reportMoney(sh.countedCash)],['Difference',sh.difference==null?'Not closed':reportMoney(sh.difference)]])}</div></div>`; }
function buildA4ReportHtml(r){
  const title=currentReportTitle(); const s=r.summary||{}; let details='';
  if(reportType==='itemwise'){ const rows=reportItemRows(r); details=reportTable(['Item','Category','Qty','Net'],rows.map(x=>[x[0],x[1],x[2],x[5]]),['TOTAL','',sumReport(rows,2),reportMoney(sumReport(rows,5))]); }
  else if(reportType==='category'){ const rows=reportCategoryRows(r); details=reportTable(['Category','Qty','Net'],rows.map(x=>[x[0],x[1],x[3]]),['TOTAL',sumReport(rows,1),reportMoney(sumReport(rows,3))]); }
  else if(reportType==='payment'){ const rows=reportPaymentRows(r); details=reportTable(['Payment','Trx','Received','Change','Revenue'],rows,['TOTAL',sumReport(rows,1),reportMoney(sumReport(rows,2)),reportMoney(sumReport(rows,3)),reportMoney(sumReport(rows,4))]); }
  else if(reportType==='discount'){ const rows=reportDiscountRows(r); details=reportTable(['Bill','Date','Type','Discount','Total'],rows.map(x=>[x[0],x[1],x[2],x[6],x[7]]),['TOTAL','','',reportMoney(sumReport(rows,6)),reportMoney(sumReport(rows,7))]); }
  else if(reportType==='voidrefund'){ const rows=reportRefundRows(r); details=reportTable(['Type','Bill','Date','Amount','Reason'],rows.map(x=>[x[0],x[1],x[2],x[4],x[5]]),['TOTAL','','',reportMoney(sumReport(rows,4)),'']); }
  else if(reportType==='ordertype'){ const rows=reportOrderTypeRows(r); details=reportTable(['Order Type','Orders','Gross','Discount','Net'],rows.map(x=>[x[0],x[1],x[3],x[4],x[5]]),['TOTAL',sumReport(rows,1),reportMoney(sumReport(rows,3)),reportMoney(sumReport(rows,4)),reportMoney(sumReport(rows,5))]); }
  else if(reportType==='custom'){ details=reportTable(['Bill','Date','Type','Table','Cashier','Subtotal','Disc.','Delivery','Total','Payments'], reportBillRows(r).map(x=>[x[0],x[1],x[2],x[3],x[6],x[7],x[8],x[9],x[10],x[11]]), ['TOTAL','','','','',reportMoney(sumRows(r.orders||[],'subtotal')),reportMoney(sumRows(r.orders||[],'discount')),reportMoney(sumRows(r.orders||[],'deliveryFee')),reportMoney(sumRows(r.orders||[],'total')),'']); }
  else { const pay=reportPaymentRows(r); const cat=reportCategoryRows(r).slice(0,12); details=reportTable(['Payment','Trx','Revenue'],pay.map(x=>[x[0],x[1],x[4]]),['TOTAL',sumReport(pay,1),reportMoney(sumReport(pay,4))]) + reportTable(['Category','Qty','Net'],cat.map(x=>[x[0],x[1],x[3]]),['TOTAL',sumReport(cat,1),reportMoney(sumReport(cat,3))]); }
  const closeSign = (reportType==='z'||reportType==='x') ? `<div class="qb-signatures v46-signatures"><span>Cashier</span><span>Manager</span></div>` : '';
  return `<div class="report-a4 qb-a4 v46-a4"><div class="qb-head"><div><h1>${esc(reportStoreName())}</h1><p>${esc(reportBranchLine())}</p></div><div><b>${esc(title)}</b><span>${esc(v46ReportRangeText(r))}</span><span>Printed: ${esc(new Date().toLocaleString())}</span></div></div><div class="qb-title-row"><h2>${esc(title)}</h2><b>Net ${esc(reportMoney(s.net))}</b></div>${v46SummaryBlock(r)}<h3 class="qb-section-title">${reportType==='custom'?'Bill Details':'Relevant Details'}</h3>${details}${closeSign}<p class="qb-footer">${esc(state?.settings?.reportFooter || 'Generated by SwiftTill POS')}</p></div>`;
}
function buildThermalReportHtml(r){
  const s=r.summary||{}, sh=r.shiftSummary||{}; const title=currentReportTitle();
  let body=`<div class="thermal-report v46-thermal"><div class="tr-center"><b>${esc(reportStoreName())}</b><br>${esc(state?.settings?.branchName||'')}</div><div class="tr-sep"></div>${thermalLine('REPORT',title)}${thermalLine('DAY',sh.businessDate||'')}${thermalLine('OPEN',sh.openedAt?new Date(sh.openedAt).toLocaleString():'')}${thermalLine('CLOSE',sh.closedAt?new Date(sh.closedAt).toLocaleString():'Open')}<div class="tr-sep"></div><div class="tr-title">SUMMARY</div>${thermalLine('Gross',reportMoney(s.gross))}${thermalLine('Discount',reportMoney(s.discounts))}${thermalLine('Refund',reportMoney(s.refunds))}${thermalLine('NET',reportMoney(s.net))}${thermalLine('Orders',s.orders||0)}`;
  if(['daily','payment','x','z','custom'].includes(reportType)) body+=`<div class="tr-sep"></div><div class="tr-title">CASH</div>${thermalLine('Opening',reportMoney(sh.openingCash))}${thermalLine('Cash Sales',reportMoney(sh.cashSales))}${thermalLine('Cash Refund',reportMoney(sh.cashRefunds))}${thermalLine('Expected',reportMoney(sh.expectedCash))}${thermalLine('Counted',sh.countedCash==null?'Not closed':reportMoney(sh.countedCash))}${thermalLine('Diff.',sh.difference==null?'Not closed':reportMoney(sh.difference))}`;
  if(reportType==='itemwise') body+=`<div class="tr-sep"></div>`+thermalTableBlock('ITEM SALES',(r.itemWise||[]).slice(0,25).map(i=>[i.item,`x${i.qty}`,reportMoney(i.net)]),3);
  else if(reportType==='category') body+=`<div class="tr-sep"></div>`+thermalTableBlock('CATEGORY',(r.categoryDetails||[]).slice(0,20).map(c=>[c.category,`x${c.qty}`,reportMoney(c.net)]),3);
  else if(reportType==='ordertype') body+=`<div class="tr-sep"></div>`+thermalTableBlock('ORDER TYPE',(r.orderTypeDetails||[]).map(o=>[formatType(o.type),`${o.orders} bills`,reportMoney(o.net)]),3);
  else if(reportType==='discount') body+=`<div class="tr-sep"></div>`+thermalTableBlock('DISCOUNT',(r.discountWise?.rows||[]).slice(0,25).map(o=>[`#${o.number}`,formatType(o.type),reportMoney(o.discount)]),3);
  else if(reportType==='voidrefund') body+=`<div class="tr-sep"></div>`+thermalTableBlock('VOID/REFUND',reportRefundRows(r).slice(0,25).map(x=>[`${x[0]} #${x[1]}`,x[5],x[4]]),3);
  else body+=`<div class="tr-sep"></div>`+thermalTableBlock('PAYMENTS',reportPaymentRows(r).map(p=>[p[0],`${p[1]} trx`,p[4]]),3);
  body+=`<div class="tr-sep"></div><div class="tr-center small">${esc(state?.settings?.reportFooter || 'Generated by SwiftTill POS')}</div></div>`; return body;
}
async function runReport(){
  const target=$('#reportResult'); if(target) target.innerHTML='<div class="report-loading"><b>Generating report...</b><span>Using business day open-close rules.</span></div>';
  $('#exportReport')?.setAttribute('disabled','disabled'); $('#printReportPdfBtn')?.setAttribute('disabled','disabled'); $('#printReportThermalBtn')?.setAttribute('disabled','disabled');
  try{ const j=await api(`/api/reports?${reportQuery()}`,null,'GET'); const r=j.data; window.swiftLastReport=r; if(!$('#reportResult')) return; $('#reportResult').innerHTML=`<div class="qb-report-screen v46-report-screen">${reportScreenSummary(r)}${buildA4ReportHtml(r)}</div>`; $('#exportReport')?.removeAttribute('disabled'); $('#printReportPdfBtn')?.removeAttribute('disabled'); $('#printReportThermalBtn')?.removeAttribute('disabled'); }
  catch(e){ if(target) target.innerHTML=`<div class="empty-cart error-state"><b>Report failed</b><p>${esc(e.message)}</p></div>`; toast(e.message,true); }
}
async function printReportHtml(mode='thermal'){
  const r=window.swiftLastReport; if(!r) return toast('Run report first.', true); const thermal=mode==='thermal'; const html=thermal?buildThermalReportHtml(r):buildA4ReportHtml(r); const area=ensurePrintArea(); area.className=`print-only ${thermal?'print-thermal v46-print-thermal':'print-a4 v46-print-a4'}`; area.innerHTML=html; if(thermal && state?.printAgent?.cloudQueueConfigured){ try{ const queued=await api('/api/print-jobs',{type:'report',html,text:thermalReportText(r)}); if(queued?.queued){ toast('Thermal report sent to cloud print queue'); return; } }catch(e){ toast('Cloud report queue failed; browser print opened', true); } } setTimeout(()=>window.print(),100);
}



/* ============================================================
   SwiftTill V47 Auto Logout Inactivity Security
   - auto logout after 12 minutes idle
   - warning before logout
   - saves dirty cart before session lock where possible
   - clears local token and audits logout on server
============================================================ */
const SWIFTTILL_IDLE_TIMEOUT_MS = 12 * 60 * 1000;
const SWIFTTILL_IDLE_WARNING_MS = 60 * 1000;
let __idleLogoutTimer = null;
let __idleCountdownTimer = null;
let __idleWarningVisible = false;
let __lastIdleActivityWrite = 0;
const SWIFTTILL_ACTIVITY_KEY = 'swifttill_last_activity_at';
const SWIFTTILL_IDLE_EVENT_KEY = 'swifttill_idle_logout_event';

function swiftNow(){ return Date.now(); }
function setSharedActivityNow(){
  const n = swiftNow();
  if(n - __lastIdleActivityWrite > 1000){
    __lastIdleActivityWrite = n;
    try{ localStorage.setItem(SWIFTTILL_ACTIVITY_KEY, String(n)); }catch{}
  }
  return n;
}
function getSharedActivityAt(){
  const n = Number(localStorage.getItem(SWIFTTILL_ACTIVITY_KEY) || 0);
  return n || setSharedActivityNow();
}
function ensureIdleLogoutWarning(){
  let el = document.getElementById('idleLogoutWarning');
  if(el) return el;
  el = document.createElement('div');
  el.id = 'idleLogoutWarning';
  el.className = 'idle-logout-warning';
  el.innerHTML = `<div class="idle-card">
    <div class="idle-icon">🔒</div>
    <h2>Session will logout soon</h2>
    <p>No activity detected. For counter security, SwiftTill will logout automatically.</p>
    <div class="idle-count"><b id="idleCountdown">60</b><span>seconds left</span></div>
    <div class="idle-actions"><button class="primary-btn" id="continueSessionBtn">Continue Session</button><button class="ghost-btn logout-action" id="idleLogoutNowBtn">Logout Now</button></div>
  </div>`;
  document.body.appendChild(el);
  $('#continueSessionBtn', el).onclick = () => registerUserActivity('continue-session', true);
  $('#idleLogoutNowBtn', el).onclick = () => idleLogoutNow('manual-from-warning');
  return el;
}
function showIdleWarning(){
  if(!token || !state) return;
  __idleWarningVisible = true;
  const el = ensureIdleLogoutWarning();
  el.classList.add('show');
  updateIdleCountdown();
  clearInterval(__idleCountdownTimer);
  __idleCountdownTimer = setInterval(updateIdleCountdown, 1000);
}
function hideIdleWarning(){
  __idleWarningVisible = false;
  clearInterval(__idleCountdownTimer);
  __idleCountdownTimer = null;
  const el = document.getElementById('idleLogoutWarning');
  if(el) el.classList.remove('show');
}
function updateIdleCountdown(){
  const left = Math.max(0, Math.ceil((SWIFTTILL_IDLE_TIMEOUT_MS - (swiftNow() - getSharedActivityAt())) / 1000));
  const c = document.getElementById('idleCountdown');
  if(c) c.textContent = String(left);
  if(left <= 0) idleLogoutNow('inactivity');
}
function scheduleIdleCheck(){
  clearTimeout(__idleLogoutTimer);
  if(!token || !state) return;
  const idleFor = swiftNow() - getSharedActivityAt();
  if(idleFor >= SWIFTTILL_IDLE_TIMEOUT_MS) return idleLogoutNow('inactivity');
  if(idleFor >= SWIFTTILL_IDLE_TIMEOUT_MS - SWIFTTILL_IDLE_WARNING_MS) showIdleWarning();
  else hideIdleWarning();
  const next = Math.max(1000, Math.min(30000, (SWIFTTILL_IDLE_TIMEOUT_MS - SWIFTTILL_IDLE_WARNING_MS) - idleFor));
  __idleLogoutTimer = setTimeout(scheduleIdleCheck, next);
}
function registerUserActivity(reason='activity', force=false){
  if(!token || !state) return;
  if(__idleWarningVisible || force || swiftNow() - __lastIdleActivityWrite > 1000){
    setSharedActivityNow();
    hideIdleWarning();
    scheduleIdleCheck();
  }
}
const SWIFTTILL_ACTIVITY_EVENTS = ['pointerdown','keydown','wheel','touchstart','click','input','change'];
function startAutoLogoutSecurity(){
  if(!token || !state) return;
  setSharedActivityNow();
  SWIFTTILL_ACTIVITY_EVENTS.forEach(ev => document.removeEventListener(ev, registerUserActivity, true));
  SWIFTTILL_ACTIVITY_EVENTS.forEach(ev => document.addEventListener(ev, registerUserActivity, true));
  document.removeEventListener('visibilitychange', swiftIdleVisibilityCheck, true);
  document.addEventListener('visibilitychange', swiftIdleVisibilityCheck, true);
  window.removeEventListener('storage', swiftIdleStorageSync);
  window.addEventListener('storage', swiftIdleStorageSync);
  scheduleIdleCheck();
}
function stopAutoLogoutSecurity(){
  clearTimeout(__idleLogoutTimer);
  clearInterval(__idleCountdownTimer);
  __idleLogoutTimer = null;
  __idleCountdownTimer = null;
  hideIdleWarning();
  SWIFTTILL_ACTIVITY_EVENTS.forEach(ev => document.removeEventListener(ev, registerUserActivity, true));
}
function swiftIdleVisibilityCheck(){
  if(!document.hidden) scheduleIdleCheck();
}
function swiftIdleStorageSync(e){
  if(e.key === SWIFTTILL_ACTIVITY_KEY) scheduleIdleCheck();
  if(e.key === SWIFTTILL_IDLE_EVENT_KEY && e.newValue){
    localStorage.removeItem('swifttill_token');
    token=''; state=null; currentOrder=null;
    try{ stopLiveSync && stopLiveSync(); }catch{}
    stopAutoLogoutSecurity();
    renderLogin();
  }
}
async function idleLogoutNow(reason='inactivity'){
  if(!token) return;
  const oldToken = token;
  hideIdleWarning();
  try{
    clearTimeout(__cartSaveTimer);
    if(typeof autoSaveCurrentOrder === 'function' && currentOrder?.id && hasOrderLines(currentOrder)) await autoSaveCurrentOrder();
  }catch(e){ console.warn('Pre-logout cart save failed:', e.message); }
  try{
    await fetch('/api/session/logout', { method:'POST', headers:{'Content-Type':'application/json', Authorization:`Bearer ${oldToken}`}, body:JSON.stringify({reason: reason === 'inactivity' ? 'inactivity' : 'manual'}) });
  }catch{}
  try{ localStorage.setItem(SWIFTTILL_IDLE_EVENT_KEY, String(Date.now())); }catch{}
  localStorage.removeItem('swifttill_token');
  sessionStorage.setItem('swifttill_logout_reason', reason === 'inactivity' ? 'Session auto logged out after 12 minutes of inactivity.' : 'Logged out.');
  token=''; state=null; currentOrder=null; mobileBillOpen=false;
  try{ stopLiveSync && stopLiveSync(); }catch{}
  stopAutoLogoutSecurity();
  renderLogin();
}
logout = function(){ idleLogoutNow('manual'); };
const __v47BaseBoot = boot;
boot = async function(){
  await __v47BaseBoot();
  if(token && state) startAutoLogoutSecurity(); else stopAutoLogoutSecurity();
};
const __v47BaseRenderLogin = renderLogin;
renderLogin = function(){
  stopAutoLogoutSecurity();
  __v47BaseRenderLogin();
  const reason = sessionStorage.getItem('swifttill_logout_reason');
  if(reason){
    sessionStorage.removeItem('swifttill_logout_reason');
    const card = document.querySelector('.login-card');
    if(card) card.insertAdjacentHTML('afterbegin', `<div class="idle-login-note">${esc(reason)}</div>`);
  }
};


/* ============================================================
   SwiftTill V48 Tender Close Day UI
   Cash = physical drawer only. Card/Online = tender totals.
============================================================ */
function v48TenderRowHtml(label, x){
  x = x || {};
  return [label, reportMoney(x.sales || 0), reportMoney(x.refunds || 0), reportMoney(x.net || 0)];
}
function v48TenderTable(r){
  const t = r.tenderSummary || {};
  const rows = [
    v48TenderRowHtml('Cash', t.cash),
    v48TenderRowHtml('Card', t.card),
    v48TenderRowHtml('Online', t.online)
  ];
  if((t.other?.sales || t.other?.refunds || t.other?.net)) rows.push(v48TenderRowHtml('Other', t.other));
  return reportTable(['Tender','Sales','Refund','Net'], rows, ['TOTAL', reportMoney(t.all?.sales || 0), reportMoney(t.all?.refunds || 0), reportMoney(t.all?.net || 0)]);
}
function v48CashDrawerTable(r){
  const sh = r.shiftSummary || {};
  return reportTable(['Cash Drawer','Amount'], [
    ['Day', sh.shiftNumber ? `#${sh.shiftNumber} ${sh.businessDate || ''}` : '—'],
    ['Opening Cash Float', reportMoney(sh.openingCash)],
    ['Cash Sales', reportMoney(sh.cashSales)],
    ['Cash Refunds', reportMoney(sh.cashRefunds)],
    ['Expected Drawer Cash', reportMoney(sh.expectedCash)],
    ['Physical Cash Count', sh.countedCash == null ? 'Not closed' : reportMoney(sh.countedCash)],
    ['Cash Difference', sh.difference == null ? 'Not closed' : reportMoney(sh.difference)]
  ]);
}
function v46SummaryBlock(r){
  const s = r.summary || {};
  return `<div class="qb-two-col v46-summary v48-summary"><div>${reportTable(['Sales Summary','Amount'],[
    ['Gross Sales',reportMoney(s.gross)],['Discount',reportMoney(s.discounts)],['Refund',reportMoney(s.refunds)],['Net Sales',reportMoney(s.net)],['Orders',s.orders||0],['Average Bill',reportMoney(s.averageBill)]
  ])}</div><div>${v48TenderTable(r)}</div></div><div class="v48-cash-note">Cash drawer fields are only for physical till cash. Card/Online sales are recorded separately in Tender Summary and do not change drawer difference.</div><div class="qb-two-col v48-cash-row"><div>${v48CashDrawerTable(r)}</div><div>${reportTable(['Non-Cash','Amount'],[
    ['Card Sales', reportMoney((r.shiftSummary||{}).cardSales)],['Card Refunds', reportMoney((r.shiftSummary||{}).cardRefunds)],['Online Sales', reportMoney((r.shiftSummary||{}).onlineSales)],['Online Refunds', reportMoney((r.shiftSummary||{}).onlineRefunds)],['Non-Cash Net', reportMoney((r.shiftSummary||{}).nonCashNet)]
  ])}</div></div>`;
}
function openOpenShift(){
  const today = new Date().toISOString().slice(0,10);
  openModal(`<div class="modal-head"><h2>Open Business Day</h2><button class="x" onclick="closeModal()">×</button></div>
  <p class="muted-note">Sales are grouped by Business Date from opening until day close. Opening Cash Float is the physical cash placed in the drawer at the start of the day; do not include Card or Online sales here.</p>
  <div class="grid2"><div class="field"><label>Business Date</label><input id="businessDate" type="date" value="${today}"></div><div class="field"><label>Opening Cash Float</label><input id="openingCash" type="number" value="0" min="0"><small>Physical drawer cash only. Keep 0 if no cash float is used.</small></div></div>
  <div class="field"><label>Opening Note</label><textarea id="dayNote" rows="2" placeholder="Optional note"></textarea></div>
  <button class="primary-btn" style="width:100%" id="doOpenShift">Open Business Day & Start Billing</button>`);
  $('#doOpenShift').onclick=async()=>{try{await api('/api/day/open',{businessDate:$('#businessDate').value,openingCash:Number($('#openingCash').value||0),note:$('#dayNote').value||''});closeModal();await loadState();renderShell();toast('Business day opened. Billing is now available.');}catch(e){toast(e.message,true);}};
}
function openCloseShift(){
  const d=v46Day();
  if(!d) return openOpenShift();
  const openCount=(state.openOrders||[]).filter(o=>hasOrderLines(o)).length;
  openModal(`<div class="modal-head"><h2>Close Business Day</h2><button class="x" onclick="closeModal()">×</button></div>
  <p class="muted-note">${esc(v46DayLabel(d))}. At Close Day, enter <b>Physical Cash Count</b> from the cash drawer only. Card and Online sales are recorded separately in tender reports.</p>
  ${openCount?`<div class="empty-cart error-state"><b>${openCount} open bill(s)</b><p>Complete, pay, or void all open bills before closing the business day.</p></div>`:''}
  <div class="field"><label>Physical Cash Count</label><input id="countedCash" type="number" value="0" min="0"><small>Enter the actual cash available in the drawer. Do not include Card or Online amounts.</small></div>
  <button class="primary-btn" style="width:100%" id="doCloseShift" ${openCount?'disabled':''}>Close Day</button>`);
  const btn=$('#doCloseShift');
  if(btn) btn.onclick=async()=>{try{const j=await api('/api/day/close',{countedCash:Number($('#countedCash').value||0)});closeModal();await loadState();renderShell();toast(`Business day closed. Cash difference ${money(j.shift.difference)}`);}catch(e){toast(e.message,true);}};
}
function buildThermalReportHtml(r){
  const s=r.summary||{}, sh=r.shiftSummary||{}, t=r.tenderSummary||{}; const title=currentReportTitle();
  let body=`<div class="thermal-report v46-thermal v48-thermal"><div class="tr-center"><b>${esc(reportStoreName())}</b><br>${esc(state?.settings?.branchName||'')}</div><div class="tr-sep"></div>${thermalLine('REPORT',title)}${thermalLine('DAY',sh.businessDate||'')}${thermalLine('OPEN',sh.openedAt?new Date(sh.openedAt).toLocaleString():'')}${thermalLine('CLOSE',sh.closedAt?new Date(sh.closedAt).toLocaleString():'Open')}<div class="tr-sep"></div><div class="tr-title">SUMMARY</div>${thermalLine('Gross',reportMoney(s.gross))}${thermalLine('Discount',reportMoney(s.discounts))}${thermalLine('Refund',reportMoney(s.refunds))}${thermalLine('NET',reportMoney(s.net))}${thermalLine('Orders',s.orders||0)}`;
  if(['daily','payment','x','z','custom'].includes(reportType)) body+=`<div class="tr-sep"></div><div class="tr-title">TENDER SUMMARY</div>${thermalLine('Cash Sales',reportMoney(t.cash?.sales||sh.cashSales))}${thermalLine('Card Sales',reportMoney(t.card?.sales||sh.cardSales))}${thermalLine('Online Sales',reportMoney(t.online?.sales||sh.onlineSales))}${thermalLine('Tender Refund',reportMoney(t.all?.refunds||s.refunds))}${thermalLine('Tender Net',reportMoney(t.all?.net||s.net))}<div class="tr-sep"></div><div class="tr-title">CASH DRAWER ONLY</div>${thermalLine('Opening Float',reportMoney(sh.openingCash))}${thermalLine('Cash Sales',reportMoney(sh.cashSales))}${thermalLine('Cash Refund',reportMoney(sh.cashRefunds))}${thermalLine('Expected Cash',reportMoney(sh.expectedCash))}${thermalLine('Physical Count',sh.countedCash==null?'Not closed':reportMoney(sh.countedCash))}${thermalLine('Cash Diff.',sh.difference==null?'Not closed':reportMoney(sh.difference))}`;
  if(reportType==='itemwise') body+=`<div class="tr-sep"></div>`+thermalTableBlock('ITEM SALES',(r.itemWise||[]).slice(0,25).map(i=>[i.item,`x${i.qty}`,reportMoney(i.net)]),3);
  else if(reportType==='category') body+=`<div class="tr-sep"></div>`+thermalTableBlock('CATEGORY',(r.categoryDetails||[]).slice(0,20).map(c=>[c.category,`x${c.qty}`,reportMoney(c.net)]),3);
  else if(reportType==='ordertype') body+=`<div class="tr-sep"></div>`+thermalTableBlock('ORDER TYPE',(r.orderTypeDetails||[]).map(o=>[formatType(o.type),`${o.orders} bills`,reportMoney(o.net)]),3);
  else if(reportType==='discount') body+=`<div class="tr-sep"></div>`+thermalTableBlock('DISCOUNT',(r.discountWise?.rows||[]).slice(0,25).map(o=>[`#${o.number}`,formatType(o.type),reportMoney(o.discount)]),3);
  else if(reportType==='voidrefund') body+=`<div class="tr-sep"></div>`+thermalTableBlock('VOID/REFUND',reportRefundRows(r).slice(0,25).map(x=>[`${x[0]} #${x[1]}`,x[5],x[4]]),3);
  else body+=`<div class="tr-sep"></div>`+thermalTableBlock('PAYMENTS',reportPaymentRows(r).map(p=>[p[0],`${p[1]} trx`,p[4]]),3);
  body+=`<div class="tr-sep"></div><div class="tr-center small">Cash count excludes Card and Online sales.<br>${esc(state?.settings?.reportFooter || 'Generated by SwiftTill POS')}</div></div>`;
  return body;
}

boot();


/* ============================================================
   SwiftTill V49 Professional Business Day Language
   Client-facing wording cleanup for day open/close screens.
============================================================ */
function businessDayStatusTextV49(status){
  const raw = String(status || 'OPEN').toLowerCase();
  return raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : 'Open';
}
function businessDayDateTextV49(day){
  return day?.businessDate || (day?.openedAt ? new Date(day.openedAt).toLocaleDateString('en-CA') : '');
}
v46DayLabel = function(day=v46Day()){
  if(!day) return 'No Business Day Open';
  return `Business Day ${day.number || ''} · ${businessDayDateTextV49(day)} · ${businessDayStatusTextV49(day.status)}`;
};
const __v49RenderTopbar = renderTopbar;
renderTopbar = function(){
  return __v49RenderTopbar()
    .replaceAll('Open Day before billing.', 'Open a business day before billing.')
    .replaceAll('Back office, reports and day close.', 'Back office, reports and business day close.')
    .replaceAll('Close Day', 'Close Business Day')
    .replaceAll('Open Day', 'Open Business Day');
};
const __v49OpenCloseShift = openCloseShift;
openCloseShift = function(){
  const d=v46Day();
  if(!d) return openOpenShift();
  const openCount=(state.openOrders||[]).filter(o=>hasOrderLines(o)).length;
  openModal(`<div class="modal-head"><h2>Close Business Day</h2><button class="x" onclick="closeModal()">×</button></div>
  <p class="muted-note"><b>${esc(v46DayLabel(d))}</b><br>Enter the physical cash count and close the business day after all open bills are completed, paid, or voided.</p>
  ${openCount?`<div class="empty-cart error-state"><b>${openCount} open bill(s)</b><p>Complete, pay, or void all open bills before closing the business day.</p></div>`:''}
  <div class="field"><label>Physical Cash Count</label><input id="countedCash" type="number" value="0" min="0"><small>Cash drawer only. Card and Online payments are already tracked separately in tender reports.</small></div>
  <button class="primary-btn" style="width:100%" id="doCloseShift" ${openCount?'disabled':''}>Close Business Day</button>`);
  const btn=$('#doCloseShift');
  if(btn) btn.onclick=async()=>{try{const j=await api('/api/day/close',{countedCash:Number($('#countedCash').value||0)});closeModal();await loadState();renderShell();toast(`Business day closed. Cash difference ${money(j.shift.difference)}`);}catch(e){toast(e.message,true);}};
};
const __v49OpenOpenShift = openOpenShift;
openOpenShift = function(){
  const today = v46TodayKey ? v46TodayKey() : new Date().toISOString().slice(0,10);
  openModal(`<div class="modal-head"><h2>Open Business Day</h2><button class="x" onclick="closeModal()">×</button></div>
  <p class="muted-note">Select the business date for sales reporting. Sales remain under this business day until it is closed, even if the restaurant continues after midnight.</p>
  <div class="grid2"><div class="field"><label>Business Date</label><input id="businessDate" type="date" value="${today}"></div><div class="field"><label>Opening Cash Float</label><input id="openingCash" type="number" value="0" min="0"><small>Physical cash placed in the drawer at the start of the day.</small></div></div>
  <div class="field"><label>Opening Note</label><textarea id="dayNote" rows="2" placeholder="Optional note"></textarea></div>
  <button class="primary-btn" style="width:100%" id="doOpenShift">Open Business Day & Start Billing</button>`);
  $('#doOpenShift').onclick=async()=>{try{await api('/api/day/open',{businessDate:$('#businessDate').value,openingCash:Number($('#openingCash').value||0),note:$('#dayNote').value||''});closeModal();await loadState();renderShell();toast('Business day opened. Billing is now available.');}catch(e){toast(e.message,true);}};
};

/* ============================================================
   SwiftTill V50 Print Page Center + Paper Waste Fix
   - browser print isolates #printArea only
   - A4/PDF and thermal output are centered
   - blank trailing pages are prevented
============================================================ */
function v50ReportHasContentRows(rows){ return Array.isArray(rows) && rows.length > 0; }
function v50PaymentRows(r){ try { return reportPaymentRows(r).filter(x => Number(x[1] || 0) || Number(String(x[4] || '').replace(/[^0-9.-]/g,'')) ); } catch { return []; } }
function v50ThermalSection(title, rows, cols=3){
  if(!v50ReportHasContentRows(rows)) return '';
  return `<div class="tr-sep"></div>${thermalTableBlock(title, rows, cols)}`;
}
function v50PreparePrintArea(html, mode='thermal'){
  const area = ensurePrintArea();
  const thermal = mode === 'thermal' || mode === 'receipt' || mode === 'bill';
  const receipt = mode === 'receipt' || mode === 'bill';
  area.className = `print-only v50-print-root ${thermal ? 'print-thermal v46-print-thermal v50-print-thermal' : 'print-a4 v46-print-a4 v50-print-a4'} ${receipt ? 'print-receipt v50-print-receipt' : 'print-report v50-print-report'}`;
  area.innerHTML = `<div class="v50-print-inner">${html}</div>`;
  document.body.classList.remove('v50-print-mode-a4','v50-print-mode-thermal');
  document.body.classList.add('v50-printing', thermal ? 'v50-print-mode-thermal' : 'v50-print-mode-a4');
  const cleanup = () => {
    document.body.classList.remove('v50-printing','v50-print-mode-a4','v50-print-mode-thermal');
    window.removeEventListener('afterprint', cleanup);
  };
  window.addEventListener('afterprint', cleanup);
  return area;
}
function v50BrowserPrint(html, mode='thermal'){
  v50PreparePrintArea(html, mode);
  setTimeout(()=>window.print(),120);
}
const __v50BasePrintReceipt = printReceipt;
printReceipt = async function(r){
  if(!r || !(r.lines||[]).length) return toast('Nothing to print', true);
  const html = receiptHTML(r);
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
  v50BrowserPrint(html, r.unpaid ? 'bill' : 'receipt');
};
buildThermalReportHtml = function(r){
  const s=r.summary||{}, sh=r.shiftSummary||{}, t=r.tenderSummary||{}; const title=currentReportTitle();
  let body=`<div class="thermal-report v46-thermal v48-thermal v50-thermal"><div class="tr-center"><b>${esc(reportStoreName())}</b>${state?.settings?.branchName?`<br>${esc(state.settings.branchName)}`:''}</div><div class="tr-sep"></div>${thermalLine('REPORT',title)}${thermalLine('DAY',sh.businessDate||'')}${sh.openedAt?thermalLine('OPEN',new Date(sh.openedAt).toLocaleString()):''}${thermalLine('CLOSE',sh.closedAt?new Date(sh.closedAt).toLocaleString():'Open')}<div class="tr-sep"></div><div class="tr-title">SUMMARY</div>${thermalLine('Gross',reportMoney(s.gross))}${thermalLine('Discount',reportMoney(s.discounts))}${thermalLine('Refund',reportMoney(s.refunds))}${thermalLine('NET',reportMoney(s.net))}${thermalLine('Orders',s.orders||0)}`;
  if(['daily','payment','x','z','custom'].includes(reportType)){
    body+=`<div class="tr-sep"></div><div class="tr-title">TENDER SUMMARY</div>${thermalLine('Cash Sales',reportMoney(t.cash?.sales||sh.cashSales))}${thermalLine('Card Sales',reportMoney(t.card?.sales||sh.cardSales))}${thermalLine('Online Sales',reportMoney(t.online?.sales||sh.onlineSales))}${thermalLine('Tender Net',reportMoney(t.all?.net||s.net))}`;
    body+=`<div class="tr-sep"></div><div class="tr-title">CASH DRAWER</div>${thermalLine('Opening Float',reportMoney(sh.openingCash))}${thermalLine('Expected Cash',reportMoney(sh.expectedCash))}${thermalLine('Physical Count',sh.countedCash==null?'Not closed':reportMoney(sh.countedCash))}${thermalLine('Cash Diff.',sh.difference==null?'Not closed':reportMoney(sh.difference))}`;
  }
  if(reportType==='itemwise') body+=v50ThermalSection('ITEM SALES',(r.itemWise||[]).slice(0,25).map(i=>[i.item,`x${i.qty}`,reportMoney(i.net)]),3);
  else if(reportType==='category') body+=v50ThermalSection('CATEGORY',(r.categoryDetails||[]).slice(0,20).map(c=>[c.category,`x${c.qty}`,reportMoney(c.net)]),3);
  else if(reportType==='ordertype') body+=v50ThermalSection('ORDER TYPE',(r.orderTypeDetails||[]).map(o=>[formatType(o.type),`${o.orders} bills`,reportMoney(o.net)]),3);
  else if(reportType==='discount') body+=v50ThermalSection('DISCOUNT',(r.discountWise?.rows||[]).slice(0,25).map(o=>[`#${o.number}`,formatType(o.type),reportMoney(o.discount)]),3);
  else if(reportType==='voidrefund') body+=v50ThermalSection('VOID/REFUND',reportRefundRows(r).slice(0,25).map(x=>[`${x[0]} #${x[1]}`,x[5],x[4]]),3);
  else {
    const payments = v50PaymentRows(r).map(p=>[p[0],`${p[1]} trx`,p[4]]);
    body+=v50ThermalSection('PAYMENTS', payments, 3);
  }
  body+=`<div class="tr-sep"></div><div class="tr-center small">${esc(state?.settings?.reportFooter || 'Generated by SwiftTill POS')}</div></div>`;
  return body;
};
const __v50BaseBuildA4ReportHtml = buildA4ReportHtml;
buildA4ReportHtml = function(r){
  const html = __v50BaseBuildA4ReportHtml(r);
  return String(html).replace('class="report-a4 qb-a4', 'class="report-a4 qb-a4 v50-a4');
};
printReportHtml = async function(mode='thermal'){
  const r=window.swiftLastReport;
  if(!r) return toast('Run report first.', true);
  const thermal=mode==='thermal';
  const html=thermal?buildThermalReportHtml(r):buildA4ReportHtml(r);
  if(thermal && state?.printAgent?.cloudQueueConfigured){
    try{
      const queued=await api('/api/print-jobs',{type:'report',html,text:thermalReportText(r)});
      if(queued?.queued){ toast('Thermal report sent to cloud print queue'); return; }
    }catch(e){ toast('Cloud report queue failed; browser print opened', true); }
  }
  v50BrowserPrint(html, thermal ? 'thermal' : 'a4');
};
printReportArea = function(){ return printReportHtml('a4'); };


/* ============================================================
   SwiftTill V51 Deep Clean UX + Builder Audit
   - Search/filter inputs no longer lose focus while typing
   - Form caret/selection is preserved across safe re-renders
   - Admin filter lists update tbody only instead of rebuilding controls
   - Client-facing button/input polish guards for PC + mobile
============================================================ */
const SWIFTTILL_V51 = {
  version: '51.0.0-deep-clean-ux-builder-audit',
  searchInputFocusStable: true,
  adminFiltersNoBlur: true,
  formCaretPreserved: true,
  buttonContentVisibilityAudit: true,
  onlineOnly: true
};
window.SWIFTTILL_V51 = SWIFTTILL_V51;

function v51IsEditable(el){
  return !!el && ['INPUT','TEXTAREA','SELECT'].includes(el.tagName) && !el.disabled && !el.readOnly;
}
function v51StableSelector(el){
  if(!el) return '';
  if(el.id) return `#${CSS.escape(el.id)}`;
  if(el.name) return `${el.tagName.toLowerCase()}[name="${CSS.escape(el.name)}"]`;
  for(const a of ['data-qty-input','data-admin-edit','data-admin-delete']){
    const v = el.getAttribute?.(a);
    if(v) return `${el.tagName.toLowerCase()}[${a}="${CSS.escape(v)}"]`;
  }
  return '';
}
function v51CaptureFocus(){
  const el = document.activeElement;
  if(!v51IsEditable(el)) return null;
  return {
    selector: v51StableSelector(el),
    tag: el.tagName,
    value: el.value,
    start: typeof el.selectionStart === 'number' ? el.selectionStart : null,
    end: typeof el.selectionEnd === 'number' ? el.selectionEnd : null,
    scrollX: window.scrollX,
    scrollY: window.scrollY
  };
}
function v51RestoreFocus(cap){
  if(!cap || !cap.selector) return;
  const restore = () => {
    const el = document.querySelector(cap.selector);
    if(!v51IsEditable(el)) return;
    try{ el.focus({ preventScroll:true }); }catch{ try{ el.focus(); }catch{} }
    if(typeof el.setSelectionRange === 'function' && cap.start !== null){
      const len = String(el.value || '').length;
      const start = Math.min(cap.start, len);
      const end = Math.min(cap.end ?? cap.start, len);
      try{ el.setSelectionRange(start, end); }catch{}
    }
    try{ window.scrollTo(cap.scrollX || 0, cap.scrollY || 0); }catch{}
  };
  restore();
  requestAnimationFrame(restore);
}
function v51WithFocus(fn){
  return function(...args){
    const cap = v51CaptureFocus();
    const out = fn.apply(this,args);
    v51RestoreFocus(cap);
    return out;
  };
}

// Keep POS menu search text stable even when other UI sections are refreshed.
window.swiftMenuSearchTerm ||= '';
const __v51BaseRenderSidebar = renderSidebar;
renderSidebar = function(){
  const html = __v51BaseRenderSidebar();
  const val = esc(window.swiftMenuSearchTerm || '');
  return html.replace('id="menuSearch" placeholder="Search menu items..."', `id="menuSearch" value="${val}" placeholder="Search menu items..." autocomplete="off" spellcheck="false"`)
             .replace('id="menuSearch" placeholder="Search menu items..." disabled', `id="menuSearch" value="${val}" placeholder="Search menu items..." autocomplete="off" spellcheck="false" disabled`);
};
const __v51BaseBindSidebar = bindSidebar;
bindSidebar = function(){
  __v51BaseBindSidebar();
  const search = $('#menuSearch');
  if(search){
    search.value = window.swiftMenuSearchTerm || search.value || '';
    search.oninput = e => {
      window.swiftMenuSearchTerm = e.target.value;
      screen='pos'; centerMode='menu';
      renderMenu(window.swiftMenuSearchTerm);
      v51RestoreFocus({selector:'#menuSearch',start:e.target.selectionStart,end:e.target.selectionEnd,scrollX:window.scrollX,scrollY:window.scrollY});
    };
  }
};
const __v51BaseRenderMenu = renderMenu;
renderMenu = function(q=''){
  window.swiftMenuSearchTerm = q || window.swiftMenuSearchTerm || '';
  return __v51BaseRenderMenu(window.swiftMenuSearchTerm);
};

function v51AdminRowsHtml(key, apiName, fields, rows){
  return rows.map(r=>`<tr><td>${r.imageUrl?`<img class="thumb admin-thumb" src="${esc(r.imageUrl)}" alt="">`:''}</td>${fields.map(f=>`<td>${adminCell(r,f)}</td>`).join('')}<td><div class="row-actions"><button class="ghost-btn tiny" data-admin-edit="${esc(r.id)}">Edit</button><button class="danger-btn tiny" data-admin-delete="${esc(r.id)}">Delete</button></div></td></tr>`).join('') || `<tr><td colspan="${fields.length+2}" class="empty-td">No records match these filters.</td></tr>`;
}
function v51BindAdminRowActions(c,key,apiName){
  $$('[data-admin-edit]', c).forEach(b=>b.onclick=()=>{ const record=(state[key]||[]).find(x=>x.id===b.dataset.adminEdit); if(record) openAdminEditor(apiName, clone(record)); });
  $$('[data-admin-delete]', c).forEach(b=>b.onclick=()=>deleteAdminRecord(apiName,b.dataset.adminDelete));
}
function v51DrawAdminRows(c,key,apiName,fields){
  const allRows = state[key] || [];
  const rows = adminApplyRows(key, allRows);
  const count = $('#adminListCount', c);
  if(count) count.textContent = `${rows.length} shown from ${allRows.length}. Filters update without leaving the field.`;
  const tbody = $('#adminListRows', c);
  if(tbody) tbody.innerHTML = v51AdminRowsHtml(key, apiName, fields, rows);
  v51BindAdminRowActions(c,key,apiName);
}
adminList = function(c,key,apiName,fields){
  const allRows=state[key]||[];
  const rows=adminApplyRows(key, allRows);
  c.innerHTML=`<div class="admin-wrap v30-admin-list v51-admin-list"><div class="module-title"><div><h3>${esc(labelTab(key))}</h3><p class="muted-note" id="adminListCount">${rows.length} shown from ${allRows.length}. Filters update without leaving the field.</p></div><button class="primary-btn" type="button" onclick="openAdminEditor('${apiName}')">Add New</button></div>${adminListControls(key)}<div class="report-table-wrap admin-table-shell"><table class="admin-table"><thead><tr><th>Image</th>${fields.map(f=>`<th>${esc(f==='categoryId'?'Category':f==='roleIds'?'Roles':f)}</th>`).join('')}<th>Action</th></tr></thead><tbody id="adminListRows">${v51AdminRowsHtml(key, apiName, fields, rows)}</tbody></table></div></div>`;
  const f=adminListFilters(key);
  const search = $('#adminSearchFilter', c);
  if(search){
    search.setAttribute('autocomplete','off');
    search.setAttribute('spellcheck','false');
    search.addEventListener('input', e=>{
      f.search = e.target.value;
      const cap={selector:'#adminSearchFilter',start:e.target.selectionStart,end:e.target.selectionEnd,scrollX:window.scrollX,scrollY:window.scrollY};
      v51DrawAdminRows(c,key,apiName,fields);
      v51RestoreFocus(cap);
    });
  }
  $('#adminCategoryFilter', c)?.addEventListener('change', e=>{ f.category=e.target.value; v51DrawAdminRows(c,key,apiName,fields); });
  $('#adminActiveFilter', c)?.addEventListener('change', e=>{ f.active=e.target.value; v51DrawAdminRows(c,key,apiName,fields); });
  $('#adminSortFilter', c)?.addEventListener('change', e=>{ f.sort=e.target.value; v51DrawAdminRows(c,key,apiName,fields); });
  v51BindAdminRowActions(c,key,apiName);
};

// Preserve active input/caret for bill and report controls that intentionally re-render small panels.
renderBill = v51WithFocus(renderBill);
renderWorkspace = v51WithFocus(renderWorkspace);
renderAdminContent = v51WithFocus(renderAdminContent);

// Builder-level light runtime guard: prevent Enter in search/filter inputs from submitting or blurring unexpectedly.
document.addEventListener('keydown', function(e){
  const el=e.target;
  if(!el) return;
  if(e.key === 'Enter' && (el.id === 'menuSearch' || el.id === 'adminSearchFilter')){
    e.preventDefault();
    v51RestoreFocus({selector:'#'+el.id,start:el.selectionStart,end:el.selectionEnd,scrollX:window.scrollX,scrollY:window.scrollY});
  }
}, true);


/* ============================================================
   SwiftTill V52 Client-Facing Admin Cleanup
   - remove unsupported image columns from modules that do not use media
   - keep media only for categories/items/deals where POS actually displays it
   - professional column labels and module-specific tables
   - sanitize accidental non-media image fields before save
============================================================ */
const V52_MEDIA_ADMIN_KEYS = new Set(['categories','items','deals']);
const V52_MEDIA_ADMIN_API = new Set(['category','item','deal']);
function v52AdminSupportsImage(key, apiName){ return V52_MEDIA_ADMIN_KEYS.has(key) || V52_MEDIA_ADMIN_API.has(apiName); }
function v52ColumnLabel(f){
  return ({
    name:'Name', categoryId:'Category', price:'Price', active:'Status', soldOut:'Sold Out',
    sort:'Sort Order', seats:'Seats', roleIds:'Roles', email:'Email', description:'Description', permissions:'Permissions'
  })[f] || String(f||'').replace(/([A-Z])/g,' $1').replace(/^./,c=>c.toUpperCase());
}
function v52AdminRowsHtml(key, apiName, fields, rows){
  const hasImage = v52AdminSupportsImage(key, apiName);
  const colCount = fields.length + (hasImage ? 2 : 1);
  return rows.map(r=>`<tr>${hasImage?`<td class="media-col">${r.imageUrl?`<img class="thumb admin-thumb" src="${esc(r.imageUrl)}" alt="${esc(r.name||'Image')}">`:''}</td>`:''}${fields.map(f=>`<td>${adminCell(r,f)}</td>`).join('')}<td><div class="row-actions"><button class="ghost-btn tiny" type="button" data-admin-edit="${esc(r.id)}">Edit</button><button class="danger-btn tiny" type="button" data-admin-delete="${esc(r.id)}">Delete</button></div></td></tr>`).join('') || `<tr><td colspan="${colCount}" class="empty-td">No records match these filters.</td></tr>`;
}
function v52DrawAdminRows(c,key,apiName,fields){
  const allRows = state[key] || [];
  const rows = adminApplyRows(key, allRows);
  const count = $('#adminListCount', c);
  if(count) count.textContent = `${rows.length} ${labelTab(key).toLowerCase()} shown from ${allRows.length}.`;
  const tbody = $('#adminListRows', c);
  if(tbody) tbody.innerHTML = v52AdminRowsHtml(key, apiName, fields, rows);
  v51BindAdminRowActions(c,key,apiName);
}
function v52AdminHelperText(key, apiName){
  const media = v52AdminSupportsImage(key, apiName) ? 'Image upload is available because this module is shown visually in POS.' : 'Only fields used by this module are shown.';
  return `${media} Filters update without losing focus.`;
}
adminList = function(c,key,apiName,fields){
  const allRows=state[key]||[];
  const rows=adminApplyRows(key, allRows);
  const hasImage = v52AdminSupportsImage(key, apiName);
  c.innerHTML=`<div class="admin-wrap v30-admin-list v51-admin-list v52-admin-list ${hasImage?'has-media':'no-media'}"><div class="module-title"><div><h3>${esc(labelTab(key))}</h3><p class="muted-note" id="adminListCount">${rows.length} ${esc(labelTab(key).toLowerCase())} shown from ${allRows.length}. ${esc(v52AdminHelperText(key, apiName))}</p></div><button class="primary-btn" type="button" onclick="openAdminEditor('${apiName}')">Add New</button></div>${adminListControls(key)}<div class="report-table-wrap admin-table-shell"><table class="admin-table admin-table-${esc(key)} ${hasImage?'has-media':'no-media'}"><thead><tr>${hasImage?'<th class="media-col">Image</th>':''}${fields.map(f=>`<th>${esc(v52ColumnLabel(f))}</th>`).join('')}<th>Action</th></tr></thead><tbody id="adminListRows">${v52AdminRowsHtml(key, apiName, fields, rows)}</tbody></table></div></div>`;
  const f=adminListFilters(key);
  const search = $('#adminSearchFilter', c);
  if(search){
    search.setAttribute('autocomplete','off');
    search.setAttribute('spellcheck','false');
    search.addEventListener('input', e=>{
      f.search = e.target.value;
      const cap={selector:'#adminSearchFilter',start:e.target.selectionStart,end:e.target.selectionEnd,scrollX:window.scrollX,scrollY:window.scrollY};
      v52DrawAdminRows(c,key,apiName,fields);
      v51RestoreFocus(cap);
    });
  }
  $('#adminCategoryFilter', c)?.addEventListener('change', e=>{ f.category=e.target.value; v52DrawAdminRows(c,key,apiName,fields); });
  $('#adminActiveFilter', c)?.addEventListener('change', e=>{ f.active=e.target.value; v52DrawAdminRows(c,key,apiName,fields); });
  $('#adminSortFilter', c)?.addEventListener('change', e=>{ f.sort=e.target.value; v52DrawAdminRows(c,key,apiName,fields); });
  v51BindAdminRowActions(c,key,apiName);
};

const __v52BaseOpenAdminEditor = openAdminEditor;
openAdminEditor = function(kind, record={}){
  if(!V52_MEDIA_ADMIN_API.has(kind) && record && typeof record === 'object' && 'imageUrl' in record){
    record = {...record};
    delete record.imageUrl;
  }
  return __v52BaseOpenAdminEditor(kind, record);
};

document.documentElement.classList.add('v52-admin-cleanup');


/* ============================================================
   SwiftTill V53 Search/Filters/Open Order Void
   - Paid Orders: search, date range, type, payment, sort
   - Open Orders: search, type, date range, sort + POS void/cancel
   - Manager/Admin approval via permission, PIN or password
   - Online-only mode preserved. Offline concept removed.
============================================================ */
const SWIFTTILL_V53 = {
  version: '53.0.0-filters-open-order-void-access',
  paidOrdersFilters: true,
  paidOrdersSorting: true,
  openOrdersFilters: true,
  openOrderVoidCancel: true,
  managerAdminApprovalForVoid: true,
  onlineOnly: true
};
window.SWIFTTILL_V53 = SWIFTTILL_V53;
window.swiftPaidOrderFilters ||= { search:'', from:'', to:'', type:'ALL', payment:'ALL', sort:'paidAt_desc' };
window.swiftOpenOrderFilters ||= { search:'', from:'', to:'', type:'ALL', sort:'oldest' };

function v53DateValue(iso){
  if(!iso) return '';
  const d = new Date(iso);
  if(Number.isNaN(d.getTime())) return String(iso).slice(0,10);
  const local = new Date(d.getTime() - d.getTimezoneOffset()*60000);
  return local.toISOString().slice(0,10);
}
function v53InDateRange(iso, from, to){
  const val = v53DateValue(iso);
  if(from && val < from) return false;
  if(to && val > to) return false;
  return true;
}
function v53OrderSearchText(o){
  const table = state.tables?.find(t=>t.id===o.tableId)?.name || '';
  const pays = (o.payments||[]).map(p=>`${p.method||''} ${p.reference||''}`).join(' ');
  return [o.number,o.type,table,o.customerName,o.mobile,o.address,o.orderTakerName,o.cashierName,o.businessDate,pays].join(' ').toLowerCase();
}
function v53PaymentMatch(o, payment){
  if(!payment || payment === 'ALL') return true;
  return (o.payments||[]).some(p=>String(p.method||'').toUpperCase() === payment);
}
function v53SortOrders(rows, sort){
  const list=[...rows];
  const byDate = o => new Date(o.paidAt || o.createdAt || 0).getTime() || 0;
  const byOpen = o => new Date(o.createdAt || o.updatedAt || 0).getTime() || 0;
  const byTotal = o => Number(calcTotals(o).total || 0);
  const num = o => Number(String(o.number||'').replace(/\D/g,'')) || 0;
  return list.sort((a,b)=>{
    if(sort==='paidAt_asc') return byDate(a)-byDate(b);
    if(sort==='total_desc') return byTotal(b)-byTotal(a);
    if(sort==='total_asc') return byTotal(a)-byTotal(b);
    if(sort==='bill_desc') return num(b)-num(a);
    if(sort==='bill_asc') return num(a)-num(b);
    if(sort==='newest') return byOpen(b)-byOpen(a);
    if(sort==='oldest') return byOpen(a)-byOpen(b);
    return byDate(b)-byDate(a);
  });
}
function v53PaidFilterControls(f){
  return `<div class="admin-filterbar card v53-filterbar">
    <div class="field admin-filter-field search-field"><label>Search</label><input id="paidSearchFilter" value="${esc(f.search||'')}" placeholder="Bill, customer, mobile, table..." autocomplete="off" spellcheck="false"></div>
    <div class="field admin-filter-field"><label>From</label><input id="paidFromFilter" type="date" value="${esc(f.from||'')}"></div>
    <div class="field admin-filter-field"><label>To</label><input id="paidToFilter" type="date" value="${esc(f.to||'')}"></div>
    <div class="field admin-filter-field"><label>Order Type</label><select id="paidTypeFilter"><option value="ALL">All</option><option value="DINE_IN">Dine In</option><option value="DELIVERY">Delivery</option><option value="TAKEAWAY">Takeaway</option></select></div>
    <div class="field admin-filter-field"><label>Payment</label><select id="paidPaymentFilter"><option value="ALL">All</option><option value="CASH">Cash</option><option value="CARD">Card</option><option value="ONLINE">Online</option></select></div>
    <div class="field admin-filter-field"><label>Sort By</label><select id="paidSortFilter"><option value="paidAt_desc">Latest paid first</option><option value="paidAt_asc">Oldest paid first</option><option value="bill_desc">Bill no. high to low</option><option value="bill_asc">Bill no. low to high</option><option value="total_desc">Total high to low</option><option value="total_asc">Total low to high</option></select></div>
  </div>`;
}
function v53PaidRows(){
  const f=window.swiftPaidOrderFilters;
  const q=String(f.search||'').toLowerCase().trim();
  let rows=(state.paidOrders||[]).filter(o=>{
    if(q && !v53OrderSearchText(o).includes(q)) return false;
    if(!v53InDateRange(o.paidAt||o.createdAt, f.from, f.to)) return false;
    if(f.type && f.type!=='ALL' && o.type !== f.type) return false;
    if(!v53PaymentMatch(o, f.payment)) return false;
    return true;
  });
  return v53SortOrders(rows, f.sort || 'paidAt_desc');
}
function v53PaidTableHtml(rows){
  return `<div class="report-table-wrap admin-table-shell"><table class="admin-table paid-orders-table"><thead><tr><th>Bill</th><th>Paid Date</th><th>Type</th><th>Table</th><th>Customer</th><th>Total</th><th>Payment</th><th>Action</th></tr></thead><tbody id="paidOrderRows">${rows.map(o=>{ const tt=calcTotals(o); const table=state.tables.find(t=>t.id===o.tableId)?.name||'—'; const payments=(o.payments||[]).map(p=>`${p.method} ${money(p.amount)}`).join(', ') || '—'; return `<tr><td><b>#${esc(o.number||'Draft')}</b></td><td>${esc(new Date(o.paidAt||o.createdAt).toLocaleString())}</td><td>${formatType(o.type)}</td><td>${esc(table)}</td><td>${esc(o.customerName||o.mobile||'Walk-in')}</td><td><b>${money(tt.total)}</b></td><td>${esc(payments)}</td><td><div class="row-actions paid-actions"><button class="ghost-btn tiny" type="button" data-paid-view="${esc(o.id)}">View</button><button class="ghost-btn tiny" type="button" data-paid-correct="${esc(o.id)}">Change Payment</button><button class="danger-btn tiny" type="button" data-paid-refund="${esc(o.id)}">Refund</button><button class="secondary-btn tiny" type="button" data-paid-reopen="${esc(o.id)}">Reopen/Edit</button></div></td></tr>`; }).join('') || '<tr><td colspan="8" class="empty-td">No paid orders match these filters.</td></tr>'}</tbody></table></div>`;
}
function v53RefreshPaidOrders(c){
  const rows=v53PaidRows();
  const count=$('#paidOrderCount', c);
  if(count) count.textContent = `${rows.length} paid orders shown from ${(state.paidOrders||[]).length}.`;
  const wrap=$('#paidOrderTableWrap', c);
  if(wrap) wrap.innerHTML=v53PaidTableHtml(rows);
  v53BindPaidActions(rows);
}
function v53BindPaidActions(rows){
  $$('[data-paid-view]').forEach(b=>b.onclick=()=>{ const o=(state.paidOrders||[]).find(x=>x.id===b.dataset.paidView); if(!o)return; const r=receiptFromOrder(o); showReceiptModal(r,false); });
  $$('[data-paid-refund]').forEach(b=>b.onclick=()=>openRefundModal(b.dataset.paidRefund));
  $$('[data-paid-correct]').forEach(b=>b.onclick=()=>openPaymentCorrectionModal(b.dataset.paidCorrect));
  $$('[data-paid-reopen]').forEach(b=>b.onclick=()=>openReopenPaidModal(b.dataset.paidReopen));
}
renderPaidOrders = function(c){
  const f=window.swiftPaidOrderFilters;
  const rows=v53PaidRows();
  c.innerHTML=`<div class="module-title"><div><h3>Paid Orders</h3><p class="muted-note" id="paidOrderCount">${rows.length} paid orders shown from ${(state.paidOrders||[]).length}. Use search, date range, filters and sorting for audit work.</p></div></div>${v53PaidFilterControls(f)}<div class="card subcard" id="paidOrderTableWrap">${v53PaidTableHtml(rows)}</div>`;
  $('#paidTypeFilter', c).value=f.type||'ALL';
  $('#paidPaymentFilter', c).value=f.payment||'ALL';
  $('#paidSortFilter', c).value=f.sort||'paidAt_desc';
  const bind=(id,key)=>{ const el=$('#'+id,c); if(!el) return; el.addEventListener(el.tagName==='INPUT'?'input':'change', e=>{ f[key]=e.target.value; const cap={selector:'#'+id,start:e.target.selectionStart,end:e.target.selectionEnd,scrollX:window.scrollX,scrollY:window.scrollY}; v53RefreshPaidOrders(c); v51RestoreFocus(cap); }); };
  bind('paidSearchFilter','search'); bind('paidFromFilter','from'); bind('paidToFilter','to'); bind('paidTypeFilter','type'); bind('paidPaymentFilter','payment'); bind('paidSortFilter','sort');
  v53BindPaidActions(rows);
};

function v53OpenControls(f){
  return `<div class="admin-filterbar card v53-filterbar open-filterbar">
    <div class="field admin-filter-field search-field"><label>Search</label><input id="openSearchFilter" value="${esc(f.search||'')}" placeholder="Bill, table, customer, order taker..." autocomplete="off" spellcheck="false"></div>
    <div class="field admin-filter-field"><label>From</label><input id="openFromFilter" type="date" value="${esc(f.from||'')}"></div>
    <div class="field admin-filter-field"><label>To</label><input id="openToFilter" type="date" value="${esc(f.to||'')}"></div>
    <div class="field admin-filter-field"><label>Order Type</label><select id="openTypeFilter"><option value="ALL">All</option><option value="DINE_IN">Dine In</option><option value="DELIVERY">Delivery</option><option value="TAKEAWAY">Takeaway</option></select></div>
    <div class="field admin-filter-field"><label>Sort By</label><select id="openSortFilter"><option value="oldest">Oldest open first</option><option value="newest">Newest open first</option><option value="bill_desc">Bill no. high to low</option><option value="bill_asc">Bill no. low to high</option><option value="total_desc">Total high to low</option><option value="total_asc">Total low to high</option></select></div>
  </div>`;
}
function v53OpenRows(){
  const f=window.swiftOpenOrderFilters;
  const q=String(f.search||'').toLowerCase().trim();
  let rows=(state.openOrders||[]).filter(o=>{
    if(q && !v53OrderSearchText(o).includes(q)) return false;
    if(!v53InDateRange(o.createdAt||o.updatedAt, f.from, f.to)) return false;
    if(f.type && f.type!=='ALL' && o.type !== f.type) return false;
    return true;
  });
  return v53SortOrders(rows, f.sort || 'oldest');
}
function v53OpenListHtml(rows){
  return rows.length ? rows.map(o=>`<div class="open-order v53-open-order" data-open-card="${esc(o.id)}"><button class="open-order-main" type="button" data-open-id="${esc(o.id)}"><div><h4>#${esc(o.number||'Draft')} • ${formatType(o.type)} • ${esc(orderContext(o))}</h4><p>${esc(o.orderTakerName||o.customerName||'')} • <span data-live-timer="${esc(o.createdAt)}">${elapsedClock(o.createdAt)}</span> • ${o.lines?.length||0} lines</p></div><b>${money(calcTotals(o).total)}</b></button><div class="open-order-actions"><button class="ghost-btn tiny" type="button" data-open-edit="${esc(o.id)}">Open/Edit</button><button class="danger-btn tiny" type="button" data-open-void="${esc(o.id)}">Void / Cancel</button></div></div>`).join('') : `<div class="empty-cart">No open orders match these filters.</div>`;
}
function v53RefreshOpenOrders(){
  const rows=v53OpenRows();
  const count=$('#openOrderCount');
  if(count) count.textContent = `${rows.length} open orders shown from ${(state.openOrders||[]).length}.`;
  const list=$('#openList');
  if(list) list.innerHTML=v53OpenListHtml(rows);
  v53BindOpenActions();
}
function v53OpenOrder(orderId){
  const o=state.openOrders.find(x=>x.id===orderId);
  if(o){ currentOrder=clone(o); centerMode='menu'; renderShell(); }
}
function v53BindOpenActions(){
  $$('[data-open-id], [data-open-edit]').forEach(b=>b.onclick=()=>v53OpenOrder(b.dataset.openId || b.dataset.openEdit));
  $$('[data-open-void]').forEach(b=>b.onclick=(e)=>{ e.stopPropagation(); openVoidOrderModal(b.dataset.openVoid); });
}
renderOpenOrders = function(){
  const f=window.swiftOpenOrderFilters;
  const rows=v53OpenRows();
  $('#centerScroll').innerHTML = `<div class="card subcard"><div class="module-title"><div><h3>Open Orders</h3><p class="muted-note" id="openOrderCount">${rows.length} open orders shown from ${(state.openOrders||[]).length}. Authorized users can void/cancel from POS.</p></div><button class="ghost-btn" onclick="openNewOrderModal()">New Order</button></div>${v53OpenControls(f)}<div id="openList" class="v53-open-list">${v53OpenListHtml(rows)}</div></div>`;
  $('#openTypeFilter').value=f.type||'ALL';
  $('#openSortFilter').value=f.sort||'oldest';
  const bind=(id,key)=>{ const el=$('#'+id); if(!el) return; el.addEventListener(el.tagName==='INPUT'?'input':'change', e=>{ f[key]=e.target.value; const cap={selector:'#'+id,start:e.target.selectionStart,end:e.target.selectionEnd,scrollX:window.scrollX,scrollY:window.scrollY}; v53RefreshOpenOrders(); v51RestoreFocus(cap); }); };
  bind('openSearchFilter','search'); bind('openFromFilter','from'); bind('openToFilter','to'); bind('openTypeFilter','type'); bind('openSortFilter','sort');
  v53BindOpenActions();
};

function openVoidOrderModal(orderId){
  const o=(state.openOrders||[]).find(x=>x.id===orderId) || (currentOrder && currentOrder.id===orderId ? currentOrder : null);
  if(!o) return toast('Open order not found', true);
  const t=calcTotals(o);
  openModal(`<div class="modal-head"><h2>Void / Cancel Bill #${esc(o.number||'Draft')}</h2><button class="x" onclick="closeModal()">×</button></div>
    <p class="muted-note">Use this only for open/held bills that should not be paid. Paid bills must use Refund.</p>
    <div class="pay-total-card"><span>Bill Total</span><b>${money(t.total)}</b></div>
    <div class="field"><label>Reason</label><input id="voidReason" value="Customer cancelled / order mistake"></div>
    <div class="grid2"><div class="field"><label>Manager PIN</label><input id="voidPin" type="password" placeholder="Optional if approver login is used"></div><div class="field"><label>Approver Email</label><input id="voidEmail" type="email" placeholder="Manager/Admin email"></div></div>
    <div class="field"><label>Approver Password</label><input id="voidPassword" type="password" placeholder="Manager/Admin password"></div>
    <button class="danger-btn" id="doVoidOrder" style="width:100%">Void / Cancel Bill</button>`);
  $('#doVoidOrder').onclick=async()=>{
    try{
      await api('/api/orders/void',{id:orderId,reason:$('#voidReason').value,managerPin:$('#voidPin').value,approverEmail:$('#voidEmail').value,approverPassword:$('#voidPassword').value});
      if(currentOrder && currentOrder.id===orderId) currentOrder=null;
      closeModal(); await loadState(); screen='pos'; centerMode='open'; renderShell(); toast('Bill voided / cancelled');
    }catch(e){ toast(e.message,true); }
  };
}

const __v53BaseRenderBill = renderBill;
renderBill = function(){
  __v53BaseRenderBill();
  if(currentOrder && hasOrderLines(currentOrder)){
    const row=document.querySelector('.bill-quick-actions');
    if(row){ row.classList.add('v54-bill-action-bar'); }
    if(row && !row.querySelector('#voidCurrentOrderBtn')){
      const btn=document.createElement('button');
      btn.className='danger-btn mini-action void-mini';
      btn.id='voidCurrentOrderBtn';
      btn.type='button';
      btn.innerHTML='<span>Void</span><span class="v54-cancel-word"> / Cancel</span>';
      btn.setAttribute('aria-label','Void / Cancel Bill');
      btn.title='Void / Cancel Bill';
      btn.onclick=()=>openVoidOrderModal(currentOrder.id);
      row.appendChild(btn);
    }
  }
};

document.addEventListener('keydown', function(e){
  const el=e.target;
  if(!el) return;
  if(e.key === 'Enter' && ['paidSearchFilter','openSearchFilter'].includes(el.id)){
    e.preventDefault();
    v51RestoreFocus({selector:'#'+el.id,start:el.selectionStart,end:el.selectionEnd,scrollX:window.scrollX,scrollY:window.scrollY});
  }
}, true);

document.documentElement.classList.add('v53-filter-void-audit');


/* ============================================================
   SwiftTill V55 Functionality Stabilization + Regression Audit
   - Keep newly created draft order on billing screen.
   - Live sync must not clear a local draft before item selection.
   - Surgical patch only: no unrelated POS/Admin screen redesign.
============================================================ */
const SWIFTTILL_V55 = {
  version: '55.0.0-functionality-stabilization-audit',
  createOrderStayOnBilling: true,
  draftOrderNotRemoteCleared: true,
  surgicalClientPatch: true,
  regressionAudit: true,
  onlineOnly: true
};
window.SWIFTTILL_V55 = SWIFTTILL_V55;

function v55OrderIsDraftWithoutLines(order){
  return !!order && String(order.status || '').toUpperCase() === 'DRAFT' && !hasOrderLines(order);
}
function v55RefreshBillOnly(){
  try{
    if(screen === 'pos'){
      renderBill();
      const fab = $('#mobileCartFab b');
      if(fab) fab.textContent = mobileCartSummary();
      const pay = $('#mobilePayBill');
      if(pay) pay.textContent = currentOrder && hasOrderLines(currentOrder) ? 'Pay Now' : 'Open Bill';
    }
  }catch(e){ console.warn('SwiftTill V55 bill refresh skipped:', e.message); }
}
function v55KeepDraftOrderAlive(sync){
  if(!v55OrderIsDraftWithoutLines(currentOrder)) return false;
  const id = currentOrder.id;
  const current = sync?.currentOrder || null;
  const status = String(current?.status || currentOrder.status || '').toUpperCase();
  const paid = status === 'PAID' || (state?.paidOrders || []).some(o => o.id === id);
  const terminal = ['PAID','VOID','CANCELLED','REFUNDED','CLOSED'].includes(status);
  if(paid || terminal) return false;
  // DRAFT orders are intentionally not part of openOrders until an item is added.
  // Therefore cross-device polling must not treat missing openOrders entry as a closed bill.
  if(current && current.id === id){
    currentOrder.status = current.status || currentOrder.status || 'DRAFT';
    currentOrder.number = current.number && current.number !== 'Draft' ? current.number : (currentOrder.number || '');
  }
  return true;
}

if(typeof reconcileRemoteState === 'function'){
  const __v55BaseReconcileRemoteState = reconcileRemoteState;
  reconcileRemoteState = function(sync){
    if(v55KeepDraftOrderAlive(sync)){
      v55RefreshBillOnly();
      return;
    }
    return __v55BaseReconcileRemoteState(sync);
  };
}

if(typeof submitNewOrder === 'function'){
  const __v55BaseSubmitNewOrder = submitNewOrder;
  submitNewOrder = async function(e){
    if(e?.preventDefault) e.preventDefault();
    const form = e?.target || document.querySelector('#newOrderForm');
    if(!form) return __v55BaseSubmitNewOrder(e);
    if(typeof v46RequireDay === 'function' && !v46RequireDay()) return;
    const f = new FormData(form);
    const data = Object.fromEntries(f);
    data.type = selectedOrderType;
    data.guests = Number(data.guests || 0);
    data.deliveryFee = Number(data.deliveryFee || 0);
    if(data.type === 'DINE_IN' && !data.tableId) return toast('Select table for Dine In order', true);
    try{
      const taker = state.orderTakers.find(t => t.id === data.orderTakerId);
      data.orderTakerName = taker?.name || '';
      if(typeof __suspendSyncUntil !== 'undefined') __suspendSyncUntil = Date.now() + 3500;
      if(typeof __localDirtyOrder !== 'undefined') __localDirtyOrder = true;
      const j = await api('/api/orders/create', data);
      const created = clone(j.order);
      currentOrder = created;
      screen = 'pos';
      centerMode = 'menu';
      if(typeof setMobileBill === 'function') setMobileBill(false);
      closeModal();
      await loadState();
      // loadState refreshes lists only; DRAFT orders are not in openOrders by design.
      // Preserve the just-created DRAFT as the active bill so cashier can add items.
      currentOrder = created;
      renderShell();
      toast('Order created. Add items to continue.');
      setTimeout(() => {
        if(currentOrder?.id === created.id && !hasOrderLines(currentOrder) && typeof __localDirtyOrder !== 'undefined'){
          __localDirtyOrder = false;
        }
      }, 3500);
    }catch(err){
      if(typeof __localDirtyOrder !== 'undefined') __localDirtyOrder = false;
      toast(err.message, true);
    }
  };
}

document.documentElement.classList.add('v55-functionality-stabilized');
