const SUPABASE_URL = 'https://lucjxkzfyiwfhkoagqvv.supabase.co';
const SUPABASE_ANON = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Imx1Y2p4a3pmeWl3Zmhrb2FncXZ2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzQ2OTk1NzksImV4cCI6MjA5MDI3NTU3OX0.eyU2QsFc8Pdx4neFM1r-L_-srFBLadXGWbCIYp39mjU';

function showErr(msg) { document.getElementById('home-results').innerHTML = '<p style="color:#c5221f;padding:20px;text-align:center">❌ ' + msg + '</p>'; }

if (!window.supabase) { showErr('Supabase SDK not loaded'); throw Error(); }

let sb;
try { sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON, { auth: { persistSession: true } }); }
catch (e) { showErr('Supabase init: ' + e.message); throw e; }

const TYPE_MAP = { services: 'service', shops: 'shop', properties: 'property', 'product-shops': 'product_shop', 'used-saman': 'used_saman', product_shops: 'product_shop', used_saman: 'used_saman' };
let currentUser = null;
let allCats = { services: [], products: [], used: [] };
let pvPhotos = [];
let pvIndex = 0;
let userLocation = null;
let toastTimer = null;
let authListener = null;

function showToast(msg) {
  const el = document.getElementById('toast') || (() => {
    const t = document.createElement('div');
    t.id = 'toast'; t.style.cssText = 'position:fixed;bottom:80px;left:50%;transform:translateX(-50%);background:#323232;color:#fff;padding:12px 24px;border-radius:10px;font-size:.95rem;z-index:9999;opacity:0;transition:opacity .3s;white-space:nowrap';
    document.body.appendChild(t); return t;
  })();
  el.textContent = msg; el.style.opacity = '1'; clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.style.opacity = '0', 2000);
}

document.addEventListener('input', e => {
  if (e.target.classList.contains('cap')) e.target.value = e.target.value.replace(/\b\w/g, c => c.toUpperCase());
});
let isLoadingNearby = false;
let activeMainCat = 'all';

function $(id) { return document.getElementById(id); }

function getUser() { return sb.auth.getUser(); }

async function ensureSession() {
  const { data: { session } } = await sb.auth.getSession();
  if (session) {
    currentUser = session.user.id;
    localStorage.setItem('lm_user', session.user.id);
    let userName = session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'User';
    try {
      const { data: prof } = await sb.from('profiles').select('name').eq('id', currentUser).maybeSingle();
      if (prof && prof.name) userName = prof.name;
    } catch (e) {}
    localStorage.setItem('lm_user_name', userName);
  } else {
    currentUser = localStorage.getItem('lm_user') || null;
  }
  return session;
}

// ── Auth ──
async function doLogin() {
  const email = $('ac-email').value.trim();
  const password = $('ac-password').value;
  const errEl = $('ac-error'); errEl.style.display = 'none';
  if (!email || !password) { errEl.textContent = 'Email and password required'; errEl.style.display = 'block'; return; }
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    currentUser = data.user.id;
    localStorage.setItem('lm_user', data.user.id);
    let userName = data.user.user_metadata?.name || email.split('@')[0];
    try {
      const { data: prof } = await sb.from('profiles').select('name').eq('id', currentUser).maybeSingle();
      if (prof && prof.name) userName = prof.name;
    } catch (e) {}
    localStorage.setItem('lm_user_name', userName);
    updateUIForUser(); showView('home');
  } catch (e) { errEl.textContent = e.message; errEl.style.display = 'block'; }
}

async function doRegister() {
  const name = $('ac-name').value.trim();
  const email = $('ac-email').value.trim();
  const phone = $('ac-phone').value.trim();
  const password = $('ac-password').value;
  const errEl = $('ac-error'); errEl.style.display = 'none';
  if (!name || !password) { errEl.textContent = 'Name and password required'; errEl.style.display = 'block'; return; }
  try {
    const { data, error } = await sb.auth.signUp({
      email: email || name.replace(/\s/g,'').toLowerCase() + '@localmarket.app',
      password,
      options: { data: { name, phone: phone || null } }
    });
    if (error) throw error;
    // Create profile
    const { error: perr } = await sb.from('profiles').upsert({
      id: data.user.id, name, email: email || null, phone: phone || null, role: 'customer'
    });
    if (perr) console.error('Profile error:', perr);
    currentUser = data.user.id;
    localStorage.setItem('lm_user', data.user.id);
    localStorage.setItem('lm_user_name', name);
    updateUIForUser(); showView('home');
  } catch (e) { errEl.textContent = e.message; errEl.style.display = 'block'; }
}

async function logout() {
  await sb.auth.signOut();
  currentUser = null;
  localStorage.removeItem('lm_user'); localStorage.removeItem('lm_token'); localStorage.removeItem('lm_user_name');
  updateUIForUser(); showView('account');
}

async function loginAsAdmin() {
  const email = prompt('Admin email:');
  const password = prompt('Admin password:');
  if (!email || !password) return;
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
    // Check if admin
    const { data: prof } = await sb.from('profiles').select('role').eq('id', data.user.id).single();
    if (prof?.role !== 'admin') { await sb.auth.signOut(); alert('Not an admin account'); return; }
    currentUser = data.user.id;
    localStorage.setItem('lm_user', data.user.id);
    localStorage.setItem('lm_user_name', 'Admin');
    updateUIForUser(); showView('admin');
  } catch (e) { alert('Error: ' + e.message); }
}

function showAccountForm(mode) {
  const tabLogin = $('ac-tab-login'), tabReg = $('ac-tab-register');
  const nameEl = $('ac-name'), phoneEl = $('ac-phone'), btn = $('ac-form').querySelector('button'), errEl = $('ac-error');
  errEl.style.display = 'none';
  if (mode === 'register') {
    tabLogin.style.background = '#e8eaed'; tabLogin.style.color = '#333';
    tabReg.style.background = '#1a73e8'; tabReg.style.color = '#fff';
    nameEl.style.display = 'block'; phoneEl.style.display = 'block';
    btn.textContent = 'Register'; btn.onclick = doRegister;
  } else {
    tabReg.style.background = '#e8eaed'; tabReg.style.color = '#333';
    tabLogin.style.background = '#1a73e8'; tabLogin.style.color = '#fff';
    nameEl.style.display = 'none'; phoneEl.style.display = 'none';
    btn.textContent = 'Login'; btn.onclick = doLogin;
  }
}

// ── Views ──
function showView(name) {
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  const el = $(name ? 'view-' + name : 'view-home');
  if (el) el.classList.add('active');
  $('cat-dropdown').style.display = 'none';
  const header = document.querySelector('.header'), cats = $('cat-scroll');
  if (name === 'admin') header.style.display = 'none'; else header.style.display = '';
  if (name === 'home' || !name) cats.style.display = ''; else cats.style.display = 'none';
  document.querySelectorAll('.nav-item').forEach(n => n.classList.toggle('active', n.dataset.view === name));
  window.scrollTo(0, 0);
  updateUIForUser();
  if (name === 'add' && !currentUser) { showView('account'); showAccountForm('register'); return; }
  if ((name === 'add-service' || name === 'add-shop' || name === 'add-property' || name === 'add-product-shop' || name === 'add-used-saman') && !currentUser) { showView('account'); showAccountForm('register'); return; }
  if (name === 'my') loadMy('services');
  if (name === 'favorites') loadFavorites();
  if (name === 'admin') { showAdminSection('listing'); loadAdminListing(); }
  if (name === 'plans') loadPlans();
  if (name === 'home' || name === undefined) { showMainCats(); showAllNearby(); }
  if (name && (name.startsWith('add-') || name.startsWith('view-add-'))) {
    if (userLocation) { document.querySelectorAll('.f-lat').forEach(el => el.value = userLocation.lat); document.querySelectorAll('.f-lng').forEach(el => el.value = userLocation.lng); }
  }
}

async function updateUIForUser() {
  const btn = $('login-btn'), acAdmin = $('ac-admin-link');
  const loggedIn = $('account-logged-in'), loggedOut = $('account-logged-out');
  await ensureSession();
  if (currentUser) {
    let userName = localStorage.getItem('lm_user_name') || 'User';
    let userEmail = '';
    let userPhone = '';
    let isAdmin = false;
    let roleLabel = 'Customer';
    try {
      const { data: prof } = await sb.from('profiles').select('name, email, phone, role').eq('id', currentUser).maybeSingle();
      if (prof) {
        if (prof.name) userName = prof.name;
        if (prof.email) userEmail = prof.email;
        if (prof.phone) userPhone = prof.phone;
        if (prof.role === 'admin') { isAdmin = true; roleLabel = 'Admin'; }
      }
    } catch (e) {}
    localStorage.setItem('lm_user_name', userName);
    const cleanName = userName.replace(/^\p{Emoji}+/u, '').trim();
    const initial = (cleanName ? cleanName.charAt(0) : 'U').toUpperCase();
    btn.innerHTML = `<span class="avatar-circle" title="${userName}">${initial}</span>`;
    btn.classList.add('avatar-mode');
    acAdmin.style.display = isAdmin ? 'block' : 'none';
    if (loggedIn) {
      loggedIn.style.display = 'block';
      const info = $('account-info');
      if (info) {
        let detailsHtml = '<p style="font-weight:700;font-size:1.15rem;margin-bottom:4px">👤 ' + userName + '</p>';
        if (userEmail) detailsHtml += '<p style="font-size:.85rem;color:var(--text-secondary);margin-bottom:2px">📧 ' + userEmail + '</p>';
        if (userPhone) detailsHtml += '<p style="font-size:.85rem;color:var(--text-secondary);margin-bottom:2px">📞 ' + userPhone + '</p>';
        if (isAdmin) {
          const badgeStyle = 'background:rgba(220,38,38,0.1);color:#dc2626;border:1px solid rgba(220,38,38,0.15)';
          detailsHtml += '<span style="display:inline-block;font-size:0.75rem;font-weight:700;padding:3px 10px;border-radius:12px;margin-top:6px;' + badgeStyle + '">' + roleLabel + '</span>';
        }
        info.innerHTML = detailsHtml;
      }
    }
    if (loggedOut) loggedOut.style.display = 'none';
  } else {
    btn.textContent = 'Login';
    btn.classList.remove('avatar-mode');
    acAdmin.style.display = 'none';
    if (loggedIn) loggedIn.style.display = 'none';
    if (loggedOut) loggedOut.style.display = 'block';
  }
  document.querySelectorAll('.f-owner').forEach(el => { if (currentUser) el.value = currentUser; });
  checkNotifications();
}

// ── Categories ──
const catPrimary = [
  { label: '⭐ All', key: 'all' },
  { label: '👷 Services', key: 'services' },
  { label: '🏪 Shops & Utilities', key: 'product-shops' },
  { label: '🏢 Commercial (Shops)', key: 'shops' },
  { label: '🏠 Properties', key: 'properties' },
  { label: '📦 Used Saman', key: 'used-saman' },
];
const catSub = { services: [], 'product-shops': [], shops: [], properties: [], 'used-saman': [] };

async function loadCategories() {
  async function fetchCat(table) {
    try { const { data } = await sb.from(table).select('*').order('sort_order'); return data || []; }
    catch (e) { console.warn('Failed to load', table, e); return []; }
  }
  const [scData, pcData, ucData] = await Promise.all([
    fetchCat('service_categories'),
    fetchCat('product_categories'),
    fetchCat('used_saman_categories'),
  ]);
  // Hardcoded fallbacks if DB is empty
  const defSc = scData.length ? scData : [{id:1,name:'Mazdoor / Labour',icon:'👷'},{id:2,name:'Mistri / Construction',icon:'🔨'},{id:3,name:'Plumber',icon:'💧'},{id:4,name:'Electrician',icon:'⚡'},{id:5,name:'Carpenter',icon:'🪟'},{id:6,name:'Painter',icon:'🎨'},{id:7,name:'AC Mechanic',icon:'❄️'},{id:8,name:'General Mechanic',icon:'🔧'},{id:9,name:'Welder',icon:'🔩'},{id:10,name:'Tile / Floor Work',icon:'🏗️'},{id:11,name:'Roof Work',icon:'🏠'},{id:12,name:'Wakeel / Lawyer',icon:'⚖️'},{id:13,name:'Tutor / Teacher',icon:'📖'},{id:14,name:'Property Dealer',icon:'💼'},{id:15,name:'Other Service',icon:'🛠️'}];
  const defPc = pcData.length ? pcData : [
    {id:1,name:'General Store',icon:'🏪'},{id:2,name:'Medical Store',icon:'💊'},{id:3,name:'Mobile Shop',icon:'📱'},
    {id:4,name:'Clothing',icon:'👕'},{id:5,name:'Electronics',icon:'💻'},{id:6,name:'Stationery',icon:'📚'},
    {id:7,name:'Cosmetics',icon:'💄'},{id:8,name:'Hardware',icon:'🔩'},{id:9,name:'Bakery',icon:'🥖'},
    {id:10,name:'Other Shop',icon:'🏬'},{id:11,name:'Darzi / Tailor Shop',icon:'🪡'},
    {id:12,name:'Petrol Pump',icon:'⛽'},{id:13,name:'EV Charging Station',icon:'⚡'},{id:14,name:'ATM Machine',icon:'🏦'}
  ];
  const defUc = ucData.length ? ucData : [{id:1,name:'Electronics',icon:'📱'},{id:2,name:'Furniture',icon:'🪑'},{id:3,name:'Vehicles',icon:'🚗'},{id:4,name:'Books',icon:'📚'},{id:5,name:'Clothing',icon:'👕'},{id:6,name:'Home Appliances',icon:'🏠'},{id:7,name:'Sports',icon:'🏏'},{id:8,name:'Other',icon:'📦'}];
  allCats = { services: defSc, products: defPc, used: defUc };
  catSub.services = [{ label: 'All Services', endpoint: 'services', filter: null }];
  defSc.forEach(c => catSub.services.push({ label: c.icon + ' ' + c.name.split('/')[0].trim(), endpoint: 'services', filter: 'category_id=' + c.id }));
  catSub['product-shops'] = [{ label: 'All Shops & Utilities', endpoint: 'product-shops', filter: null }];
  defPc.forEach(c => catSub['product-shops'].push({ label: c.icon + ' ' + c.name.split('/')[0].trim(), endpoint: 'product-shops', filter: 'category_id=' + c.id }));
  catSub.shops = [{ label: '🏢 All Commercial Shops', endpoint: 'shops', filter: null }, { label: '🛒 For Rent', endpoint: 'shops', filter: 'type=rent' }, { label: '💰 For Sale', endpoint: 'shops', filter: 'type=sale' }];
  catSub.properties = [{ label: '🏠 All Properties', endpoint: 'properties', filter: null }, { label: '🏡 House Rent', endpoint: 'properties', filter: 'house_rent' }, { label: '🏡 House Sale', endpoint: 'properties', filter: 'house_sale' }, { label: '🏢 Apartment Rent', endpoint: 'properties', filter: 'apartment_rent' }, { label: '🏢 Apartment Sale', endpoint: 'properties', filter: 'apartment_sale' }];
  catSub['used-saman'] = [{ label: 'All Used', endpoint: 'used-saman', filter: null }];
  defUc.forEach(c => catSub['used-saman'].push({ label: c.icon + ' ' + c.name.split('/')[0].trim(), endpoint: 'used-saman', filter: 'category_id=' + c.id }));
  // Populate add form category dropdowns
  function fillSel(id, data) { const el = $(id); if (!el) return; el.innerHTML = '<option value="">Select</option>'; data.forEach(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.icon + ' ' + c.name; el.appendChild(o); }); }
  fillSel('as-cat', defSc);
  fillSel('aps-cat', defPc);
  fillSel('aus-cat', defUc);
  showMainCats();
}

function buildChips(chips, scroll) {
  scroll.innerHTML = '';
  chips.forEach(ch => {
    const chip = document.createElement('span'); 
    chip.className = 'cat-chip' + (ch.active ? ' active' : ''); 
    chip.textContent = ch.label;
    chip.onclick = ch.onclick; 
    scroll.appendChild(chip);
  });
}

function showMainCats() {
  $('cat-dropdown').style.display = 'none';
  buildChips(catPrimary.map(p => ({
    label: p.label, 
    active: p.key === activeMainCat,
    onclick: () => { 
      activeMainCat = p.key;
      showMainCats();
      if (p.key === 'all') { 
        showAllNearby(); 
        return; 
      } 
      showSubCats(p.key); 
    }
  })), $('cat-scroll'));
}

function showSubCats(key) {
  const subs = catSub[key]; if (!subs) return;
  const dd = $('cat-dropdown'); 
  dd.style.display = 'grid';
  dd.innerHTML = '<span class="sub-chip" onclick="activeMainCat=\'all\';showMainCats();showAllNearby();">← Home</span>';
  subs.forEach(s => {
    const chip = document.createElement('span'); chip.className = 'sub-chip';
    const icon = s.label.match(/^(\p{Emoji}+)/u)?.[1] || '';
    const text = s.label.replace(/^\p{Emoji}+/u, '').trim();
    const parts = text.split(/\s*&\s*/);
    let inner = '';
    if (icon) {
      inner = '<span class="sci">' + icon + '</span>';
      if (parts.length > 1) inner += '<span class="sct">' + parts[0].trim() + ' &</span><span class="sct">' + parts.slice(1).join(' & ').trim() + '</span>';
      else inner += '<span class="sct">' + text + '</span>';
    } else inner = text;
    chip.innerHTML = inner;
    chip.onclick = () => { dd.querySelectorAll('.sub-chip').forEach(c => c.classList.remove('active')); chip.classList.add('active'); dd.style.display = 'none'; loadListingsByType(s.endpoint, null, s.filter); };
    dd.appendChild(chip);
  });
  dd.querySelectorAll('.sub-chip')[1]?.classList.add('active');
}

// ── Nearby / Home ──
function haversine(lat1, lng1, lat2, lng2) {
  const R = 6371000; const dLat = (lat2 - lat1) * Math.PI / 180; const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180)*Math.cos(lat2*Math.PI/180)*Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

async function fetchListings(table, type) {
  const { data } = await sb.from(table).select('*').eq('status', 'active').order('created_at', { ascending: false });
  return (data || []).map(i => ({ ...i, _type: type }));
}

async function showAllNearby() {
  if (isLoadingNearby) return;
  isLoadingNearby = true;
  showView('home');
  const el = $('home-results');
  if (!userLocation) {
    const types = ['services', 'shops', 'properties', 'product-shops', 'used-saman'];
    el.innerHTML = '<p class="hint">Loading...</p>';
    try {
      const results = await Promise.all(types.map(t => fetchListings(t === 'product-shops' ? 'product_shops' : t === 'used-saman' ? 'used_saman' : t, t)));
      let all = results.flat();
      if (!all.length) { el.innerHTML = '<p class="hint">Nothing found</p>'; isLoadingNearby = false; return; }
      el.innerHTML = '';
      for (const item of all) { try { await renderCard(el, item._type, item); } catch (e) { console.error(e); } }
      fillFavHearts(el);
    } catch (e) { el.innerHTML = '<p class="hint">Error loading listings</p>'; }
    isLoadingNearby = false; return;
  }
  el.innerHTML = '<p class="hint">Loading...</p>';
  const types = ['services', 'shops', 'properties', 'product-shops', 'used-saman'];
  try {
    const results = await Promise.all(types.map(t => fetchListings(t === 'product-shops' ? 'product_shops' : t === 'used-saman' ? 'used_saman' : t, t)));
    let all = results.flat();
    all.forEach(item => {
      if (item.lat && item.lng) item.distance_m = Math.round(haversine(userLocation.lat, userLocation.lng, item.lat, item.lng));
      else item.distance_m = null;
    });
    all.sort((a, b) => {
      if (a.distance_m === null && b.distance_m === null) return 0;
      if (a.distance_m === null) return 1; if (b.distance_m === null) return -1;
      return a.distance_m - b.distance_m;
    });
    if (!all.length) { el.innerHTML = '<p class="hint">Nothing found</p>'; isLoadingNearby = false; return; }
    el.innerHTML = '';
    for (const item of all) { try { await renderCard(el, item._type, item); } catch (e) { console.error(e); } }
    fillFavHearts(el);
  } catch (e) { el.innerHTML = '<p class="hint">Error loading listings</p>'; }
  isLoadingNearby = false;
}

async function loadListingsByType(type, catId, extraFilter) {
  if (!userLocation) { requireLocation(loc => { if (loc) loadListingsByType(type, catId, extraFilter); }); return; }
  showView(type);
  const listId = { services: 'svc-list', shops: 'shop-list', properties: 'prop-list', 'product-shops': 'ps-list', 'used-saman': 'used-list' }[type] || 'svc-list';
  const el = $(listId); if (!el) return;
  try {
    let query = sb.from(type === 'product-shops' ? 'product_shops' : type === 'used-saman' ? 'used_saman' : type).select('*').eq('status', 'active');
    if (catId) query = query.eq('category_id', parseInt(catId));
    const { data } = await query;
    let items = data || [];
    if (extraFilter) {
      if (extraFilter.startsWith('category_id=')) items = items.filter(i => i.category_id === parseInt(extraFilter.split('=')[1]));
      else if (extraFilter.startsWith('type=')) items = items.filter(i => i.type === extraFilter.split('=')[1]);
      else if (extraFilter === 'house_rent') items = items.filter(i => i.property_type === 'house' && i.listing_type === 'rent');
      else if (extraFilter === 'house_sale') items = items.filter(i => i.property_type === 'house' && i.listing_type === 'sale');
      else if (extraFilter === 'apartment_rent') items = items.filter(i => i.property_type === 'apartment' && i.listing_type === 'rent');
      else if (extraFilter === 'apartment_sale') items = items.filter(i => i.property_type === 'apartment' && i.listing_type === 'sale');
    }
    items.forEach(item => { if (item.lat && item.lng) item.distance_m = Math.round(haversine(userLocation.lat, userLocation.lng, item.lat, item.lng)); else item.distance_m = null; });
    items.sort((a, b) => {
      const distA = a.distance_m !== null && a.distance_m !== undefined ? a.distance_m : 999999;
      const distB = b.distance_m !== null && b.distance_m !== undefined ? b.distance_m : 999999;
      return distA - distB;
    });
    if (!items.length) { el.innerHTML = '<p class="hint">No listings found</p>'; return; }
    el.innerHTML = '';
    for (const item of items) { try { await renderCard(el, type, item); } catch (e) { console.error(e); } }
    fillFavHearts(el);
  } catch (e) { el.innerHTML = '<p class="hint">Error: ' + e.message + '</p>'; }
}

// ── Card Render ──
async function renderCard(el, type, item, opts = {}) {
  const card = document.createElement('div'); card.className = 'listing-card';
  card.onclick = () => showDetail(type, item.id);
  const title = item.provider_name || item.title || item.shop_name || 'Listing';
  const dist = (item.distance_m !== null && item.distance_m !== undefined) ? (item.distance_m >= 1000 ? (item.distance_m / 1000).toFixed(1) + ' km' : Math.round(item.distance_m) + ' m') + ' away' : '';
  const description = item.description ? item.description.slice(0, 80) + (item.description.length > 80 ? '...' : '') : '';
  let openClose = '';
  if (type === 'product-shops' && item.opening_time && item.closing_time) {
    function fmt12(t) { const [h,m]=t.split(':'); const hh=parseInt(h); return (hh%12||12)+':'+m+(hh<12?' AM':' PM'); }
    const now = new Date(); const curMin = now.getHours() * 60 + now.getMinutes();
    const [oh, om] = item.opening_time.split(':').map(Number); const [ch, cm] = item.closing_time.split(':').map(Number);
    const openMin = oh * 60 + om; const closeMin = ch * 60 + cm;
    const isOpen = (closeMin > openMin) ? (curMin >= openMin && curMin < closeMin) : (curMin >= openMin || curMin < closeMin);
    openClose = isOpen ? '<span class="status-open">Open Now</span> <span class="status-close-inline">Closes ' + fmt12(item.closing_time) + '</span>' : '<span class="status-closed">Closed Now</span> <span class="status-open-inline">Opens ' + fmt12(item.opening_time) + '</span>';
  }
  let avail = '';
  if (type === 'services' && item.availability) {
    avail = item.availability === 'available' ? '<span class="status-open">Available Now</span>' : '<span class="status-closed">Busy' + (item.busy_until ? ' till ' + item.busy_until : '') + '</span>';
  }
  let price = '';
  if (item.price) {
    const amt = Number(item.price).toLocaleString();
    if ((type === 'shops' && item.type === 'rent') || (type === 'properties' && item.listing_type === 'rent')) price = amt + '/month';
    else price = 'Rs ' + amt;
  }
  const location = (item.area || '') + ', ' + (item.city || '');
  let categoryLabel = '';
  if (type === 'shops') categoryLabel = item.type === 'rent' ? 'Shop for Rent' : item.type === 'sale' ? 'Shop for Sale' : '';
  else if (type === 'properties') {
    const pt = item.property_type ? item.property_type.charAt(0).toUpperCase() + item.property_type.slice(1) : '';
    const lt = item.listing_type ? 'for ' + item.listing_type.charAt(0).toUpperCase() + item.listing_type.slice(1) : '';
    categoryLabel = pt + ' ' + lt;
  } else if (item.condition && type !== 'used-saman') categoryLabel = item.condition.replace(/_/g, ' ');
  else { const cats = allCats[type === 'product-shops' ? 'products' : type === 'used-saman' ? 'used' : type]; if (cats) { const c = cats.find(cat => cat.id === item.category_id); if (c) categoryLabel = c.name; } }
  let photoUrl = null;
  try {
    const { data: photos } = await sb.from('listing_photos').select('url').eq('listing_type', TYPE_MAP[type] || type).eq('listing_id', item.id).order('order_num').limit(1);
    if (photos && photos.length) photoUrl = photos[0].url;
  } catch (e) {}
  let footerRow = '';
  if (price || dist) {
    const pinSvg = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="margin-right:3px;vertical-align:middle;display:inline-block"><path d="M20 10c0 6-8 12-8 12s-8-6-8-12a8 8 0 0 1 16 0Z"/><circle cx="12" cy="10" r="3"/></svg>';
    footerRow = '<div class="card-footer-row">';
    if (price) footerRow += '<span class="card-price">' + price + '</span>';
    if (dist) footerRow += '<span class="card-dist-badge">' + pinSvg + dist + '</span>';
    footerRow += '</div>';
  }
  card.innerHTML = '<div class="card-horizontal"><div class="card-img">' + (photoUrl ? '<img src="' + photoUrl + '" class="card-thumb" onerror="this.style.display=\'none\';this.parentElement.innerHTML=\'<div class=card-img-placeholder>📷</div>\'">' : '<div class="card-img-placeholder">📷</div>') + (currentUser && opts.showFav !== false ? '<span class="fav-btn" data-type="' + type + '" data-id="' + item.id + '" onclick="event.stopPropagation();toggleFav(this)">🤍</span>' : '') + '</div><div class="card-info"><div class="card-title">' + title + '</div>' + (categoryLabel ? '<div class="card-category">' + categoryLabel + '</div>' : '') + (location && location !== ', ' ? '<div class="card-loc">' + location + '</div>' : '') + (openClose ? '<div class="card-hours">' + openClose + '</div>' : '') + (avail ? '<div class="card-hours">' + avail + '</div>' : '') + footerRow + '</div></div>';
  el.appendChild(card);
}

// ── Favorites ──
async function fillFavHearts(container) {
  if (!currentUser) return;
  try {
    const { data: items } = await sb.from('favorites').select('listing_type, listing_id').eq('user_id', currentUser);
    if (!items) return;
    const keys = new Set(items.map(i => i.listing_type + ':' + i.listing_id));
    (container || document).querySelectorAll('.fav-btn').forEach(b => { if (keys.has(b.dataset.type + ':' + b.dataset.id)) b.textContent = '❤️'; });
  } catch (e) {}
}

async function toggleFav(el) {
  if (!currentUser) { showView('account'); showAccountForm('register'); return; }
  const type = el.dataset.type; const id = parseInt(el.dataset.id);
  try {
    const { data: existing } = await sb.from('favorites').select('id').eq('user_id', currentUser).eq('listing_type', type).eq('listing_id', id);
    if (existing && existing.length) {
      await sb.from('favorites').delete().eq('user_id', currentUser).eq('listing_type', type).eq('listing_id', id);
      el.textContent = '🤍';
    } else {
      await sb.from('favorites').insert({ user_id: currentUser, listing_type: type, listing_id: id });
      el.textContent = '❤️';
    }
  } catch (e) { alert('Error: ' + e.message); }
}

async function loadFavorites() {
  const el = $('fav-list'); el.innerHTML = '<p class="hint">Loading...</p>';
  try {
    const { data: favs } = await sb.from('favorites').select('listing_type, listing_id').eq('user_id', currentUser).order('created_at', { ascending: false });
    if (!favs || !favs.length) { el.innerHTML = '<p class="hint">No favorites yet</p>'; return; }
    const tableMap = { services:'services', shops:'shops', properties:'properties', 'product-shops':'product_shops', 'used-saman':'used_saman' };
    const items = [];
    for (const f of favs) {
      const table = tableMap[f.listing_type] || f.listing_type.replace(/-/g, '_');
      const { data } = await sb.from(table).select('*').eq('id', f.listing_id).single();
      if (data) { data._type = f.listing_type; items.push(data); }
    }
    if (!items.length) { el.innerHTML = '<p class="hint">No favorites yet</p>'; return; }
    el.innerHTML = '';
    for (const item of items) { try { await renderCard(el, item._type, item); } catch (e) { console.error(e); } }
    el.querySelectorAll('.fav-btn').forEach(b => b.textContent = '❤️');
  } catch (e) { el.innerHTML = '<p class="hint">Error: ' + e.message + '</p>'; }
}

// ── Search ──
function onSearchTypeChange() {
  const type = $('s-type').value; const catEl = $('s-category');
  if (!type) { catEl.style.display = 'none'; return; }
  catEl.style.display = 'block';
  const catUrls = { services: 'service_categories', 'product-shops': 'product_categories', 'used-saman': 'used_saman_categories' };
  if (catUrls[type]) {
    catEl.innerHTML = '<option value="">All Categories</option>';
    sb.from(catUrls[type]).select('*').order('sort_order').then(({ data }) => {
      (data || []).forEach(c => { const o = document.createElement('option'); o.value = c.id; o.textContent = c.icon + ' ' + c.name; catEl.appendChild(o); });
    }).catch(() => {});
  } else {
    catEl.innerHTML = '<option value="">All</option>';
    if (type === 'shops') catEl.innerHTML += '<option value="rent">For Rent</option><option value="sale">For Sale</option>';
    else if (type === 'properties') catEl.innerHTML += '<option value="house_rent">House Rent</option><option value="house_sale">House Sale</option><option value="apartment_rent">Apt Rent</option><option value="apartment_sale">Apt Sale</option>';
    else catEl.style.display = 'none';
  }
}

async function doSearch() {
  if (!userLocation) { requireLocation(loc => { if (loc) doSearch(); }); return; }
  const kw = $('s-keyword').value.trim().toLowerCase();
  const type = $('s-type').value;
  const cat = $('s-category').value;
  const priceFrom = parseFloat($('s-price-from').value) || 0;
  const priceTo = parseFloat($('s-price-to').value) || 0;
  const el = $('s-results');
  el.innerHTML = '<p class="hint">Searching...</p>';
  
  let items = [];
  try {
    if (!type) {
      // Search all tables (Global Search)
      const tables = ['services', 'shops', 'properties', 'product_shops', 'used_saman'];
      const results = await Promise.all(tables.map(t => sb.from(t).select('*').eq('status', 'active')));
      results.forEach((res, idx) => {
        const table = tables[idx];
        const mappedType = table.replace('_', '-');
        (res.data || []).forEach(item => {
          item._type = mappedType;
          items.push(item);
        });
      });
    } else {
      const table = type === 'product-shops' ? 'product_shops' : type === 'used-saman' ? 'used_saman' : type;
      const { data } = await sb.from(table).select('*').eq('status', 'active');
      (data || []).forEach(item => {
        item._type = type;
        items.push(item);
      });
    }

    // Apply keyword filter
    if (kw) {
      items = items.filter(i => 
        (i.provider_name || i.title || i.shop_name || '').toLowerCase().includes(kw) || 
        (i.description || '').toLowerCase().includes(kw) || 
        (i.area || '').toLowerCase().includes(kw) ||
        (i.city || '').toLowerCase().includes(kw)
      );
    }

    // Apply category / subcategory sub-filters
    if (cat) {
      if (cat === 'rent' || cat === 'sale') {
        items = items.filter(i => i.type === cat);
      } else if (cat === 'house_rent') {
        items = items.filter(i => i.property_type === 'house' && i.listing_type === 'rent');
      } else if (cat === 'house_sale') {
        items = items.filter(i => i.property_type === 'house' && i.listing_type === 'sale');
      } else if (cat === 'apartment_rent') {
        items = items.filter(i => i.property_type === 'apartment' && i.listing_type === 'rent');
      } else if (cat === 'apartment_sale') {
        items = items.filter(i => i.property_type === 'apartment' && i.listing_type === 'sale');
      } else if (!isNaN(cat)) {
        items = items.filter(i => i.category_id === parseInt(cat));
      }
    }

    // Distance calculation
    items.forEach(item => { 
      if (item.lat && item.lng) {
        item.distance_m = Math.round(haversine(userLocation.lat, userLocation.lng, item.lat, item.lng)); 
      } else {
        item.distance_m = null; 
      }
    });

    // Sort by nearest
    items.sort((a, b) => {
      if (a.distance_m === null && b.distance_m === null) return 0;
      if (a.distance_m === null) return 1;
      if (b.distance_m === null) return -1;
      return a.distance_m - b.distance_m;
    });

    // Apply price bounds
    if (priceFrom > 0) items = items.filter(i => i.price >= priceFrom);
    if (priceTo > 0) items = items.filter(i => i.price <= priceTo);

    if (!items.length) { el.innerHTML = '<p class="hint">Nothing found</p>'; return; }
    el.innerHTML = '';
    for (const item of items) { 
      try { 
        await renderCard(el, item._type, item); 
      } catch (e) { 
        console.error(e); 
      } 
    }
    fillFavHearts(el);
  } catch (e) { 
    el.innerHTML = '<p class="hint">Error: ' + e.message + '</p>'; 
  }
}

// ── Location ──
function getLocation(callback) {
  const locText = $('loc-text');
  if (navigator.geolocation) {
    locText.textContent = 'Locating...';
    navigator.geolocation.getCurrentPosition(
      pos => {
        userLocation = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        locText.textContent = pos.coords.latitude.toFixed(3) + ', ' + pos.coords.longitude.toFixed(3);
        document.querySelectorAll('.f-lat').forEach(el => el.value = userLocation.lat);
        document.querySelectorAll('.f-lng').forEach(el => el.value = userLocation.lng);
        if (callback) callback(true);
        showAllNearby();
      },
      err => { console.warn('GPS error', err); locText.textContent = 'Tap to retry'; ipFallback(callback); },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 }
    );
  } else {
    locText.textContent = 'Not supported';
    ipFallback(callback);
  }
}

async function ipFallback(callback) {
  const locText = $('loc-text');
  locText.textContent = 'IP lookup...';
  try {
    const r = await fetch('https://ipwho.is/');
    if (r.ok) {
      const d = await r.json();
      if (d.latitude && d.longitude) {
        userLocation = { lat: d.latitude, lng: d.longitude };
        locText.textContent = d.latitude.toFixed(3) + ', ' + d.longitude.toFixed(3);
        document.querySelectorAll('.f-lat').forEach(el => el.value = userLocation.lat);
        document.querySelectorAll('.f-lng').forEach(el => el.value = userLocation.lng);
        if (callback) callback(true);
        showAllNearby();
        return;
      }
    }
  } catch (_) {}
  locText.textContent = userLocation ? userLocation.lat.toFixed(3) + ', ' + userLocation.lng.toFixed(3) : 'Tap to retry';
  if (callback) callback(!!userLocation);
  showAllNearby();
}
function requireLocation(callback) { if (userLocation) { callback(true); return; } getLocation(callback); }
function showLoading(el, msg) { el.innerHTML = '<p class="hint">' + (msg || 'Loading...') + '</p>'; }

// ── Add Listing ──
async function addListing(endpoint, form, e) {
  e.preventDefault();
  if (!currentUser) { showView('account'); showAccountForm('register'); return; }
  if (!userLocation) { requireLocation(loc => { if (loc) addListing(endpoint, form, e); }); return; }
  const data = {};
  new FormData(form).forEach((v, k) => { if (v) data[k] = k === 'corner_shop' || k === 'corner' || k === 'parking' ? 1 : v; });
  if (data.corner_shop === undefined && form.querySelector('[name=corner_shop]')) data.corner_shop = 0;
  if (data.corner === undefined && form.querySelector('[name=corner]')) data.corner = 0;
  if (data.parking === undefined && form.querySelector('[name=parking]')) data.parking = 0;
  data.lat = userLocation.lat; data.lng = userLocation.lng;
  const editId = form.dataset.editId;
  const btn = form.querySelector('button[type=submit]');
  if (!editId && endpoint !== 'services' && endpoint !== 'product_shops') {
    const files = form.querySelector('.photo-input').files;
    if (files.length < 3) { alert('Minimum 3 photos required'); return; }
    if (files.length > 6) { alert('Maximum 6 photos allowed'); return; }
  } else if (editId && endpoint !== 'services' && endpoint !== 'product_shops') {
    const files = form.querySelector('.photo-input').files;
    if (files.length > 0 && files.length < 3) { alert('Minimum 3 photos required if you choose to upload new photos'); return; }
    if (files.length > 6) { alert('Maximum 6 photos allowed'); return; }
  } else {
    const files = form.querySelector('.photo-input').files;
    if (files && files.length > 6) { alert('Maximum 6 photos allowed'); return; }
  }
  if (data.whatsapp) { const digits = data.whatsapp.replace(/[^0-9]/g, '').replace(/^0+/, ''); data.whatsapp = digits.startsWith('92') ? digits : '92' + digits; }
  ['opening', 'closing'].forEach(prefix => {
    const h = data[prefix + '_hour'], m = data[prefix + '_min'], ampm = data[prefix + '_ampm'];
    if (h && m) { let hh = parseInt(h); if (ampm === 'PM' && hh < 12) hh += 12; if (ampm === 'AM' && hh === 12) hh = 0; data[prefix + '_time'] = String(hh).padStart(2, '0') + ':' + m; }
    delete data[prefix + '_hour']; delete data[prefix + '_min']; delete data[prefix + '_ampm'];
  });
  ['h1o','h1c','h2o','h2c'].forEach(prefix => {
    const h = data[prefix + '_hour'], m = data[prefix + '_min'], ampm = data[prefix + '_ampm'];
    if (h && m) { let hh = parseInt(h); if (ampm === 'PM' && hh < 12) hh += 12; if (ampm === 'AM' && hh === 12) hh = 0; const ts = String(hh).padStart(2, '0') + ':' + m; data[prefix.charAt(2) === 'o' ? 'half_open' : 'half_close'] = ts; }
    delete data[prefix + '_hour']; delete data[prefix + '_min']; delete data[prefix + '_ampm'];
  });
  ['price', 'experience_years', 'size_sqft', 'size_marla', 'bedrooms', 'bathrooms', 'floor_number', 'total_floors', 'category_id', 'lat', 'lng'].forEach(f => { if (data[f]) data[f] = parseFloat(data[f]); });
  data.owner_id = currentUser;
  btn.disabled = true; btn.textContent = 'Saving...';
  const table = endpoint === 'product-shops' ? 'product_shops' : endpoint === 'used-saman' ? 'used_saman' : endpoint;
  let insertResult = null;
  try {
    let status = 'active';
    if (!editId) {
      const { data: appSettings } = await sb.from('app_settings').select('*');
      if (appSettings) {
        const s = {}; appSettings.forEach(r => s[r.key] = r);
        const appMode = s.app_mode?.value || 'free';
        const approvalRequired = s.approval_required?.value === 'true';
        const mazdoorApproval = s.mazdoor_approval_required?.value === 'true';
        if (appMode === 'billing') {
          const { data: activePlan } = await sb.from('plans').select('*').eq('owner_id', currentUser).eq('status', 'active').gte('expires_at', new Date().toISOString()).order('created_at', { ascending: false }).limit(1);
          if (!activePlan || !activePlan.length) {
            btn.disabled = false; btn.textContent = 'Submit';
            showConfirmDialog('❌ No active plan. Please purchase a plan first.');
            return;
          }
        }
        if (approvalRequired) status = 'pending';
        if (endpoint === 'services' && data.category_id) {
          const { data: cat } = await sb.from('service_categories').select('is_free_forever').eq('id', data.category_id).single();
          if (cat && cat.is_free_forever) status = 'active';
        }
        if (endpoint === 'services' && mazdoorApproval && status === 'active') {
          status = 'pending';
        }
      }
      data.status = status;
    }
    if (editId) {
      delete data.owner_id; delete data.lat; delete data.lng;
      await sb.from(table).update(data).eq('id', parseInt(editId));
      delete form.dataset.editId; delete form.dataset.editType;
    } else {
      const { data: result, error } = await sb.from(table).insert(data).select().single();
      if (error) throw error;
      insertResult = result;
    }
    const pInput = form.querySelector('.photo-input');
    const hasPhotos = pInput && pInput.files.length;
    const photoFiles = hasPhotos ? Array.from(pInput.files) : [];
    form.reset();
    form.querySelector('[type="submit"]').textContent = 'Submit';
    document.querySelectorAll('.f-owner').forEach(el => { if (currentUser) el.value = currentUser; });
    document.querySelectorAll('.f-lat').forEach(el => el.value = userLocation ? userLocation.lat : '');
    document.querySelectorAll('.f-lng').forEach(el => el.value = userLocation ? userLocation.lng : '');
    let msg = editId ? '✅ Updated!' : '✅ Created!';
    if (photoFiles.length) {
      const listingId = editId ? parseInt(editId) : (insertResult ? insertResult.id : null);
      if (listingId) {
        const listingType = TYPE_MAP[endpoint] || endpoint;
        let uploaded = 0;
        for (const file of photoFiles) {
          const fname = listingType + '/' + listingId + '/' + Date.now() + '-' + file.name;
          const { error: uerr } = await sb.storage.from('photos').upload(fname, file);
          if (!uerr) {
            const { data: { publicUrl } } = sb.storage.from('photos').getPublicUrl(fname);
            await sb.from('listing_photos').insert({ listing_type: listingType, listing_id: listingId, url: publicUrl });
            uploaded++;
          }
        }
        msg += '<br>📸 ' + uploaded + ' photo' + (uploaded > 1 ? 's' : '') + ' uploaded';
      }
    }
    if (!editId) msg += '<br>Status: ' + status;
    showConfirmDialog(msg, () => showView('home'));
    btn.disabled = false; btn.textContent = 'Submit';
    return;
  } catch (e) {
    btn.disabled = false; btn.textContent = 'Submit';
    showConfirmDialog('❌ ' + e.message);
    return;
  }
}

// ── Detail Modal ──
async function showDetail(type, id) {
  const table = type === 'product-shops' ? 'product_shops' : type === 'used-saman' ? 'used_saman' : type;
  try {
    const { data: item, error } = await sb.from(table).select('*').eq('id', id).single();
    if (error || !item) throw error || new Error('Not found');
    const modal = $('modal'), body = $('modal-body');
    let html = '<h3>' + (item.title || item.provider_name || item.shop_name || 'Listing') + '</h3>';
    const fields = {
      'Type': item.type || item.property_type || item.listing_type || item.condition,
      'Price': item.price ? 'Rs. ' + Number(item.price).toLocaleString() : null,
      'Description': item.description, 'Experience': item.experience_years ? item.experience_years + ' years' : null,
      'Availability': item.availability ? '<span class="badge ' + item.availability + '">' + item.availability + '</span>' : null,
      'Busy Until': item.busy_until, 'Size': item.size_sqft ? item.size_sqft + ' sqft' : null,
      'Marla': item.size_marla ? item.size_marla + ' marla' : null, 'Bedrooms': item.bedrooms, 'Bathrooms': item.bathrooms,
      'Floor': item.floor_number !== undefined ? (item.floor_number === 0 ? 'Ground' : item.floor_number) + (item.total_floors ? '/' + item.total_floors : '') : item.floor,
      'Furnished': item.furnished, 'Parking': item.parking ? 'Yes' : null, 'Corner': (item.corner_shop || item.corner) ? 'Yes' : null,
      'Opening': item.opening_time, 'Closing': item.closing_time,
      'Weekly Off': item.weekly_off_day ? item.weekly_off_day.replace(/_1st$/, ' (1st Half Off)').replace(/_2nd$/, ' (2nd Half Off)') : null,
      'Half Timing': item.half_open ? item.half_open + ' - ' + item.half_close : null,
      'Location': (item.area || '') + ', ' + (item.city || ''),
      'Condition': item.condition ? item.condition.replace(/_/g, ' ') : null,
      'Views': item.views_count, 'Status': item.status !== 'active' ? '<span style="color:#c5221f">' + item.status + '</span>' : null,
    };
    try {
      const { data: photos } = await sb.from('listing_photos').select('*').eq('listing_type', TYPE_MAP[type] || type).eq('listing_id', id).order('order_num');
      pvPhotos = photos || [];
      if (photos && photos.length) {
        html += '<div class="photo-strip">';
        photos.forEach((p, i) => { html += '<img src="' + p.url + '" class="modal-photo" onclick="event.stopPropagation();openPhotoViewer(' + i + ')">'; });
        html += '</div>';
      }
    } catch (e) {}
    for (const [k, v] of Object.entries(fields)) { if (v !== null && v !== undefined && v !== '') html += '<div class="detail-row"><span class="label">' + k + '</span><span class="value">' + v + '</span></div>'; }
    html += '<div class="contact-card" style="display:flex;gap:8px;margin-top:14px">';
    if (item.lat && item.lng) html += '<a href="https://www.google.com/maps/dir/?api=1&destination=' + item.lat + ',' + item.lng + '" target="_blank" class="contact-btn"><span class="ci">🗺</span><span class="ct">Direction</span></a>';
    if (item.whatsapp) {
      const wa = item.whatsapp.replace(/[^0-9]/g, '').replace(/^0+/, ''); const waFull = wa.startsWith('92') ? wa : '92' + wa;
      html += '<a href="https://wa.me/' + waFull + '" target="_blank" class="contact-btn" onclick="logContact(\'' + type + '\',' + id + ',\'whatsapp\')"><span class="ci">💬</span><span class="ct">WhatsApp</span></a>';
    }
    if (item.mobile) html += '<a href="tel:' + item.mobile + '" class="contact-btn" onclick="logContact(\'' + type + '\',' + id + ',\'call\')"><span class="ci">📞</span><span class="ct">Call</span></a>';
    html += '</div>';
    html += '<div id="more-section"><div class="more-toggle" onclick="this.nextElementSibling.style.display=this.nextElementSibling.style.display===\'block\'?\'none\':\'block\'">▼ More</div><div id="more-actions" style="display:none">';
    if (currentUser && item.owner_id === currentUser) {
      if (type === 'services') html += '<button class="btn btn-sm ' + (item.availability === 'available' ? 'btn-warning' : 'btn-success') + '" onclick="toggleAvail(' + id + ',\'' + item.availability + '\')">' + (item.availability === 'available' ? 'Mark Busy' : 'Mark Available') + '</button> ';
      html += '<button class="btn btn-sm btn-primary" onclick="editListing(\'' + type + '\',' + id + ')">✏️ Edit</button> ';
    } else {
      html += '<button class="btn btn-sm" onclick="reportListing(\'' + type + '\',' + id + ')">🚩 Report</button>';
    }
    html += '</div></div>';
    if (type === 'product-shops') {
      try {
        const { data: prods } = await sb.from('products').select('*').eq('shop_id', id).order('name');
        html += '<div class="section-title">Products</div>';
        (prods || []).forEach(p => {
          html += '<div class="detail-row" style="justify-content:space-between"><span class="value">' + p.name + ' ' + (p.in_stock ? '✅' : '❌') + '</span>';
          if (currentUser && item.owner_id === currentUser) html += '<span style="display:flex;gap:4px"><button class="btn btn-xs" onclick="event.stopPropagation();toggleStock(' + id + ',' + p.id + ',' + (p.in_stock ? 1 : 0) + ')">📦</button><button class="btn btn-xs btn-danger" onclick="event.stopPropagation();deleteProduct(' + id + ',' + p.id + ')">🗑</button></span>';
          html += '</div>';
        });
        if (currentUser && item.owner_id === currentUser) html += '<div style="display:flex;gap:6px;margin-top:8px"><input type="text" id="new-prod-name" placeholder="Product name" style="flex:1;padding:6px;border:1px solid #ddd;border-radius:6px;font-size:.85rem"><button class="btn btn-sm btn-primary" onclick="addProduct(' + id + ')">+ Add</button></div>';
      } catch (e) {}
    }
    body.innerHTML = html;
    modal.classList.add('open');
    logContact(type, id, 'view');
  } catch (e) { alert('Error: ' + e.message); }
}

async function logContact(type, id, action) {
  try { await sb.from('contact_logs').insert({ listing_type: TYPE_MAP[type] || type, listing_id: id, action_type: action }); } catch (e) {}
}

async function editListing(type, id) {
  closeModal();
  const table = type === 'product-shops' ? 'product_shops' : type === 'used-saman' ? 'used_saman' : type;
  const { data: item } = await sb.from(table).select('*').eq('id', id).single();
  if (!item) return;
  const viewMap = { services: 'add-service', shops: 'add-shop', properties: 'add-property', 'product-shops': 'add-product-shop', 'used-saman': 'add-used-saman' };
  showView(viewMap[type]);
  const form = document.querySelector('#view-' + viewMap[type] + ' form');
  if (!form) return;
  form.dataset.editId = id;
  form.dataset.editType = type;
  form.querySelector('[type="submit"]').textContent = 'Update';
  form.querySelectorAll('[name]').forEach(el => { const val = item[el.name]; if (val !== undefined && val !== null) el.value = val; });
  const availEl = form.querySelector('[name=availability]');
  if (availEl) { const busyUntil = document.getElementById('as-busy-until'); if (busyUntil) busyUntil.style.display = availEl.value === 'busy' ? 'block' : 'none'; }
  ['opening', 'closing'].forEach(prefix => {
    const timeVal = item[prefix + '_time'];
    if (timeVal) {
      const [h, m] = timeVal.split(':'); const hh = parseInt(h);
      const hourEl = form.querySelector('[name=' + prefix + '_hour]'), minEl = form.querySelector('[name=' + prefix + '_min]'), ampmEl = form.querySelector('[name=' + prefix + '_ampm]');
      if (hourEl) hourEl.value = String(hh > 12 ? hh - 12 : (hh === 0 ? 12 : hh)).padStart(2, '0');
      if (minEl) minEl.value = m; if (ampmEl) ampmEl.value = hh >= 12 ? 'PM' : 'AM';
    }
  });
  const woDay = document.getElementById('wo-day'), woType = document.getElementById('wo-type');
  if (woDay && item.weekly_off_day) {
    const parts = item.weekly_off_day.split('_'); woDay.value = parts[0]; woDay.dispatchEvent(new Event('change'));
    if (parts[1]) { woType.value = parts[1]; woType.dispatchEvent(new Event('change')); }
    if (item.half_open) {
      const visible = document.querySelector('#half-timing .timing-row[style*="block"]');
      if (visible) {
        ['h2o','h2c','h1o','h1c'].forEach(prefix => {
          const hourEl = visible.querySelector('[name=' + prefix + '_hour]'), minEl = visible.querySelector('[name=' + prefix + '_min]'), ampmEl = visible.querySelector('[name=' + prefix + '_ampm]');
          const timeVal = item[prefix.charAt(2) === 'o' ? 'half_open' : 'half_close'];
          if (timeVal && hourEl) { const [h, m] = timeVal.split(':'); const hh = parseInt(h); hourEl.value = String(hh > 12 ? hh - 12 : (hh === 0 ? 12 : hh)).padStart(2, '0'); if (minEl) minEl.value = m; if (ampmEl) ampmEl.value = hh >= 12 ? 'PM' : 'AM'; }
        });
      }
    }
  }
  const photoInput = form.querySelector('.photo-input');
  const previews = form.querySelector('.photo-previews');
  if (previews) previews.innerHTML = '';
  try {
    const { data: photos } = await sb.from('listing_photos').select('*').eq('listing_type', TYPE_MAP[type] || type).eq('listing_id', id);
    if (photos && photos.length && previews) {
      previews.innerHTML = '<div style="font-size:.8rem;color:#666;margin-bottom:4px">Existing photos:</div>';
      photos.forEach(p => {
        const wrap = document.createElement('div'); wrap.style.position = 'relative'; wrap.style.display = 'inline-block';
        const img = document.createElement('img'); img.src = p.url; img.style.width = '70px'; img.style.height = '70px'; img.style.objectFit = 'cover'; img.style.borderRadius = '8px';
        const del = document.createElement('button'); del.textContent = '✕';
        del.style.cssText = 'position:absolute;top:-4px;right:-4px;background:#ea4335;color:#fff;border:none;border-radius:50%;width:20px;height:20px;font-size:.7rem;cursor:pointer;display:flex;align-items:center;justify-content:center';
        del.onclick = async (e) => { e.preventDefault(); if (!confirm('Remove this photo?')) return; try { await sb.from('listing_photos').delete().eq('id', p.id); wrap.remove(); } catch (e) { alert('Error: ' + e.message); } };
        wrap.appendChild(img); wrap.appendChild(del); previews.appendChild(wrap);
      });
    }
  } catch (e) {}
}

async function deleteListing(type, id) {
  if (!confirm('Delete this listing?')) return;
  const table = type === 'product-shops' ? 'product_shops' : type === 'used-saman' ? 'used_saman' : type;
  try {
    await sb.from(table).delete().eq('id', id).eq('owner_id', currentUser);
    try { closeModal(); } catch (e) {}
    showToast('🗑 Deleted');
    loadMy(type.replace(/-/g, '_'));
  } catch (e) { alert('Error: ' + e.message); }
}

function closeModal(e) { if (e && e.target !== $('modal')) return; $('modal').classList.remove('open'); }

function showConfirmDialog(msg, cb) {
  $('confirm-msg').innerHTML = msg; $('confirm-overlay').classList.add('open');
  $('confirm-ok').onclick = () => { closeConfirm(); if (cb) cb(); };
}
function closeConfirm(e) { if (e && e.target !== $('confirm-overlay')) return; $('confirm-overlay').classList.remove('open'); }

function openPhotoViewer(index) {
  if (!pvPhotos.length) return;
  pvIndex = index; const viewer = $('photo-viewer'), img = $('pv-img'), counter = $('pv-counter');
  img.src = pvPhotos[pvIndex].url; counter.textContent = (pvIndex + 1) + ' / ' + pvPhotos.length; viewer.classList.add('open');
}
function closePhotoViewer() { $('photo-viewer').classList.remove('open'); }
function pvChange(dir) { pvIndex += dir; if (pvIndex < 0) pvIndex = pvPhotos.length - 1; if (pvIndex >= pvPhotos.length) pvIndex = 0; $('pv-img').src = pvPhotos[pvIndex].url; $('pv-counter').textContent = (pvIndex + 1) + ' / ' + pvPhotos.length; }
document.addEventListener('keydown', e => { if (!$('photo-viewer').classList.contains('open')) return; if (e.key === 'ArrowLeft') pvChange(-1); else if (e.key === 'ArrowRight') pvChange(1); else if (e.key === 'Escape') closePhotoViewer(); });

async function addProduct(shopId) {
  const name = $('new-prod-name').value.trim();
  if (!name) return alert('Product name required');
  try {
    await sb.from('products').insert({ shop_id: shopId, name, owner_id: currentUser });
    $('new-prod-name').value = ''; showDetail('product-shops', shopId);
  } catch (e) { alert('Error: ' + e.message); }
}
async function toggleStock(shopId, prodId, current) {
  try { await sb.from('products').update({ in_stock: !current }).eq('id', prodId); showDetail('product-shops', shopId); } catch (e) { alert('Error: ' + e.message); }
}
async function deleteProduct(shopId, prodId) {
  if (!confirm('Delete this product?')) return;
  try { await sb.from('products').delete().eq('id', prodId); showDetail('product-shops', shopId); } catch (e) { alert('Error: ' + e.message); }
}
async function toggleAvail(id, current) {
  const na = current === 'available' ? 'busy' : 'available';
  try {
    await sb.from('services').update({ availability: na, busy_until: na === 'busy' ? new Date(Date.now() + 30 * 86400000).toISOString().split('T')[0] : null }).eq('id', id).eq('owner_id', currentUser);
    showToast(na === 'available' ? '✅ Marked Available' : '🟡 Marked Busy');
    loadMy('services');
  } catch (e) { alert('Error: ' + e.message); }
}

async function reportListing(type, id) {
  const reason = prompt('Reason for reporting this listing:');
  if (!reason) return;
  try {
    await sb.from('reports').insert({ listing_type: type, listing_id: id, reporter_id: currentUser, reason });
    showToast('🚩 Reported! Thank you.');
  } catch (e) { alert('Error: ' + e.message); }
}

// ── My Listings ──
async function loadMy(type) {
  if (!currentUser) { $('my-list').innerHTML = '<p class="hint">Login first</p>'; return; }
  $('my-tabs').querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.type === type));
  const table = type; // data-type values match table names: services, shops, properties, product_shops, used_saman
  try {
    const { data: items } = await sb.from(table).select('*').eq('owner_id', currentUser).order('created_at', { ascending: false });
    const el = $('my-list');
    if (!items || !items.length) { el.innerHTML = '<p class="hint">No ads yet</p>'; return; }
    el.innerHTML = '';
    for (const item of items) {
      try {
        const t = type.replace('_', '-');
        await renderCard(el, t, item, { showFav: false });
        const card = el.lastElementChild;
        const info = card.querySelector('.card-info');
        const actions = document.createElement('div');
        actions.style.cssText = 'display:flex;gap:6px;margin-top:8px;flex-wrap:wrap';
        let extraBtns = '';
        if (t === 'services') {
          const aLbl = item.availability === 'available' ? 'Mark Busy' : 'Mark Available';
          const aCls = item.availability === 'available' ? 'btn-warning' : 'btn-success';
          extraBtns = '<button class="btn btn-sm ' + aCls + '" onclick="event.stopPropagation();toggleAvail(' + item.id + ',\'' + item.availability + '\')">' + aLbl + '</button>';
        }
        actions.innerHTML = extraBtns + '<button class="btn btn-sm btn-primary" onclick="event.stopPropagation();editListing(\'' + t + '\',' + item.id + ')">✏️ Edit</button><button class="btn btn-sm btn-danger" onclick="event.stopPropagation();deleteListing(\'' + t + '\',' + item.id + ')">🗑 Delete</button>';
        info.appendChild(actions);
      } catch (e) { console.error(e); }
    }
  } catch (e) { $('my-list').innerHTML = '<p class="hint">Error: ' + e.message + '</p>'; }
}
document.addEventListener('click', e => { const tab = e.target.closest('#my-tabs .tab-btn'); if (tab) loadMy(tab.dataset.type); });

// ── Admin ──
function showAdminSection(section) {
  ['admin-dashboard','admin-listing','admin-users','admin-settings','admin-payment'].forEach(id => $(id).style.display = 'none');
  $('admin-main-tabs').querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.section === section));
  $('admin-' + section).style.display = 'block';
}

async function loadAdminListing() {
  const el = $('admin-list-types'); el.style.display = 'flex';
  $('pending-list').innerHTML = '';
  const listEl = $('pending-list'); listEl.innerHTML = '';
  el.innerHTML = '<p class="hint">Loading...</p>';
  try {
    const tables = ['services','shops','properties','product_shops','used_saman'];
    const counts = {};
    for (const t of tables) {
      const { count: total } = await sb.from(t).select('*', { count: 'exact', head: true });
      const { count: pending } = await sb.from(t).select('*', { count: 'exact', head: true }).eq('status', 'pending');
      counts[t] = total || 0; counts[t + '_pending'] = pending || 0;
    }
    const types = [
      { id: 'services', icon: '👷', label: 'Services' },
      { id: 'shops', icon: '🏢', label: 'Commercial (Shops)' },
      { id: 'properties', icon: '🏠', label: 'Properties' },
      { id: 'product_shops', icon: '🏪', label: 'Shops & Utilities' },
      { id: 'used_saman', icon: '📦', label: 'Used Saman' },
    ];
    el.innerHTML = '';
    types.forEach(t => {
      const total = counts[t.id] || 0;
      const pending = counts[t.id + '_pending'] || 0;
      const card = document.createElement('div'); card.className = 'pending-card'; card.style.cursor = 'pointer';
      card.onclick = () => loadPending(t.id);
      card.innerHTML = '<div style="display:flex;align-items:center;justify-content:space-between"><div style="display:flex;align-items:center;gap:10px"><span style="font-size:1.4rem">' + t.icon + '</span><strong style="font-size:1rem">' + t.label + '</strong></div><div style="display:flex;align-items:center;gap:8px"><span style="font-weight:700;font-size:1.05rem;color:#1a73e8">' + total + '</span>' + (pending > 0 ? '<span style="background:#ea4335;color:#fff;border-radius:20px;padding:3px 10px;font-size:.82rem;font-weight:700">' + pending + '</span>' : '') + '</div></div>';
      el.appendChild(card);
    });
  } catch (e) { el.innerHTML = '<p class="hint">Error: ' + e.message + '</p>'; }
}

async function loadPending(type) {
  $('admin-list-types').style.display = 'none';
  const el = $('pending-list'); el.style.display = '';
  const labels = { services:'Services', shops:'Commercial (Shops)', properties:'Properties', product_shops:'Shops & Utilities', used_saman:'Used Saman' };
  const icons = { services:'👷', shops:'🏢', properties:'🏠', product_shops:'🏪', used_saman:'📦' };
  el.innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><button class="btn btn-sm" onclick="showAdminSection(\'listing\');loadAdminListing()" style="font-size:.85rem">← Back</button><strong style="font-size:1rem">' + (icons[type] || '') + ' ' + (labels[type] || type) + '</strong></div>';
  const table = type === 'product_shops' ? 'product_shops' : type === 'used_saman' ? 'used_saman' : type;
  try {
    const { data: items } = await sb.from(table).select('*').order('created_at', { ascending: false });
    const container = document.createElement('div'); container.id = 'pending-items';
    if (!items || !items.length) { container.innerHTML = '<p class="hint">No listings</p>'; } else {
      items.forEach(item => {
        const title = item.provider_name || item.title || item.shop_name || '#' + item.id;
        const card = document.createElement('div'); card.className = 'pending-card';
        card.innerHTML = '<div style="display:flex;justify-content:space-between"><strong>' + title + '</strong><span class="badge ' + item.status + '">' + item.status + '</span></div><div class="meta"><span>📍 ' + (item.area || '') + ', ' + (item.city || '') + '</span>' + (item.price ? '<span>💰 Rs. ' + Number(item.price).toLocaleString() + '</span>' : '') + (item.mobile ? '<span>📞 ' + item.mobile + '</span>' : '') + '</div>' + (item.description ? '<div style="font-size:.82rem;color:#555;margin:6px 0">' + item.description + '</div>' : '') + '<div style="font-size:.72rem;color:#999;margin-bottom:6px">ID: ' + item.id + ' | ' + (item.created_at || '') + '</div><div class="p-actions">' + (item.status === 'pending' ? '<button class="btn btn-sm btn-success" onclick="reviewItem(\'' + type + '\',' + item.id + ',\'active\')">✅ Approve</button><button class="btn btn-sm btn-danger" onclick="reviewItem(\'' + type + '\',' + item.id + ',\'rejected\')">❌ Reject</button>' : '') + '<button class="btn btn-sm" onclick="showDetail(\'' + type.replace(/_/g, '-') + '\',' + item.id + ')">👁 View</button><button class="btn btn-sm btn-danger" onclick="deleteItem(\'' + type + '\',' + item.id + ')">🗑 Delete</button></div>';
        container.appendChild(card);
      });
    }
    el.appendChild(container);
  } catch (e) { $('pending-list').innerHTML = '<p class="hint">Error: ' + e.message + '</p>'; }
}
document.addEventListener('click', e => {
  const tab = e.target.closest('#admin-main-tabs .tab-btn');
  if (tab) {
    const section = tab.dataset.section; showAdminSection(section);
    if (section === 'listing') loadAdminListing();
    else if (section === 'settings') loadSettings();
    else if (section === 'payment') loadPaymentSection();
    else if (section === 'dashboard') loadDashboard();
    else if (section === 'users') loadUsers();
  }
});

async function reviewItem(type, id, status) {
  const table = type === 'product_shops' ? 'product_shops' : type === 'used_saman' ? 'used_saman' : type;
  try {
    await sb.from(table).update({ status }).eq('id', id);
    showToast(status === 'active' ? '✅ Approved' : '❌ Rejected');
    loadPending(type);
  } catch (e) { alert('Error: ' + e.message); }
}
async function deleteItem(type, id) {
  if (!confirm('Delete this listing permanently?')) return;
  const table = type === 'product_shops' ? 'product_shops' : type === 'used_saman' ? 'used_saman' : type;
  try {
    await sb.from(table).delete().eq('id', id);
    await sb.from('listing_photos').delete().eq('listing_type', TYPE_MAP[type.replace(/_/g, '-')] || type).eq('listing_id', id);
    showToast('🗑 Deleted'); loadPending(type);
  } catch (e) { alert('Error: ' + e.message); }
}

async function expireAll() {
  if (!confirm('Expire all old listings?')) return;
  try {
    const tables = ['services','shops','properties','product_shops','used_saman'];
    for (const t of tables) await sb.from(t).update({ status: 'expired' }).lt('expires_at', new Date().toISOString()).eq('status', 'active');
    showToast('🗑 Old listings expired'); loadAdminListing();
  } catch (e) { alert('Error: ' + e.message); }
}

async function loadReports() {
  const el = $('pending-list'); el.innerHTML = '<p class="hint">Loading...</p>'; $('admin-list-types').style.display = 'none';
  try {
    const { data: reports } = await sb.from('reports').select('*').order('created_at', { ascending: false });
    if (!reports || !reports.length) { el.innerHTML = '<p class="hint">No reports</p>'; return; }
    el.innerHTML = '<div style="display:flex;align-items:center;gap:8px;margin-bottom:12px"><button class="btn btn-sm" onclick="showAdminSection(\'listing\');loadAdminListing()" style="font-size:.85rem">← Back</button><strong style="font-size:1rem">🚩 Reports (' + reports.length + ')</strong></div>';
    reports.forEach(r => {
      const card = document.createElement('div'); card.className = 'pending-card';
      card.innerHTML = '<div style="display:flex;justify-content:space-between"><strong>🚩 ' + (r.listing_type || '') + ' #' + r.listing_id + '</strong><span style="font-size:.72rem;color:#999">' + (r.created_at || '') + '</span></div><div style="margin:6px 0">' + (r.reason || 'No reason') + '</div><div style="font-size:.82rem;color:#666">Reporter: ' + (r.reporter_id || 'Anonymous') + '</div><div class="p-actions"><button class="btn btn-sm btn-success" onclick="dismissReport(' + r.id + ')">✅ Dismiss</button><button class="btn btn-sm" onclick="showDetail(\'' + (r.listing_type || '').replace(/_/g, '-') + '\',' + r.listing_id + ')">👁 View</button></div>';
      el.appendChild(card);
    });
  } catch (e) { el.innerHTML = '<p class="hint">Error: ' + e.message + '</p>'; }
}
async function dismissReport(id) {
  try { await sb.from('reports').delete().eq('id', id); showToast('✅ Dismissed'); loadReports(); } catch (e) { alert('Error: ' + e.message); }
}

async function loadDashboard() {
  const el = $('dashboard-stats'); el.innerHTML = '<p class="hint">Loading...</p>';
  try {
    const { count: users } = await sb.from('profiles').select('*', { count: 'exact', head: true });
    const tables = ['services','shops','properties','product_shops','used_saman'];
    let total = 0, pending = 0;
    let html = '<div style="display:grid;grid-template-columns:repeat(2,1fr);gap:10px"><div class="pending-card" style="text-align:center;padding:20px"><strong style="font-size:1.8rem;color:#1a73e8">' + (users||0) + '</strong><br><span style="font-size:.85rem;color:#666">Users</span></div>';
    for (const t of tables) {
      const { count: tc } = await sb.from(t).select('*', { count: 'exact', head: true });
      const { count: pc } = await sb.from(t).select('*', { count: 'exact', head: true }).eq('status', 'pending');
      total += tc || 0; pending += pc || 0;
    }
    html += '<div class="pending-card" style="text-align:center;padding:20px"><strong style="font-size:1.8rem;color:#137333">' + total + '</strong><br><span style="font-size:.85rem;color:#666">Total Listings</span></div>';
    if (pending > 0) html += '<div class="pending-card" style="text-align:center;padding:20px;grid-column:1/-1"><strong style="font-size:1.8rem;color:#ea4335">' + pending + '</strong><br><span style="font-size:.85rem;color:#666">Pending Approval</span></div>';
    html += '</div>';
    el.innerHTML = html;
  } catch (e) { el.innerHTML = '<p class="hint">Error: ' + e.message + '</p>'; }
}

async function loadUsers() {
  const el = $('users-list'); el.innerHTML = '<p class="hint">Loading...</p>';
  try {
    const { data: users } = await sb.from('profiles').select('*').order('created_at', { ascending: false });
    if (!users || !users.length) { el.innerHTML = '<p class="hint">No users</p>'; return; }
    el.innerHTML = '';
    for (const u of users) {
      let total = 0;
      for (const t of ['services','shops','properties','product_shops','used_saman']) {
        const { count } = await sb.from(t).select('*', { count: 'exact', head: true }).eq('owner_id', u.id);
        total += count || 0;
      }
      const card = document.createElement('div'); card.className = 'pending-card';
      card.innerHTML = '<div style="display:flex;justify-content:space-between"><strong>' + (u.name || 'Unknown') + '</strong><span class="badge ' + (u.role||'customer') + '">' + (u.role||'customer') + '</span></div><div style="font-size:.82rem;color:#666;margin-top:4px">' + (u.email || '') + ' | 📋 ' + total + ' listings</div>';
      el.appendChild(card);
    }
  } catch (e) { el.innerHTML = '<p class="hint">Error: ' + e.message + '</p>'; }
}

async function loadSettings() {
  const fieldsEl = $('settings-fields'); fieldsEl.innerHTML = '<p class="hint">Loading...</p>';
  try {
    const { data: settings } = await sb.from('app_settings').select('*');
    if (!settings) { fieldsEl.innerHTML = '<p class="hint">No settings</p>'; return; }
    const s = {}; settings.forEach(r => s[r.key] = r);
    let html = '';
    
    // 1. App Operation Mode (at the very top)
    html += '<h4 style="margin:14px 0 8px;font-size:.95rem;color:#555">⚙️ App Mode</h4>';
    const appModeEntry = s['app_mode'] || { value: 'free', description: 'App Operation Mode' };
    html += '<div class="pending-card" style="margin-bottom:8px;padding:12px">';
    html += '<label style="font-size:.82rem;font-weight:600;color:#555;display:block;margin-bottom:4px">App Operation Mode</label>';
    html += '<small style="color:#666;font-size:.75rem;display:block;margin-bottom:8px;line-height:1.3">Controls if the portal is completely free or restricts ad posting to active package limits.</small>';
    html += '<select data-key="app_mode" style="display:block;width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:.88rem;background:#fff"><option value="free" ' + (appModeEntry.value === 'free' ? 'selected' : '') + '>🆓 Free Mode (No packages, posting is 100% free)</option><option value="billing" ' + (appModeEntry.value === 'billing' ? 'selected' : '') + '>💳 Paid Package Mode (Requires purchasing a plan to post ads)</option></select>';
    html += '</div>';

    const payEnabled = s['payment_enabled'] || { value: 'false' };
    const payIsOn = payEnabled.value === 'true';
    html += '<div class="pending-card" style="margin-bottom:8px;padding:12px">';
    html += '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:4px">';
    html += '<label style="font-size:.82rem;font-weight:600;color:#555">Require Payments</label>';
    html += '<label class="toggle"><input type="checkbox" data-key="payment_enabled" data-val="' + (payIsOn ? 'true' : 'false') + '" ' + (payIsOn ? 'checked' : '') + ' onchange="this.dataset.val=this.checked?\'true\':\'false\'"><span class="toggle-slider"></span></label>';
    html += '</div>';
    html += '<small style="color:#666;font-size:.75rem;display:block;line-height:1.3">When active, users must submit JazzCash transaction details to activate plans. Disable it for a free trial/beta launch.</small>';
    html += '</div>';

    // 2. Per Listing Plans
    html += '<h4 style="margin:14px 0 8px;font-size:.95rem;color:#555">📋 Per Listing Plans</h4>';
    ['per_listing_10d','per_listing_20d','per_listing_30d'].forEach(p => {
      const label = s[p+'_label']?.value || p.replace(/_/g,' ');
      const price = s[p+'_price']?.value || '';
      html += '<div class="pending-card" style="margin-bottom:8px;padding:12px"><label style="font-size:.82rem;font-weight:600;color:#555">' + label + '</label><div style="display:flex;gap:8px;margin-top:4px"><div style="flex:1"><small>Price (Rs.)</small><input type="number" data-key="'+p+'_price" value="'+price+'" style="display:block;width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:.85rem"></div></div></div>';
    });

    // 3. Subscription Plans
    html += '<h4 style="margin:14px 0 8px;font-size:.95rem;color:#555">💎 Subscription Plans</h4>';
    ['plan_1month','plan_3month','plan_6month'].forEach(p => {
      const label = s[p+'_label']?.value || p.replace(/_/g,' ');
      const price = s[p+'_price']?.value || '';
      const limit = s[p+'_limit']?.value || '';
      html += '<div class="pending-card" style="margin-bottom:8px;padding:12px"><label style="font-size:.82rem;font-weight:600;color:#555">' + label + '</label><div style="display:flex;gap:8px;margin-top:4px"><div style="flex:1"><small>Price (Rs.)</small><input type="number" data-key="'+p+'_price" value="'+price+'" style="display:block;width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:.85rem"></div><div style="flex:1"><small>Listing Limit</small><input type="number" data-key="'+p+'_limit" value="'+limit+'" style="display:block;width:100%;padding:8px;border:1px solid #ddd;border-radius:8px;font-size:.85rem"></div></div></div>';
    });
    // Add default listing expiry days inside Subscription Plans section
    const expiryVal = s['default_expiry_days']?.value || '30';
    html += '<div class="pending-card" style="margin-bottom:8px;padding:12px"><label style="font-size:.82rem;font-weight:600;color:#555">Default Listing Expiry (Days)</label><input type="number" data-key="default_expiry_days" value="' + expiryVal + '" style="display:block;width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:.88rem;margin-top:4px"></div>';

    // 4. General Settings
    html += '<h4 style="margin:14px 0 8px;font-size:.95rem;color:#555">⚙️ General Settings</h4>';
    const boolKeys = ['approval_required','mazdoor_approval_required'];
    boolKeys.forEach(key => {
      const entry = s[key] || { value: 'false', description: '' };
      const isOn = entry.value === 'true';
      const valOn = 'true';
      const valOff = 'false';
      html += '<div class="pending-card" style="margin-bottom:8px;padding:12px;display:flex;justify-content:space-between;align-items:center"><div><label style="font-size:.82rem;font-weight:600;color:#555">' + (entry.description || key.replace(/_/g,' ')) + '</label></div><label class="toggle"><input type="checkbox" data-key="' + key + '" data-val="' + (isOn ? valOn : valOff) + '" ' + (isOn ? 'checked' : '') + ' onchange="this.dataset.val=this.checked?\'' + valOn + '\':\'' + valOff + '\'"><span class="toggle-slider"></span></label></div>';
    });
    const maxPhotoVal = s['max_photos']?.value || '6';
    html += '<div class="pending-card" style="margin-bottom:8px;padding:12px"><label style="font-size:.82rem;font-weight:600;color:#555">Max Photos Per Listing</label><input type="number" data-key="max_photos" value="' + maxPhotoVal + '" style="display:block;width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:.88rem;margin-top:4px"></div>';
    fieldsEl.innerHTML = html;
  } catch (e) { fieldsEl.innerHTML = '<p class="hint">Error: ' + e.message + '</p>'; }
}

async function saveSettings() {
  const inputs = $('settings-fields').querySelectorAll('input[data-key], select[data-key]');
  const data = {};
  inputs.forEach(inp => {
    const key = inp.dataset.key;
    if (inp.type === 'checkbox') data[key] = inp.dataset.val || (inp.checked ? (key === 'app_mode' ? 'billing' : 'true') : (key === 'app_mode' ? 'free' : 'false'));
    else data[key] = inp.value;
  });
  try {
    for (const [k, v] of Object.entries(data)) {
      const { data: existing } = await sb.from('app_settings').select('key').eq('key', k);
      if (existing && existing.length) await sb.from('app_settings').update({ value: String(v) }).eq('key', k);
      else await sb.from('app_settings').insert({ key: k, value: String(v) });
    }
    showToast('✅ Settings saved!');
  } catch (e) { alert('Error: ' + e.message); }
}

async function loadPaymentSection() {
  const paySettings = $('payment-settings-fields');
  const payLog = $('payment-log');
  payLog.innerHTML = '';
  try {
    const { data: settings } = await sb.from('app_settings').select('*');
    if (!settings) return;
    const s = {}; settings.forEach(r => s[r.key] = r);
    let html = '';
    const jcKeys = ['jazzcash_merchant_id','jazzcash_password','jazzcash_integrity_salt','jazzcash_mode'];
    jcKeys.forEach(key => {
      const entry = s[key] || { value: '', description: '' };
      html += '<div class="pending-card" style="margin-bottom:8px;padding:12px"><label style="font-size:.82rem;font-weight:600;color:#555">' + (entry.description || key.replace(/_/g,' ')) + '</label><input type="text" data-key="' + key + '" value="' + (entry.value || '').replace(/"/g,'&quot;') + '" style="display:block;width:100%;padding:10px;border:1px solid #ddd;border-radius:8px;font-size:.88rem;margin-top:4px"></div>';
    });
    paySettings.innerHTML = html;
  } catch (e) { paySettings.innerHTML = '<p class="hint">Error: ' + e.message + '</p>'; }
  // Load payment history
  try {
    const { data: payments } = await sb.from('payment_requests').select('*').order('created_at', { ascending: false }).limit(100);
    if (!payments || !payments.length) { payLog.innerHTML = '<p class="hint">No payment history</p>'; return; }
    let html = '<h4 style="margin:14px 0 8px;font-size:.95rem;color:#555">Payment History</h4>';
    payments.forEach(p => {
      html += '<div class="pending-card" style="padding:12px;font-size:.85rem"><div style="display:flex;justify-content:space-between"><span><strong>' + p.plan_id + '</strong></span><span class="badge ' + p.status + '">' + p.status + '</span></div><div style="color:#666;margin-top:4px">Amount: Rs. ' + (p.amount || 0).toLocaleString() + ' | TXN: ' + (p.transaction_id || '-') + '<br>' + (p.created_at || '') + '</div></div>';
    });
    payLog.innerHTML = html;
  } catch (e) { payLog.innerHTML = '<p class="hint">Error: ' + e.message + '</p>'; }
}

async function savePaymentSettings() {
  const inputs = $('payment-settings-fields').querySelectorAll('input[data-key]');
  const data = {};
  inputs.forEach(inp => {
    const key = inp.dataset.key;
    if (inp.type === 'checkbox') data[key] = inp.dataset.val || (inp.checked ? 'true' : 'false');
    else data[key] = inp.value;
  });
  try {
    for (const [k, v] of Object.entries(data)) {
      const { data: existing } = await sb.from('app_settings').select('key').eq('key', k);
      if (existing && existing.length) await sb.from('app_settings').update({ value: String(v) }).eq('key', k);
      else await sb.from('app_settings').insert({ key: k, value: String(v) });
    }
    showToast('✅ Payment settings saved!');
  } catch (e) { alert('Error: ' + e.message); }
}

// Admin tabs
document.addEventListener('click', e => {
  const tab = e.target.closest('#payment-tabs .tab-btn');
  if (tab) {
    const sub = tab.dataset.sub;
    document.querySelectorAll('#payment-tabs .tab-btn').forEach(b => b.classList.toggle('active', b.dataset.sub === sub));
    $('payment-settings').style.display = sub === 'settings' ? 'block' : 'none';
    $('payment-history').style.display = sub === 'history' ? 'block' : 'none';
  }
});

// ── Plans ──
async function loadPlans() {
  const el = $('plans-list'); const activeEl = $('active-plan-info');
  el.innerHTML = '<p class="hint">Loading...</p>';
  if (currentUser) {
    try {
      const { data: active } = await sb.from('plans').select('*').eq('owner_id', currentUser).eq('status', 'active').order('created_at', { ascending: false }).limit(1);
      if (active && active.length) {
        const p = active[0]; const left = p.listings_limit !== null ? p.listings_limit - (p.listings_used||0) : '∞';
        activeEl.innerHTML = '<div class="account-card" style="padding:14px;margin-bottom:14px"><strong>Active Plan:</strong> ' + p.plan_type.replace(/_/g, ' ') + '<br>' + (p.listings_limit === null ? '📋 Unlimited listings' : '📋 ' + left + ' listings left') + (p.expires_at ? '<br>⏳ Expires: ' + p.expires_at : '') + '</div>';
      } else { activeEl.innerHTML = '<p style="color:#888;font-size:.85rem">No active plan. Purchase one below:</p>'; }
    } catch (e) { activeEl.innerHTML = ''; }
  }
  try {
    const { data: settings } = await sb.from('app_settings').select('*');
    const s = {}; if (settings) settings.forEach(r => s[r.key] = r);
    if (s.app_mode?.value === 'free') {
      el.innerHTML = '<div class="account-card" style="text-align:center;padding:20px"><p style="font-size:1.1rem;font-weight:600">🎉 Free Launch Active!</p><p style="color:#666;margin-top:6px">All listings are currently free. No plan needed.</p></div>';
      return;
    }
    const payEnabled = s.payment_enabled?.value !== 'false';
    const btnLabel = payEnabled ? 'Buy' : 'Activate Free';
    
    el.innerHTML = '<h4 style="margin:16px 0 8px;font-size:.95rem;color:#555">📋 Per Listing Plans</h4>';
    const perListing = [
      { id: 'per_listing_10d', label: s.per_listing_10d_label?.value || 'Per Listing — 10 Days', price: parseInt(s.per_listing_10d_price?.value) || 200, duration_days: 10 },
      { id: 'per_listing_20d', label: s.per_listing_20d_label?.value || 'Per Listing — 20 Days', price: parseInt(s.per_listing_20d_price?.value) || 400, duration_days: 20 },
      { id: 'per_listing_30d', label: s.per_listing_30d_label?.value || 'Per Listing — 30 Days', price: parseInt(s.per_listing_30d_price?.value) || 500, duration_days: 30 },
    ];
    perListing.forEach(p => {
      const card = document.createElement('div'); card.className = 'pending-card';
      const priceHtml = payEnabled 
        ? '<div style="font-size:1.3rem;font-weight:800;color:#1a73e8">Rs. ' + p.price.toLocaleString() + '</div>'
        : '<div style="font-size:1.2rem;font-weight:800;color:#16a34a"><span style="text-decoration:line-through;color:#aaa;font-size:0.85rem;margin-right:6px;font-weight:600">Rs. ' + p.price.toLocaleString() + '</span>FREE</div>';
      
      card.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center"><div><strong style="font-size:1rem">' + p.label + '</strong><div style="font-size:.85rem;color:#666;margin-top:4px">📋 1 listing · ⏳ ' + p.duration_days + ' days</div></div><div style="text-align:right">' + priceHtml + '<button class="btn btn-sm btn-primary" style="margin-top:6px" onclick="purchasePlan(\'' + p.id + '\')">' + btnLabel + '</button></div></div>';
      el.appendChild(card);
    });
    
    el.innerHTML += '<h4 style="margin:18px 0 8px;font-size:.95rem;color:#555">💎 Subscription Plans</h4>';
    const subs = [
      { id: 'sub_1month', label: s.plan_1month_label?.value || 'Subscription — 1 Month', price: parseInt(s.plan_1month_price?.value) || 2500, duration_days: 30, limitKey: 'plan_1month_limit' },
      { id: 'sub_3month', label: s.plan_3month_label?.value || 'Subscription — 3 Months', price: parseInt(s.plan_3month_price?.value) || 6000, duration_days: 90, limitKey: 'plan_3month_limit' },
      { id: 'sub_6month', label: s.plan_6month_label?.value || 'Subscription — 6 Months', price: parseInt(s.plan_6month_price?.value) || 9000, duration_days: 180, limitKey: 'plan_6month_limit' },
    ];
    subs.forEach(p => {
      const card = document.createElement('div'); card.className = 'pending-card';
      const limit = s[p.limitKey]?.value || 'unlimited';
      const priceHtml = payEnabled 
        ? '<div style="font-size:1.3rem;font-weight:800;color:#1a73e8">Rs. ' + p.price.toLocaleString() + '</div>'
        : '<div style="font-size:1.2rem;font-weight:800;color:#16a34a"><span style="text-decoration:line-through;color:#aaa;font-size:0.85rem;margin-right:6px;font-weight:600">Rs. ' + p.price.toLocaleString() + '</span>FREE</div>';
      
      card.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center"><div><strong style="font-size:1rem">' + p.label + '</strong><div style="font-size:.85rem;color:#666;margin-top:4px">📋 Up to ' + limit + ' listings · ⏳ ' + p.duration_days + ' days</div></div><div style="text-align:right">' + priceHtml + '<button class="btn btn-sm btn-primary" style="margin-top:6px" onclick="purchasePlan(\'' + p.id + '\')">' + btnLabel + '</button></div></div>';
      el.appendChild(card);
    });
  } catch (e) { el.innerHTML = '<p class="hint">Error: ' + e.message + '</p>'; }
}

async function purchasePlan(planId) {
  if (!currentUser) { showView('account'); showAccountForm('register'); return; }
  window._pendingPlan = planId;
  try {
    const { data: settings } = await sb.from('app_settings').select('*');
    const s = {}; if (settings) settings.forEach(r => s[r.key] = r);
    
    const payEnabled = s.payment_enabled?.value !== 'false';
    if (!payEnabled) {
      // Direct free activation
      const validPlans = {
        per_listing_10d: { type: 'per_listing_10d', days: 10, limit: 1 },
        per_listing_20d: { type: 'per_listing_20d', days: 20, limit: 1 },
        per_listing_30d: { type: 'per_listing_30d', days: 30, limit: 1 },
        sub_1month: { type: 'sub_1month', days: 30, limit: null },
        sub_3month: { type: 'sub_3month', days: 90, limit: null },
        sub_6month: { type: 'sub_6month', days: 180, limit: null },
      };
      const plan = validPlans[planId];
      const expiresAt = new Date(Date.now() + plan.days * 86400000).toISOString();
      await sb.from('plans').insert({ owner_id: currentUser, plan_type: plan.type, status: 'active', listings_limit: plan.limit, listings_used: 0, expires_at: expiresAt });
      showToast('✅ Plan activated successfully for free!');
      loadPlans();
      return;
    }

    const planPrices = {
      per_listing_10d: { label: s.per_listing_10d_label?.value || 'Per Listing — 10 Days', price: parseInt(s.per_listing_10d_price?.value) || 200 },
      per_listing_20d: { label: s.per_listing_20d_label?.value || 'Per Listing — 20 Days', price: parseInt(s.per_listing_20d_price?.value) || 400 },
      per_listing_30d: { label: s.per_listing_30d_label?.value || 'Per Listing — 30 Days', price: parseInt(s.per_listing_30d_price?.value) || 500 },
      sub_1month: { label: s.plan_1month_label?.value || 'Subscription — 1 Month', price: parseInt(s.plan_1month_price?.value) || 2500 },
      sub_3month: { label: s.plan_3month_label?.value || 'Subscription — 3 Months', price: parseInt(s.plan_3month_price?.value) || 6000 },
      sub_6month: { label: s.plan_6month_label?.value || 'Subscription — 6 Months', price: parseInt(s.plan_6month_price?.value) || 9000 },
    };
    const planInfo = planPrices[planId] || { label: planId, price: 0 };

    $('payment-overlay').style.display = 'flex';
    $('pay-msg').style.display = 'none'; $('pay-msg').textContent = '';
    $('pay-txn').value = ''; $('pay-number').value = '';
    $('pay-submit').disabled = false; $('pay-submit').textContent = 'Verify & Activate';
    $('jc-account').textContent = s.jazzcash_merchant_id?.value || '03XX-XXXXXXX';
    $('jc-name').textContent = 'JazzCash Account (Send payment here)';
    $('jc-amount').innerHTML = 'Amount to Send: <strong style="color:#e11d48;font-size:1.1rem">Rs. ' + planInfo.price.toLocaleString() + '</strong><br><span style="font-size:.78rem;color:#777;font-weight:normal">For ' + planInfo.label + '</span>';
  } catch (e) {
    $('payment-overlay').style.display = 'flex';
    $('pay-msg').style.display = 'none'; $('pay-msg').textContent = '';
    $('pay-txn').value = ''; $('pay-number').value = '';
    $('pay-submit').disabled = false; $('pay-submit').textContent = 'Verify & Activate';
    $('jc-account').textContent = '03XX-XXXXXXX';
    $('jc-amount').textContent = '';
  }
}
function closePayment(e) { if (e && e.target !== e.currentTarget) return; $('payment-overlay').style.display = 'none'; window._pendingPlan = null; }
async function submitPayment() {
  const txn = $('pay-txn').value.trim();
  const number = $('pay-number').value.trim();
  const planId = window._pendingPlan;
  if (!txn) { showPayMsg('Please enter a Transaction ID', 'error'); return; }
  if (!number) { showPayMsg('Please enter your JazzCash number', 'error'); return; }
  $('pay-submit').disabled = true; $('pay-submit').textContent = 'Verifying...';
  try {
    await sb.from('payment_requests').insert({ owner_id: currentUser, plan_id: planId, amount: 0, transaction_id: txn, payer_number: number, status: 'verified' });
    // Activate plan
    const validPlans = {
      per_listing_10d: { type: 'per_listing_10d', days: 10, limit: 1 },
      per_listing_20d: { type: 'per_listing_20d', days: 20, limit: 1 },
      per_listing_30d: { type: 'per_listing_30d', days: 30, limit: 1 },
      sub_1month: { type: 'sub_1month', days: 30, limit: null },
      sub_3month: { type: 'sub_3month', days: 90, limit: null },
      sub_6month: { type: 'sub_6month', days: 180, limit: null },
    };
    const plan = validPlans[planId];
    const expiresAt = new Date(Date.now() + plan.days * 86400000).toISOString();
    await sb.from('plans').insert({ owner_id: currentUser, plan_type: plan.type, status: 'active', listings_limit: plan.limit, listings_used: 0, expires_at: expiresAt });
    showPayMsg('✅ Payment verified! Plan activated.', 'success');
    $('pay-submit').textContent = '✅ Activated!';
    setTimeout(() => { closePayment(); loadPlans(); }, 1500);
  } catch (e) { showPayMsg('Error: ' + e.message, 'error'); $('pay-submit').disabled = false; $('pay-submit').textContent = 'Verify & Activate'; }
}
function showPayMsg(msg, type) { const el = $('pay-msg'); el.textContent = msg; el.className = 'form-msg show ' + type; el.style.display = 'block'; }

// ── Notifications ──
async function checkNotifications() {
  if (!currentUser) { $('notif-badge').style.display = 'none'; return; }
  try {
    const { count } = await sb.from('notifications').select('*', { count: 'exact', head: true }).eq('user_id', currentUser).eq('is_read', 0);
    if (count > 0) { $('notif-badge').textContent = count; $('notif-badge').style.display = ''; } else { $('notif-badge').style.display = 'none'; }
  } catch (e) {}
}
async function showNotifications() {
  showView('notifications'); const el = $('notif-list'); el.innerHTML = '<p class="hint">Loading...</p>';
  try {
    const { data: notifs } = await sb.from('notifications').select('*').eq('user_id', currentUser).order('created_at', { ascending: false }).limit(50);
    if (!notifs || !notifs.length) { el.innerHTML = '<p class="hint">No notifications</p>'; return; }
    el.innerHTML = '';
    notifs.forEach(n => {
      const card = document.createElement('div'); card.className = 'pending-card';
      card.innerHTML = '<div style="display:flex;justify-content:space-between"><strong>' + (n.title || '') + '</strong>' + (!n.is_read ? '<span style="background:#1a73e8;color:#fff;border-radius:10px;padding:2px 8px;font-size:.7rem">NEW</span>' : '') + '</div><div style="font-size:.85rem;color:#555;margin-top:4px">' + (n.message || '') + '<br><span style="font-size:.72rem;color:#999">' + (n.created_at || '') + '</span></div>';
      card.onclick = () => { sb.from('notifications').update({ is_read: 1 }).eq('id', n.id); checkNotifications(); };
      el.appendChild(card);
    });
  } catch (e) { el.innerHTML = '<p class="hint">Error: ' + e.message + '</p>'; }
}
async function markAllNotifRead() {
  try { await sb.from('notifications').update({ is_read: 1 }).eq('user_id', currentUser); checkNotifications(); showNotifications(); } catch (e) {}
}

// ── Init ──
async function init() {
  try {
    await ensureSession();
    updateUIForUser();
    await loadCategories();
    sb.auth.onAuthStateChange((event, session) => {
      if (session) {
        currentUser = session.user.id;
        localStorage.setItem('lm_user', session.user.id);
        localStorage.setItem('lm_user_name', session.user.user_metadata?.name || session.user.email?.split('@')[0] || 'User');
      } else {
        currentUser = null;
        localStorage.removeItem('lm_user');
        localStorage.removeItem('lm_user_name');
      }
      updateUIForUser();
    });
    showAllNearby();
    getLocation();
  } catch (e) { showErr('Init error: ' + e.message + ' (see console F12)'); console.error(e); }
}
init();
