const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const app = $('#app');
const toastBox = $('#toast');
let token = localStorage.getItem('swifttill_token') || '';
let state = null;
let screen = 'pos';
let centerMode = 'menu';
let categoryId = 'cat_all';
let currentOrder = null;
let adminTab = 'dashboard';
let selectedOrderType = 'DINE_IN';
let lastReceipt = null;

function money(v){ return `Rs ${Number(v||0).toLocaleString('en-PK',{maximumFractionDigits:0})}`; }
function esc(v){ return String(v ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s])); }
function uid(){ return 'ln_' + Math.random().toString(16).slice(2) + Date.now().toString(16); }
function clone(o){ return JSON.parse(JSON.stringify(o)); }
function can(p){ return state?.permissions?.includes(p); }
function toast(msg, bad=false){ toastBox.textContent = msg; toastBox.className = bad ? 'bad show' : 'show'; setTimeout(()=>toastBox.className='',2600); }
async function api(path, data, method='POST'){
  if(state?.settings?.onlineOnly && !navigator.onLine) throw new Error('Internet connection required. Offline mode is disabled for this build.');
  const res = await fetch(path, { method, headers:{'Content-Type':'application/json', Authorization:`Bearer ${token}`}, body:data ? JSON.stringify(data) : undefined });
  if(res.headers.get('content-type')?.includes('text/csv')) return res;
  const json = await res.json().catch(()=>({ok:false,error:'Invalid server response'}));
  if(!res.ok || json.ok===false) throw new Error(json.error || 'Request failed');
  return json;
}
async function downloadApi(path, filename){
  const res = await fetch(path, { headers:{ Authorization:`Bearer ${token}` } });
  if(!res.ok) throw new Error((await res.json().catch(()=>({error:'Download failed'}))).error || 'Download failed');
  const blob = await res.blob();
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = filename; a.click(); URL.revokeObjectURL(a.href);
}
async function loadState(){ const j = await api('/api/state', null, 'GET'); state = j.data; }
async function boot(){ if(!token) return renderLogin(); try{ await loadState(); renderShell(); }catch(e){ localStorage.removeItem('swifttill_token'); token=''; renderLogin(); } }

function renderLogin(){
  app.innerHTML = `<div class="login-screen"><form class="login-card" id="loginForm">
    <img class="login-logo" src="/assets/img/swifttill-logo.png" alt="SwiftTill POS">
    <h1>SwiftTill POS</h1><p>Complete local food billing system.</p>
    <div class="field"><label>Email</label><input name="email" value="admin@swifttill.local" autocomplete="username"></div>
    <div class="field"><label>Password</label><input name="password" value="admin123" type="password" autocomplete="current-password"></div>
    <button class="primary-btn" style="width:100%">Login</button>
    <p class="muted-note">Admin: admin@swifttill.local / admin123<br>Manager: manager@swifttill.local / manager123<br>Cashier: cashier@swifttill.local / cashier123</p>
  </form></div>`;
  $('#loginForm').addEventListener('submit', async e => { e.preventDefault(); const f = new FormData(e.target); try{ const j = await api('/api/login', Object.fromEntries(f)); token = j.token; localStorage.setItem('swifttill_token', token); await boot(); }catch(err){ toast(err.message,true); } });
}
function renderShell(){
  if(screen === 'admin') return renderAdminShell();
  app.innerHTML = `<div class="app-shell">
    <aside class="panel sidebar">${renderSidebar()}</aside>
    <main class="main"><section class="panel topbar">${renderTopbar()}</section><section class="panel workspace" id="workspace"></section></main>
    <aside class="right-rail"><div class="panel rail-nav">${renderRailNav()}</div><section class="panel bill" id="billPanel"></section></aside>
  </div><div id="modalRoot"></div><div class="print-only" id="printArea"></div>`;
  bindSidebar(); bindRailNav(); renderWorkspace(); renderBill();
}
function renderAdminShell(){
  app.innerHTML = `<div class="admin-screen"><section class="panel topbar">${renderTopbar()}<div class="admin-top-actions"><button class="ghost-btn" id="backPosBtn">Back to POS</button></div></section><section class="panel admin-page" id="workspace"></section></div><div id="modalRoot"></div><div class="print-only" id="printArea"></div>`;
  $('#backPosBtn').onclick = () => { screen='pos'; renderShell(); };
  $('#logoutBtn') && ($('#logoutBtn').onclick = logout);
  $('#shiftBtn') && ($('#shiftBtn').onclick = () => state.activeShift ? openCloseShift() : openOpenShift());
  renderAdmin($('#workspace'));
}
function renderSidebar(){
  return `<div class="brand"><img src="/assets/img/swifttill-logo.png" alt="SwiftTill POS"></div>
  <button class="new-order" id="newOrderBtn">＋ New Order</button>
  <div class="search"><span>⌕</span><input id="menuSearch" placeholder="Search menu items..."></div>
  <div class="sidebar-scroll">
    <div class="section-title"><h3>Categories</h3><button id="showAll">View All</button></div>
    ${state.categories.filter(c=>c.active).sort((a,b)=>(a.sort||0)-(b.sort||0)).map(c=>`<button class="cat-btn ${categoryId===c.id?'active':''}" data-cat="${esc(c.id)}"><img src="${esc(c.imageUrl)}" alt=""><span>${esc(c.name)}</span></button>`).join('')}
    <div class="divider"></div>
    <div class="section-title"><h3>Deals</h3></div>
    <button class="cat-btn ${centerMode==='deals'?'active':''}" id="dealsBtn"><img src="/assets/img/sample/deal.svg" alt=""><span>Special Deals</span></button>
    <button class="cat-btn" id="comboBtn"><img src="/assets/img/sample/family-deal.svg" alt=""><span>Meal Combos</span></button>
  </div>`;
}
function renderRailNav(){
  const openCount = state?.openOrders?.length || 0;
  const reportsAllowed = can('reports.view');
  const adminAllowed = can('admin.menu') || can('admin.users') || can('admin.settings') || can('admin.roles') || can('admin.payments');
  return `<button class="${centerMode==='open'?'active':''}" data-rail="open" title="Open Orders"><span class="rail-ico">▤</span><span class="rail-label">Orders</span><span class="mini-badge">${openCount}</span></button>
  <button class="${screen==='reports'?'active':''} ${!reportsAllowed?'locked':''}" data-rail="reports" title="Reports"><span class="rail-ico">◷</span><span class="rail-label">Reports</span></button>
  <button class="${screen==='admin'?'active':''} ${!adminAllowed?'locked':''}" data-rail="admin" title="Admin Panel"><span class="rail-ico">⚙</span><span class="rail-label">Admin</span></button>`;
}
function renderTopbar(){
  const d = new Date(); const active = state.activeShift;
  return `<div class="hello"><h2>Good ${d.getHours()<12?'morning':d.getHours()<18?'afternoon':'evening'}!</h2><p>Ready to serve great food.</p></div>
  <div class="top-items">
    <div class="top-pill">📅 <span><b>${d.toLocaleDateString('en-GB',{weekday:'short',day:'2-digit',month:'short',year:'numeric'})}</b>${d.toLocaleTimeString([], {hour:'2-digit',minute:'2-digit'})}</span></div>
    <div class="top-pill">👤 <span><b>${esc(state.user.name)}</b>${esc(state.user.roles.join(', ') || 'User')}</span></div>
    <div class="top-pill"><span class="status-dot"></span><span><b>${esc(state.settings.branchName)}</b>System Online</span></div>
    <button class="ghost-btn" id="shiftBtn">${active?'Close Shift':'Open Shift'}</button>
    <button class="ghost-btn" id="logoutBtn">Logout</button>
  </div>`;
}
function bindSidebar(){
  $('#newOrderBtn').onclick = () => openNewOrderModal();
  $$('#workspace [data-mode]').forEach(b=>b.onclick=()=>{});
  $$('[data-cat]').forEach(b => b.onclick = () => { screen='pos'; centerMode='menu'; categoryId=b.dataset.cat; renderShell(); });
  $('#dealsBtn').onclick = () => { screen='pos'; centerMode='deals'; renderShell(); };
  $('#comboBtn').onclick = () => { screen='pos'; centerMode='deals'; renderShell(); };
  $('#showAll').onclick = () => { categoryId='cat_all'; centerMode='menu'; screen='pos'; renderShell(); };
  $('#menuSearch').oninput = e => { screen='pos'; centerMode='menu'; renderMenu(e.target.value); };
  $('#logoutBtn').onclick = logout;
  $('#shiftBtn').onclick = () => state.activeShift ? openCloseShift() : openOpenShift();
}
function bindRailNav(){
  $$('[data-rail]').forEach(b => b.onclick = () => {
    const r = b.dataset.rail;
    if(r==='pos'){ screen='pos'; centerMode='menu'; renderShell(); }
    if(r==='open'){ screen='pos'; centerMode='open'; renderShell(); }
    if(r==='reports'){ if(!can('reports.view')) return toast('Reports permission required', true); screen='reports'; renderShell(); }
    if(r==='admin'){
      const ok = can('admin.menu') || can('admin.users') || can('admin.settings') || can('admin.roles') || can('admin.payments');
      if(!ok) return toast('Admin permission required', true);
      screen='admin'; renderShell();
    }
  });
}
function logout(){ localStorage.removeItem('swifttill_token'); location.reload(); }
function renderWorkspace(){
  const ws = $('#workspace');
  if(screen === 'reports') return renderReports(ws);
  ws.innerHTML = `<div class="seg"><button class="${centerMode==='menu'?'active':''}" data-mode="menu">🍴 Menu</button><button class="${centerMode==='tables'?'active':''}" data-mode="tables">▣ Tables</button><button class="${centerMode==='deals'?'active':''}" data-mode="deals">% Deals</button></div><div class="crumb">⌂ ${currentOrder ? `${formatType(currentOrder.type)} › ${orderContext(currentOrder)} › Add items to order` : 'Start New Order › Select type › Add items'}</div><div class="center-scroll" id="centerScroll"></div>`;
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
  const cats = state.categories.filter(c=>c.active && c.id!=='cat_all');
  const items = state.items.filter(i=>i.active && (categoryId==='cat_all'||i.categoryId===categoryId) && (!q || i.name.toLowerCase().includes(q.toLowerCase()))).sort((a,b)=>(a.sort||0)-(b.sort||0));
  const selectedCat = categoryId === 'cat_all' ? 'All Items' : (cats.find(c=>c.id===categoryId)?.name || 'Menu Items');
  $('#centerScroll').innerHTML = `${currentOrder?renderTablesStrip():''}<div class="card subcard"><div class="module-title"><div><h3>Menu Items</h3><div class="menu-current">${esc(selectedCat)} • ${items.length} item${items.length===1?'':'s'}</div></div><button class="ghost-btn" onclick="centerMode='tables';renderShell()">View Tables</button></div><div class="item-grid">${items.map(itemCard).join('') || '<div class="empty-cart">No matching items.</div>'}</div></div>`;
  $$('[data-add-item]').forEach(b=>b.onclick=()=>addItem(b.dataset.addItem)); bindTableCards();
}
function itemCard(i){ const cat=state.categories.find(c=>c.id===i.categoryId)?.name||''; return `<button class="item-card clickable-card ${i.soldOut?'sold':''}" data-add-item="${esc(i.id)}" ${i.soldOut?'disabled':''}>${i.soldOut?'<div class="sold-badge">SOLD OUT</div>':''}<div class="item-img"><img src="${esc(i.imageUrl)}" alt=""></div><div class="item-body"><div><h4>${esc(i.name)}</h4><p>${esc(cat)}</p><div class="price">${money(i.price)}</div></div></div></button>`; }
function renderDeals(){
  $('#centerScroll').innerHTML = `<div class="card subcard"><div class="module-title"><h3>Deals</h3>${can('admin.menu')?'<button class="ghost-btn" onclick="screen=\'admin\';adminTab=\'deals\';renderShell()">Manage Deals</button>':''}</div><div class="item-grid">${state.deals.filter(d=>d.active).sort((a,b)=>(a.sort||0)-(b.sort||0)).map(d=>`<button class="item-card clickable-card deal-card" data-add-deal="${esc(d.id)}"><div class="popular">Deal</div><div class="item-img"><img src="${esc(d.imageUrl)}" alt=""></div><div class="item-body"><div><h4>${esc(d.name)}</h4><p>${esc(d.description||'Combo deal')}</p><div class="price">${money(d.price)}</div></div></div></button>`).join('')}</div></div>`;
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
async function addItem(itemId){ if(!(await ensureOrder())) return; const i=state.items.find(x=>x.id===itemId); if(!i||i.soldOut) return; const line=currentOrder.lines.find(l=>l.kind==='ITEM'&&l.itemId===i.id&&(!l.modifiers||!l.modifiers.length)&&!l.note); if(line) line.qty++; else currentOrder.lines.push({lineId:uid(),kind:'ITEM',itemId:i.id,categoryId:i.categoryId,name:i.name,price:i.price,imageUrl:i.imageUrl,qty:1,note:'',modifiers:[]}); renderBill(); }
async function addDeal(dealId){ if(!(await ensureOrder())) return; const d=state.deals.find(x=>x.id===dealId); const line=currentOrder.lines.find(l=>l.kind==='DEAL'&&l.dealId===d.id&&!l.note); if(line) line.qty++; else currentOrder.lines.push({lineId:uid(),kind:'DEAL',dealId:d.id,categoryId:'cat_deals',name:d.name,price:d.price,imageUrl:d.imageUrl,qty:1,note:'',modifiers:[],dealItems:d.items}); renderBill(); }
function renderBill(){
  const bp=$('#billPanel'); if(!bp) return;
  if(!currentOrder){ bp.innerHTML=`<div class="bill-head"><h2>Current Order</h2><b>—</b></div><div class="empty-cart"><div><b>No active bill</b><p>Press New Order to start billing.</p></div></div>`; return; }
  const t=calcTotals(currentOrder);
  const billActions = currentOrder.type==='DINE_IN' ? `<button class="secondary-btn mini-action" id="moveTableBtn">Move Table</button><button class="secondary-btn mini-action" id="splitBillBtn">Split Bill</button>` : `<button class="secondary-btn mini-action" id="splitBillBtn">Split Bill</button>`;
  const deliveryRow = currentOrder.type==='DELIVERY' ? `<div class="total-row"><span>Delivery Fee</span><b>${money(t.deliveryFee)}</b></div>` : '';
  bp.innerHTML=`<div class="bill-head"><h2>Current Order</h2><b>#${esc(currentOrder.number||'Draft')}</b></div><div class="orderbox">${orderBoxRows(currentOrder)}</div><div class="line-list">${currentOrder.lines.length?currentOrder.lines.map(cartLine).join(''):'<div class="empty-cart">Add items from the center menu.</div>'}</div><div class="totals compact-totals"><div class="total-row"><span>Subtotal</span><b>${money(t.subtotal)}</b></div><div class="discount-row"><span>Discount</span><div class="switch"><button class="${currentOrder.discountType==='FIXED'?'active':''}" data-disc="FIXED">Rs</button><button class="${currentOrder.discountType==='PERCENT'?'active':''}" data-disc="PERCENT">%</button></div><input class="small-input" id="discountVal" value="${Number(currentOrder.discountValue||0)}"></div>${deliveryRow}<div class="total-row big"><span>Total</span><b>${money(t.total)}</b></div></div><div class="bill-quick-actions">${billActions}</div><label class="check"><input type="checkbox" id="printRemember" ${getPrintDefault()?'checked':''}> Print receipt after payment</label><div class="actions"><button class="hold" id="holdBtn">Ⅱ HOLD</button><button class="pay" id="payBtn">▣ PAY ${money(t.total)}</button></div>`;
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
async function saveOrder(hold=false){ if(!currentOrder) return; try{ const j=await api('/api/orders/save',{...currentOrder,hold}); currentOrder=hold?null:j.order; await loadState(); renderShell(); toast(hold?'Order held':'Order saved'); }catch(e){toast(e.message,true);} }
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
  const t=calcTotals(currentOrder);
  openModal(`<div class="modal-head"><h2>Split Bill Calculator</h2><button class="x" onclick="closeModal()">×</button></div><div class="pay-total-card"><span>Order Total</span><b>${money(t.total)}</b></div><div class="grid2"><div class="field"><label>Entered Amount</label><input id="splitFirst" type="number" value="0" min="0"></div><div class="field"><label>Equal Persons</label><input id="splitPersons" type="number" value="2" min="2"></div></div><div class="split-summary"><div><span>Entered</span><b id="billEntered">${money(0)}</b></div><div><span id="billBalanceLabel">Remaining</span><b id="billRemaining">${money(t.total)}</b></div><div><span>Equal Share</span><b id="billEqual">${money(t.total/2)}</b></div></div><p class="muted-note">If entered amount is above total, system shows extra/change instead of hiding it.</p><button class="primary-btn mt" id="goSplitPay">Open Split Payment</button>`);
  const update=()=>{ const a=Number($('#splitFirst').value||0); const persons=Math.max(2,Number($('#splitPersons').value||2)); const balance=t.total-a; $('#billEntered').textContent=money(a); $('#billBalanceLabel').textContent=balance<0?'Extra / Change':'Remaining'; $('#billRemaining').textContent=money(Math.abs(balance)); $('#billEqual').textContent=money(t.total/persons); $('#billRemaining').classList.toggle('danger-text', balance>0); $('#billRemaining').classList.toggle('ok-text', balance<=0); };
  $('#splitFirst').addEventListener('input',update); $('#splitPersons').addEventListener('input',update); $('#goSplitPay').onclick=()=>{ closeModal(); openPayModal(); setTimeout(()=>{ const s=$('#splitPay'); if(s){ s.checked=true; s.dispatchEvent(new Event('change')); } },50); }; update();
}
function printReportArea(){ const html=$('#printReportArea')?.innerHTML || ''; $('#printArea').innerHTML=`<div class="report-print">${html}</div>`; setTimeout(()=>window.print(),100); }

function openPayModal(){
  if(!currentOrder || !currentOrder.lines.length) return toast('Add items before payment',true);
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
  $('#completePay').onclick=async()=>{ try{ const split=$('#splitPay').checked; let payments=[]; if(split){ const cash=Number($('#cashAmt').value||0), card=Number($('#cardAmt').value||0), online=Number($('#onlineAmt').value||0); const paid=cash+card+online; const remaining=t.total-paid; if(remaining>0.009) throw new Error(`Remaining amount: ${money(remaining)}`); const extra=Math.max(0,paid-t.total); if(extra>0.009 && cash<extra) throw new Error('Extra amount must be cash so change can be returned.'); const cashRevenue=Math.max(0,cash-extra); payments=[{method:'Cash',amount:cashRevenue,received:cash,change:extra},{method:'Card',amount:card},{method:'Online',amount:online}].filter(p=>p.amount>0 || p.received>0); } else if(tab==='cash'){ const rec=Number($('#cashAmount').value||0); if(rec<t.total) throw new Error('Cash received is less than total'); payments=[{method:'Cash',amount:t.total,received:rec,change:Math.max(0,rec-t.total)}]; } else if(tab==='card'){ const entered=Number($('#cardAmount').value||0); if(entered<t.total) throw new Error(`Remaining amount: ${money(t.total-entered)}`); if(entered>t.total) throw new Error('Card extra detected. Enter exact card amount.'); payments=[{method:'Card',amount:t.total,received:entered,reference:$('#cardRef').value,change:0}]; } else { const entered=Number($('#onlineAmount').value||0); if(entered<t.total) throw new Error(`Remaining amount: ${money(t.total-entered)}`); if(entered>t.total) throw new Error('Online extra detected. Enter exact online amount.'); payments=[{method:'Online',amount:t.total,received:entered,reference:$('#onlineRef').value,change:0}]; } const j=await api('/api/orders/pay',{...currentOrder,payments}); lastReceipt=j.receipt; const doPrint=$('#payPrint').checked; localStorage.setItem('swifttill_print_default', doPrint?'1':'0'); currentOrder=null; screen='pos'; centerMode='menu'; await loadState(); renderShell(); closeModal(); toast('Payment completed'); showReceiptModal(lastReceipt, doPrint); }catch(e){toast(e.message,true);} };
}
function showReceiptModal(r, autoPrint=false){
  if(!r) return;
  openModal(`<div class="modal-head"><h2>Paid Bill #${esc(r.number)}</h2><button class="x" onclick="closeModal()">×</button></div><div class="receipt-preview-wrap">${receiptHTML(r)}</div><div class="receipt-actions"><button class="ghost-btn" onclick="closeModal();screen='pos';centerMode='menu';renderShell();">Close</button><button class="primary-btn" id="modalPrintReceipt">Print Receipt</button></div>`, false);
  $('#modalPrintReceipt').onclick=()=>printReceipt(r);
  if(autoPrint) setTimeout(()=>printReceipt(r),250);
}
async function printReceipt(r){
  $('#printArea').innerHTML=receiptHTML(r);
  const agentUrl=(state?.settings?.localAgentUrl||'').trim();
  if(agentUrl){
    try{
      const res=await fetch(agentUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({type:'receipt',receipt:r,html:receiptHTML(r),text:receiptText(r)})});
      if(res.ok){ toast('Receipt sent to local printer agent'); return; }
    }catch(e){}
  }
  setTimeout(()=>window.print(),100);
}
function receiptText(r){
  const line='----------------------------------------';
  const rows=[]; rows.push(r.business||'SwiftTill POS'); if(r.branchName) rows.push(r.branchName); if(r.address) rows.push(r.address); if(r.phone) rows.push(r.phone); rows.push(line); rows.push(`Bill No: #${r.number}`); rows.push(new Date(r.date).toLocaleString()); rows.push(`Order: ${formatType(r.type)}`); if(r.table) rows.push(`Table: ${r.table}${r.guests?' / '+r.guests+' guests':''}`); if(r.orderTaker) rows.push(`Taker: ${r.orderTaker}`); if(r.cashier) rows.push(`Cashier: ${r.cashier}`); rows.push(line); for(const l of (r.lines||[])){ rows.push(`${l.name} x${l.qty}  ${money(((l.price||0)+(l.modifiers||[]).reduce((a,m)=>a+Number(m.price||0),0))*l.qty)}`); for(const m of (l.modifiers||[])) rows.push(` + ${m.name} ${money(m.price*l.qty)}`); if(l.note) rows.push(` Note: ${l.note}`); } rows.push(line); rows.push(`Subtotal: ${money(r.totals.subtotal)}`); if(Number(r.totals.deliveryFee||0)>0) rows.push(`Delivery: ${money(r.totals.deliveryFee)}`); rows.push(`Discount: ${money(r.totals.discount)}`); rows.push(`TOTAL: ${money(r.totals.total)}`); rows.push(line); for(const p of (r.payments||[])){ rows.push(`${p.method}: ${money(p.amount)}`); if(p.received&&p.received!==p.amount) rows.push(`Received: ${money(p.received)}`); if(p.change) rows.push(`Change: ${money(p.change)}`); } rows.push(line); rows.push(r.footer||'Thank you'); return rows.join('\n');
}
function receiptHTML(r){
  const width = r.receiptWidth || state?.settings?.receiptWidth || '80mm';
  const lines=(r.lines||[]).map(l=>`<div class="r"><span>${esc(l.name)} x${l.qty}</span><span>${money(((l.price||0)+(l.modifiers||[]).reduce((a,m)=>a+Number(m.price||0),0))*l.qty)}</span></div>${(l.modifiers||[]).map(m=>`<div class="r sub"><span> + ${esc(m.name)}</span><span>${money(m.price*l.qty)}</span></div>`).join('')}${l.note?`<div class="r sub"><span>Note: ${esc(l.note)}</span><span></span></div>`:''}`).join('');
  const customer = r.showCustomerOnReceipt && (r.customer || r.mobile) ? `<div class="r"><span>Customer</span><span>${esc(r.customer || r.mobile)}</span></div>` : '';
  const orderTaker = r.showOrderTakerOnReceipt && r.orderTaker ? `<div class="r"><span>Order Taker</span><span>${esc(r.orderTaker)}</span></div>` : '';
  const cashier = r.showCashierOnReceipt && r.cashier ? `<div class="r"><span>Cashier</span><span>${esc(r.cashier)}</span></div>` : '';
  const logo = r.showLogoOnReceipt && r.logoUrl ? `<img class="receipt-logo" src="${esc(r.logoUrl)}" alt="">` : '';
  const payments = r.showPaymentBreakdown === false ? '' : (r.payments||[]).map(p=>`<div class="r"><span>${esc(p.method)}</span><span>${money(p.amount)}</span></div>${p.received&&p.received!==p.amount?`<div class="r sub"><span>Received</span><span>${money(p.received)}</span></div>`:''}${p.change?`<div class="r sub"><span>Change</span><span>${money(p.change)}</span></div>`:''}`).join('');
  return `<div class="receipt ${width==='58mm'?'narrow':''}">${logo}<h3>${esc(r.business)}</h3><div class="c">${esc(r.branchName||'')}</div><div class="c">${esc(r.header||'')}</div><div class="c">${esc(r.address||'')}<br>${esc(r.phone||'')}</div><div class="sep"></div><div class="r"><span>Bill No</span><span>#${esc(r.number)}</span></div><div class="r"><span>Date</span><span>${new Date(r.date).toLocaleString()}</span></div><div class="r"><span>Order</span><span>${formatType(r.type)}</span></div>${r.table?`<div class="r"><span>Table</span><span>${esc(r.table)}${r.guests?` / ${r.guests} guests`:''}</span></div>`:''}${customer}${orderTaker}${cashier}<div class="sep"></div>${lines}<div class="sep"></div><div class="r"><span>Subtotal</span><span>${money(r.totals.subtotal)}</span></div>${Number(r.totals.deliveryFee||0)>0?`<div class="r"><span>Delivery</span><span>${money(r.totals.deliveryFee)}</span></div>`:''}<div class="r"><span>Discount</span><span>${money(r.totals.discount)}</span></div><div class="r total"><b>Total</b><b>${money(r.totals.total)}</b></div><div class="sep"></div>${payments}<div class="sep"></div><div class="c">${esc(r.footer||'Thank you')}</div></div>`;
}
function openOpenShift(){ openModal(`<div class="modal-head"><h2>Open Shift</h2><button class="x" onclick="closeModal()">×</button></div><div class="field"><label>Opening Cash</label><input id="openingCash" type="number" value="5000"></div><button class="primary-btn" style="width:100%" id="doOpenShift">Start Shift</button>`); $('#doOpenShift').onclick=async()=>{try{await api('/api/shift/open',{openingCash:Number($('#openingCash').value||0)});closeModal();await loadState();renderShell();toast('Shift opened');}catch(e){toast(e.message,true);}}; }
function openCloseShift(){ openModal(`<div class="modal-head"><h2>Close Shift</h2><button class="x" onclick="closeModal()">×</button></div><p class="muted-note">Count physical cash and close the active shift.</p><div class="field"><label>Counted Cash</label><input id="countedCash" type="number" value="0"></div><button class="primary-btn" style="width:100%" id="doCloseShift">Close Shift</button>`); $('#doCloseShift').onclick=async()=>{try{const j=await api('/api/shift/close',{countedCash:Number($('#countedCash').value||0)});closeModal();await loadState();renderShell();toast(`Shift closed. Difference ${money(j.shift.difference)}`);}catch(e){toast(e.message,true);}}; }
function renderReports(ws){
  const today = new Date().toISOString().slice(0,10);
  const userOptions = state.users.map(u=>`<option value="${esc(u.id)}">${esc(u.name)}</option>`).join('');
  const takerOptions = state.orderTakers.map(t=>`<option value="${esc(t.id)}">${esc(t.name)}</option>`).join('');
  const itemOptions = state.items.map(i=>`<option value="${esc(i.id)}">${esc(i.name)}</option>`).join('') + state.deals.map(d=>`<option value="${esc(d.id)}">${esc(d.name)} (Deal)</option>`).join('');
  const catOptions = state.categories.filter(c=>c.id!=='cat_all').map(c=>`<option value="${esc(c.id)}">${esc(c.name)}</option>`).join('');
  const shiftOptions = state.shifts.map(s=>`<option value="${esc(s.id)}">Shift #${s.number} - ${esc(s.cashierName)} - ${new Date(s.openedAt).toLocaleString()}</option>`).join('');
  const paymentOptions = (state.paymentMethods||[]).filter(p=>p.active).map(p=>`<option value="${esc(p.name)}">${esc(p.name)}</option>`).join('');
  ws.innerHTML=`<div class="center-scroll"><div class="report-page card subcard">
    <div class="module-title"><div><h3>${esc(state.settings.reportTitle||'Sales Reports')}</h3><p class="muted-note">Filter by date, payment mode, item, category, discount, cashier, order taker and shift.</p></div><div class="actions-mini"><button class="ghost-btn" id="exportReport">Export CSV / Excel</button><button class="ghost-btn" id="printReportBtn">Print Report</button></div></div>
    <div class="report-tabs"><button class="active" data-report-tab="sales">Sales</button><button data-report-tab="payment">Payment Mode</button><button data-report-tab="items">Item Wise</button><button data-report-tab="categories">Category Wise</button><button data-report-tab="discounts">Discounts</button><button data-report-tab="voids">Void / Refund</button><button data-report-tab="xz">X / Z</button></div>
    <div class="report-filter-grid">
      <div class="field"><label>From</label><input type="date" id="fromDate" value="${today}"></div>
      <div class="field"><label>To</label><input type="date" id="toDate" value="${today}"></div>
      <div class="field"><label>Payment Mode</label><select id="paymentMode"><option value="">All</option>${paymentOptions}</select></div>
      <div class="field"><label>Order Type</label><select id="orderType"><option value="">All</option><option value="DINE_IN">Dine In</option><option value="DELIVERY">Delivery</option><option value="TAKEAWAY">Takeaway</option></select></div>
      <div class="field"><label>Item / Deal</label><select id="itemId"><option value="">All</option>${itemOptions}</select></div>
      <div class="field"><label>Category</label><select id="categoryFilter"><option value="">All</option>${catOptions}</select></div>
      <div class="field"><label>Cashier</label><select id="cashierId"><option value="">All</option>${userOptions}</select></div>
      <div class="field"><label>Order Taker</label><select id="orderTakerId"><option value="">All</option>${takerOptions}</select></div>
      <div class="field"><label>Shift</label><select id="shiftId"><option value="">All</option>${shiftOptions}</select></div>
      <label class="check"><input type="checkbox" id="discountOnly"> Discounted only</label>
      <label class="check"><input type="checkbox" id="refundOnly"> Refunded only</label>
    </div>
    <button class="primary-btn" id="runReport">Run Report</button>
    <div id="reportResult" class="mt"></div>
  </div></div>`;
  $('#runReport').onclick=loadReport;
  $('#exportReport').onclick=()=>downloadApi(`/api/export?${reportQuery()}`,`swifttill-report-${Date.now()}.csv`).catch(e=>toast(e.message,true));
  $('#printReportBtn').onclick=()=>printReportArea();
  $$('.report-tabs button').forEach(b=>b.onclick=()=>{$$('.report-tabs button').forEach(x=>x.classList.remove('active'));b.classList.add('active');const el=$(`#report-section-${b.dataset.reportTab}`); if(el) el.scrollIntoView({behavior:'smooth',block:'start'});});
  loadReport();
}
function reportQuery(){
  const params = new URLSearchParams();
  const map = {from:'fromDate',to:'toDate',paymentMode:'paymentMode',orderType:'orderType',itemId:'itemId',categoryId:'categoryFilter',cashierId:'cashierId',orderTakerId:'orderTakerId',shiftId:'shiftId'};
  for(const [k,id] of Object.entries(map)){ const el=$('#'+id); if(el && el.value) params.set(k,el.value); }
  if($('#discountOnly')?.checked) params.set('discountOnly','1');
  if($('#refundOnly')?.checked) params.set('refundOnly','1');
  return params.toString();
}
async function loadReport(){
  try{
    const j=await api(`/api/reports?${reportQuery()}`,null,'GET'); const r=j.data;
    $('#reportResult').innerHTML=`<div id="printReportArea" class="report-print-wrap">
    <div class="report-brand"><div><h2>${esc(state.settings.businessName)}</h2><p>${esc(state.settings.address||'')} ${state.settings.phone?'• '+esc(state.settings.phone):''}</p></div><b>${esc(state.settings.reportTitle||'Sales Report')}</b></div>
    <div class="report-grid" id="report-section-sales">
      <div class="card metric"><p>Orders</p><h3>${r.summary.orders}</h3></div>
      <div class="card metric"><p>Gross Sales</p><h3>${money(r.summary.gross)}</h3></div>
      <div class="card metric"><p>Discounts</p><h3>${money(r.summary.discounts)}</h3></div>
      <div class="card metric"><p>Refunds</p><h3>${money(r.summary.refunds)}</h3></div>
      <div class="card metric"><p>Net Sales</p><h3>${money(r.summary.net)}</h3></div>
      <div class="card metric"><p>Average Bill</p><h3>${money(r.summary.averageBill)}</h3></div>
      <div class="card metric cash-metric"><p>Opening Cash</p><h3>${money(r.shiftSummary?.openingCash||0)}</h3><span>Not counted as sale</span></div>
      <div class="card metric cash-metric"><p>Cash Sales</p><h3>${money(r.shiftSummary?.cashSales||0)}</h3><span>Sales only</span></div>
      <div class="card metric cash-metric"><p>Expected Cash</p><h3>${money(r.shiftSummary?.expectedCash||0)}</h3><span>Opening + cash sales</span></div>
    </div>
    <div class="grid2 mt"><div class="card subcard" id="report-section-payment"><h3>Payment Mode</h3>${Object.entries(r.paymentWise).map(([k,v])=>`<p>${esc(k)}: <b>${money(v)}</b></p>`).join('')||'<p>No payments.</p>'}</div>
    <div class="card subcard"><h3>Order Type</h3>${Object.entries(r.orderTypeWise).map(([k,v])=>`<p>${formatType(k)}: <b>${money(v)}</b></p>`).join('')||'<p>No sales.</p>'}</div></div>
    <div class="grid2 mt"><div class="card subcard" id="report-section-categories"><h3>Category Wise</h3>${Object.entries(r.categoryWise).map(([k,v])=>`<p>${esc(k)}: <b>${money(v)}</b></p>`).join('')||'<p>No sales.</p>'}</div>
    <div class="card subcard" id="report-section-discounts"><h3>Discounts</h3><p>Discounted bills: <b>${r.discountWise.count}</b></p><p>Discount amount: <b>${money(r.discountWise.amount)}</b></p></div></div>
    <div class="grid2 mt"><div class="card subcard" id="report-section-voids"><h3>Void / Refund</h3><p>Void orders: <b>${r.voidOrders.length}</b></p><p>Refund entries: <b>${r.refunds.length}</b></p><p>Refund amount: <b>${money(r.summary.refunds)}</b></p></div><div class="card subcard" id="report-section-xz"><h3>X / Z Snapshot</h3><p>X Report: current filtered live snapshot.</p><p>Z Report: use Close Shift for official close.</p><p>Active shift: <b>${state.activeShift ? '#'+state.activeShift.number+' open' : 'No active shift'}</b></p></div></div>
    <div class="card subcard mt" id="report-section-items"><h3>Item Wise</h3><div class="report-table-wrap"><table class="admin-table"><thead><tr><th>Item</th><th>Category</th><th>Qty</th><th>Sales</th></tr></thead><tbody>${r.itemWise.map(i=>`<tr><td>${esc(i.item)}</td><td>${esc(i.category||'')}</td><td>${i.qty}</td><td>${money(i.sales)}</td></tr>`).join('')||'<tr><td colspan="4">No sales.</td></tr>'}</tbody></table></div></div>
    <div class="card subcard mt"><h3>Bill Details</h3><div class="report-table-wrap"><table class="admin-table"><thead><tr><th>Bill</th><th>Date</th><th>Type</th><th>Table</th><th>Customer</th><th>Order Taker</th><th>Cashier</th><th>Discount</th><th>Total</th><th>Payments</th></tr></thead><tbody>${r.orders.map(o=>`<tr><td>#${esc(o.number)}</td><td>${new Date(o.date).toLocaleString()}</td><td>${formatType(o.type)}</td><td>${esc(o.table)}</td><td>${esc(o.customer||o.mobile||'')}</td><td>${esc(o.orderTaker)}</td><td>${esc(o.cashier)}</td><td>${money(o.discount)}</td><td>${money(o.total)}</td><td>${esc(o.payments)}</td></tr>`).join('')||'<tr><td colspan="10">No bills.</td></tr>'}</tbody></table></div></div>
    <p class="report-footer">${esc(state.settings.reportFooter||'Generated by SwiftTill POS')}</p></div>`;
  }catch(e){toast(e.message,true);}
}
function renderAdmin(ws){
  const tabs=['dashboard','reports','paid','categories','items','deals','tables','takers','payments','users','roles','settings'];
  ws.innerHTML=`<div class="admin-layout"><div class="panel admin-nav">${tabs.map(t=>`<button class="${adminTab===t?'active':''}" data-admin-tab="${t}">${labelTab(t)}</button>`).join('')}</div><div class="panel admin-content" id="adminContent"></div></div>`;
  $$('[data-admin-tab]').forEach(b=>b.onclick=()=>{adminTab=b.dataset.adminTab;renderAdmin(ws);});
  renderAdminContent();
}
function labelTab(t){ return ({takers:'Order Takers',roles:'Roles & Permissions',settings:'Company / Branding',payments:'Payment Methods',paid:'Paid Orders'}[t] || t[0].toUpperCase()+t.slice(1)); }
function renderAdminContent(){
  const c=$('#adminContent');
  if(adminTab==='dashboard') return c.innerHTML=`<div class="admin-hero"><div class="admin-hero-title"><h3>Admin Dashboard</h3><p>Control menu, users, reports, company branding and receipt/printer settings.</p></div></div><div class="report-grid"><div class="card metric"><p>Categories</p><h3>${state.categories.length}</h3></div><div class="card metric"><p>Menu Items</p><h3>${state.items.length}</h3></div><div class="card metric"><p>Tables</p><h3>${state.tables.length}</h3></div><div class="card metric"><p>Open Orders</p><h3>${state.openOrders.length}</h3></div><div class="card metric"><p>Users</p><h3>${state.users.length}</h3></div><div class="card metric"><p>Roles</p><h3>${state.roles.length}</h3></div></div><div class="card subcard mt"><h3>Recent Audit</h3>${state.auditLogs.map(a=>`<p><b>${esc(a.action)}</b> — ${esc(a.userName)} — ${new Date(a.createdAt).toLocaleString()}</p>`).join('') || '<p>No audit yet.</p>'}</div>`;
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
  if(adminTab==='cloud') return renderCloud(c);
  if(adminTab==='backup') return renderBackup(c);
}
function adminList(c,key,apiName,fields){ const rows=state[key]||[]; c.innerHTML=`<div class="admin-wrap"><div class="module-title"><h3>${labelTab(key)}</h3><button class="primary-btn" onclick="openAdminEditor('${apiName}')">Add New</button></div><table class="admin-table"><thead><tr><th>Image</th>${fields.map(f=>`<th>${esc(f)}</th>`).join('')}<th>Action</th></tr></thead><tbody>${rows.map(r=>`<tr><td>${r.imageUrl?`<img class="thumb" src="${esc(r.imageUrl)}">`:''}</td>${fields.map(f=>`<td>${esc(renderVal(r[f],f))}</td>`).join('')}<td><button class="ghost-btn" onclick='openAdminEditor("${apiName}",${JSON.stringify(r).replace(/'/g,"&#39;")})'>Edit</button></td></tr>`).join('')}</tbody></table></div>`; }
function renderVal(v,f){ if(v===true)return'Yes'; if(v===false)return'No'; if(f==='categoryId') return state.categories.find(c=>c.id===v)?.name || v || ''; if(f==='roleIds') return (v||[]).map(id=>state.roles.find(r=>r.id===id)?.name||id).join(', '); if(f==='permissions') return (v||[]).length + ' permissions'; return Array.isArray(v) ? v.join(', ') : (v ?? ''); }
function hiddenId(r){return r.id?`<input type="hidden" name="id" value="${esc(r.id)}">`:''} function input(n,l,v='',type='text'){return `<div class="field"><label>${l}</label><input name="${n}" type="${type}" value="${esc(v)}"></div>`} function check(n,l,v){return `<label class="check mb"><input type="checkbox" name="${n}" ${v?'checked':''}> ${l}</label>`} function select(n,l,v,opts){return `<div class="field"><label>${l}</label><select name="${n}">${opts.map(o=>`<option value="${esc(o[0])}" ${o[0]===v?'selected':''}>${esc(o[1])}</option>`).join('')}</select></div>`} function multiRoles(selected=[]){return `<div class="field"><label>Roles</label><div class="perm-grid">${state.roles.filter(r=>r.active).map(r=>`<label class="perm-chip"><input type="checkbox" name="roleIds" value="${esc(r.id)}" ${selected.includes(r.id)?'checked':''}> ${esc(r.name)}</label>`).join('')}</div></div>`} function permChecks(selected=[]){return `<div class="field"><label>Permissions</label><div class="perm-grid">${state.permissionCatalog.map(p=>`<label class="perm-chip"><input type="checkbox" name="permissions" value="${esc(p)}" ${selected.includes(p)?'checked':''}> ${esc(p)}</label>`).join('')}</div></div>`} function imageField(v){return `<div class="field"><label>Image</label>${v?`<img class="thumb" src="${esc(v)}">`:''}<input name="uploadFile" type="file" accept="image/*"><input name="imageUrl" value="${esc(v||'')}" placeholder="Or image URL"></div>`}
function openAdminEditor(kind, record={}){ let body=''; if(kind==='category') body=`${hiddenId(record)}${input('name','Name',record.name)}${input('sort','Sort',record.sort||0,'number')}${imageField(record.imageUrl)}${check('active','Active',record.active!==false)}`; if(kind==='item') body=`${hiddenId(record)}${input('name','Item Name',record.name)}${select('categoryId','Category',record.categoryId,state.categories.filter(c=>c.id!=='cat_all').map(c=>[c.id,c.name]))}${input('price','Price',record.price||0,'number')}${imageField(record.imageUrl)}${check('active','Active',record.active!==false)}${check('soldOut','Sold Out',!!record.soldOut)}`; if(kind==='deal') body=`${hiddenId(record)}${input('name','Deal Name',record.name)}${input('description','Description',record.description||'')}${input('price','Price',record.price||0,'number')}${imageField(record.imageUrl)}${check('active','Active',record.active!==false)}`; if(kind==='table') body=`${hiddenId(record)}${input('name','Table Name',record.name)}${input('seats','Seats',record.seats||4,'number')}${check('active','Active',record.active!==false)}`; if(kind==='taker') body=`${hiddenId(record)}${input('name','Order Taker Name',record.name)}${check('active','Active',record.active!==false)}`; if(kind==='payment') body=`${hiddenId(record)}${input('name','Payment Method Name',record.name)}${check('active','Active',record.active!==false)}`; if(kind==='user') body=`${hiddenId(record)}${input('name','Name',record.name)}${input('email','Email',record.email||'')}${input('password','Password',record.password||'')}${multiRoles(record.roleIds||[])}${input('pin','PIN',record.pin||'')}${check('active','Active',record.active!==false)}`; if(kind==='role') body=`${hiddenId(record)}${input('name','Role Name',record.name)}${input('description','Description',record.description||'')}${permChecks(record.permissions||[])}${check('active','Active',record.active!==false)}`; openModal(`<div class="modal-head"><h2>${record.id?'Edit':'Add'} ${esc(kind)}</h2><button class="x" onclick="closeModal()">×</button></div><form id="adminForm">${body}<button class="primary-btn" style="width:100%">Save</button></form>`, kind==='role'); $('#adminForm').onsubmit=async e=>{e.preventDefault(); const fd=new FormData(e.target); const data=Object.fromEntries(fd); ['active','soldOut'].forEach(k=>{ if(kind==='item'||kind==='category'||kind==='deal'||kind==='table'||kind==='taker'||kind==='payment'||kind==='user'||kind==='role') data[k]=fd.has(k); }); if(kind==='user') data.roleIds=fd.getAll('roleIds'); if(kind==='role') data.permissions=fd.getAll('permissions'); ['price','sort','seats'].forEach(k=>{if(k in data)data[k]=Number(data[k]||0)}); try{ const file=fd.get('uploadFile'); if(file && file.size){ data.imageUrl = await uploadFile(file); } delete data.uploadFile; await api(`/api/admin/${kind}`,data); closeModal(); await loadState(); renderShell(); toast('Saved'); }catch(err){toast(err.message,true);} }; }
function uploadFile(file){ return new Promise((resolve,reject)=>{ const r=new FileReader(); r.onload=async()=>{try{const j=await api('/api/upload-image',{filename:file.name,dataUrl:r.result});resolve(j.url)}catch(e){reject(e)}}; r.onerror=()=>reject(new Error('File read failed')); r.readAsDataURL(file); }); }
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
    <div class="card subcard"><h3>Branding</h3>${imageField(s.logoUrl)}<p class="muted-note">Logo is used on admin, receipt preview and future cloud/customer reports.</p>${input('currency','Currency',s.currency||'PKR')}</div>
    <div class="card subcard"><h3>Receipt Format</h3>${select('receiptWidth','Thermal Paper Width',s.receiptWidth||'80mm',[['80mm','80mm'],['58mm','58mm']])}${input('receiptCopies','Receipt Copies',s.receiptCopies||1,'number')}${input('receiptHeader','Receipt Header',s.receiptHeader)}${input('receiptFooter','Receipt Footer',s.receiptFooter)}<label class="check mb"><input type="checkbox" name="showLogoOnReceipt" ${s.showLogoOnReceipt?'checked':''}> Show logo on receipt</label><label class="check mb"><input type="checkbox" name="showCustomerOnReceipt" ${s.showCustomerOnReceipt?'checked':''}> Show customer details</label><label class="check mb"><input type="checkbox" name="showOrderTakerOnReceipt" ${s.showOrderTakerOnReceipt?'checked':''}> Show order taker</label><label class="check mb"><input type="checkbox" name="showCashierOnReceipt" ${s.showCashierOnReceipt?'checked':''}> Show cashier</label><label class="check mb"><input type="checkbox" name="showPaymentBreakdown" ${s.showPaymentBreakdown?'checked':''}> Show payment breakdown</label><button type="button" class="ghost-btn" id="receiptPreviewBtn">Preview Receipt</button></div>
    <div class="card subcard"><h3>Printer / Report</h3>${input('printerName','Printer Name',s.printerName||'Windows Default Printer')}${input('localAgentUrl','Local Print Agent URL',s.localAgentUrl||'http://127.0.0.1:9721/print')}${input('defaultDeliveryFee','Default Delivery Fee',s.defaultDeliveryFee,'number')}${input('managerPin','Manager PIN',s.managerPin)}${input('reportTitle','Report Title',s.reportTitle||'Sales Report')}${input('reportFooter','Report Footer',s.reportFooter||'Generated by SwiftTill POS')}<label class="check mb"><input type="checkbox" name="autoPrintReceipt" ${s.autoPrintReceipt?'checked':''}> Auto print receipt</label><label class="check mb"><input type="checkbox" name="rememberPrintChoice" ${s.rememberPrintChoice?'checked':''}> Remember print choice</label><label class="check mb"><input type="checkbox" name="reportShowBranding" ${s.reportShowBranding?'checked':''}> Show branding on reports</label></div>
    <div class="settings-save"><button class="primary-btn">Save Company & Format Settings</button></div>
  </form>`;
  $('#receiptPreviewBtn').onclick=()=>{ const sample={business:s.businessName,branchName:s.branchName,phone:s.phone,address:s.address,logoUrl:s.logoUrl,header:s.receiptHeader,footer:s.receiptFooter,receiptWidth:s.receiptWidth,showLogoOnReceipt:s.showLogoOnReceipt,showCustomerOnReceipt:s.showCustomerOnReceipt,showOrderTakerOnReceipt:s.showOrderTakerOnReceipt,showCashierOnReceipt:s.showCashierOnReceipt,showPaymentBreakdown:s.showPaymentBreakdown,number:'1001',date:new Date().toISOString(),cashier:state.user.name,type:'DINE_IN',table:'T3',guests:2,orderTaker:'Ali Ahmed',customer:'Walk-in',lines:[{name:'Zinger Burger',qty:2,price:650,modifiers:[{name:'Cheese',price:100}],note:'No onion'}],totals:{subtotal:1500,deliveryFee:0,discount:100,total:1400},payments:[{method:'Cash',amount:1400,received:1500,change:100}]}; $('#printArea').innerHTML=receiptHTML(sample); window.print(); };
  $('#settingsForm').onsubmit=async e=>{e.preventDefault();const fd=new FormData(e.target);const data=Object.fromEntries(fd);['autoPrintReceipt','rememberPrintChoice','showLogoOnReceipt','showCustomerOnReceipt','showOrderTakerOnReceipt','showCashierOnReceipt','showPaymentBreakdown','reportShowBranding'].forEach(k=>data[k]=fd.has(k));['defaultDeliveryFee','receiptCopies'].forEach(k=>{data[k]=Number(data[k]||0)});try{ const file=fd.get('uploadFile'); if(file && file.size){ data.logoUrl = await uploadFile(file); } else if(data.imageUrl){ data.logoUrl = data.imageUrl; } delete data.uploadFile; delete data.imageUrl; await api('/api/admin/settings',data);await loadState();renderShell();toast('Settings saved');}catch(err){toast(err.message,true);}};
}
function renderCloud(c){
  const s=state.settings;
  c.innerHTML=`<div class="module-title"><div><h3>Cloud, R2 & App Window</h3><p class="muted-note">Local-first now. GitHub, Render/Vercel, Neon and Cloudflare R2 are prepared for production stage.</p></div></div><form id="cloudForm" class="grid2"><div class="card subcard"><h3>Cloud API</h3>${input('cloudApiUrl','Cloud API URL',s.cloudApiUrl||'')}${input('backupTarget','Backup Target',s.backupTarget||'local-download-first-r2-later')}<p class="muted-note">Use after local testing is approved.</p></div><div class="card subcard"><h3>Cloudflare R2</h3>${input('r2Mode','R2 Mode',s.r2Mode||'local-placeholder')}${input('r2BucketName','R2 Bucket Name',s.r2BucketName||'')}${input('r2PublicUrl','R2 Public URL',s.r2PublicUrl||'')}<p class="muted-note">Images are local now; same image keys can sync to R2 later.</p></div><div class="card subcard"><h3>Print Agent</h3>${input('localAgentUrl','Local Agent URL',s.localAgentUrl||'http://127.0.0.1:9721/print')}${input('printMode','Print Mode',s.printMode||'browser-preview-now-local-agent-next')}${input('appWindowMode','App Window Mode',s.appWindowMode||'pwa-or-edge-app-window')}</div><div class="card subcard"><h3>Status</h3><p>GitHub: planned</p><p>Neon PostgreSQL: planned</p><p>Render/Vercel: planned</p><p>Cloudflare R2: planned</p></div><button class="primary-btn">Save Cloud Settings</button></form>`;
  $('#cloudForm').onsubmit=async e=>{e.preventDefault();const data=Object.fromEntries(new FormData(e.target));try{await api('/api/admin/settings',data);await loadState();renderShell();toast('Cloud settings saved');}catch(err){toast(err.message,true);}};
}
function renderBackup(c){ c.innerHTML=`<div class="module-title"><h3>Backup & Restore</h3></div><div class="grid2"><div class="card subcard"><h3>Manual Backup</h3><p class="muted-note">Downloads full local JSON database. Later this same flow can push backup files to Cloudflare R2.</p><button class="primary-btn" id="downloadBackup">Download Backup</button></div><div class="card subcard"><h3>Restore Backup</h3><p class="muted-note">Use only with a SwiftTill backup JSON file.</p><input type="file" id="restoreFile" accept="application/json"><button class="danger-btn mt" id="restoreBtn">Restore</button></div></div>`; $('#downloadBackup').onclick=()=>downloadApi('/api/backup/download',`swifttill-backup-${Date.now()}.json`).catch(e=>toast(e.message,true)); $('#restoreBtn').onclick=()=>{const file=$('#restoreFile').files[0];if(!file)return toast('Choose backup file',true);const r=new FileReader();r.onload=async()=>{try{await api('/api/backup/restore',JSON.parse(r.result));await loadState();renderShell();toast('Backup restored');}catch(e){toast(e.message,true)}};r.readAsText(file);}; }
setInterval(refreshLiveTimers,1000);
boot();
