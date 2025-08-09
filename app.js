// app.js — Mobile-first PWA UI + CSV reader + badges + open-now + install prompt

let stores = [];

/* ===== 軽量CSVパーサ（ダブルクオート対応） ===== */
function parseCSV(text) {
  const rows = []; let row=[], cell='', q=false;
  for (let i=0;i<text.length;i++){
    const ch=text[i], nx=text[i+1];
    if(q){
      if(ch==='"' && nx === '"'){ cell+='"'; i++; }
      else if(ch === '"'){ q=false; }
      else { cell+=ch; }
    }else{
      if(ch === '"'){ q = true; }
      else if(ch === ','){ row.push(cell.trim()); cell=''; }
      else if(ch === '\n'){ row.push(cell.trim()); rows.push(row); row=[]; cell=''; }
      else if(ch === '\r'){ /* skip */ }
      else { cell+=ch; }
    }
  }
  if(cell.length || row.length){ row.push(cell.trim()); rows.push(row); }
  return rows.filter(r => r.length && r.some(c => c !== ''));
}

/* ===== CSVロード（複数候補＋キャッシュ回避） ===== */
async function loadCSV() {
  const candidates = [
    './stores.csv',
    './data/stores.csv',
    './docs/stores.csv'
  ];
  let lastErr;
  for (const p of candidates) {
    try {
      const res = await fetch(`${p}?ts=${Date.now()}`);
      if(!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const rows = parseCSV(text);
      if(!rows.length) throw new Error('CSV empty');
      const headers = rows[0].map(h => h.trim());
      return rows.slice(1).map(r => {
        const obj={}; headers.forEach((k,i)=> obj[k] = (r[i] ?? '').trim());
        return obj;
      });
    } catch(e){ lastErr = e; console.warn('CSV失敗:', p, e.message); }
  }
  throw lastErr || new Error('CSV all failed');
}

/* ===== 喫煙ラベル（紙OK/分煙/喫煙室） ===== */
function smokingLabel(type){
  switch(type){
    case '全席喫煙可':     return '紙OK';
    case '分煙':           return '分煙';
    case '喫煙ブースあり': return '喫煙室';
    default:               return '-';
  }
}

/* ===== 営業中判定（JST・ざっくり） ===== */
function isOpenNow(openHoursRaw){
  if(!openHoursRaw) return false;
  const now = new Date();
  const jst = new Date(now.toLocaleString('en-US',{timeZone:'Asia/Tokyo'}));
  const day = jst.getDay(); // 0=日 … 6=土
  const hm  = jst.getHours()*60 + jst.getMinutes();
  const blocks = openHoursRaw.split(';').map(s=>s.trim()).filter(Boolean);
  const pick = blocks.filter(b=>{
    if(/平日/.test(b)) return day>=1 && day<=5;
    if(/土日/.test(b)) return day===0 || day===6;
    if(/土/.test(b) && !/土日/.test(b)) return day===6;
    if(/日/.test(b) && !/土日/.test(b)) return day===0;
    return !/[月火水木金土日]/.test(b);
  });
  const target = pick.length? pick : blocks;
  const ranges = target.map(b=>{
    const m=b.match(/(\d{1,2}):?(\d{2})?\s*-\s*(翌)?(\d{1,2}):?(\d{2})?/);
    if(!m) return null;
    const s=parseInt(m[1],10)*60 + parseInt(m[2]||'0',10);
    const e0=parseInt(m[4],10)*60 + parseInt(m[5]||'0',10);
    const crosses=!!m[3] || e0<s;
    return {s,e:e0,crosses};
  }).filter(Boolean);
  return ranges.some(({s,e,crosses}) => crosses ? (hm>=s || hm<=e) : (hm>=s && hm<=e));
}

/* ===== DOM ===== */
const list = document.getElementById('store-list');
const cat  = document.getElementById('category-filter');
const smo  = document.getElementById('smoking-filter');
const kw   = document.getElementById('keyword');
const statusEl = document.getElementById('status');

/* ===== 描画 ===== */
function render(){
  const cv = cat.value, sv = smo.value, q = (kw.value||'').trim();
  const filtered = stores.filter(st=>{
    const c1 = !cv || st.category === cv;
    const c2 = !sv || st.smoking === sv;
    const c3 = !q  || (st.name+st.address).toLowerCase().includes(q.toLowerCase());
    return c1 && c2 && c3;
  });

  list.innerHTML = '';
  statusEl.textContent = `${filtered.length} / ${stores.length} 件表示`;

  if(!filtered.length){
    const p = document.createElement('p');
    p.textContent = '該当するお店が見つかりませんでした。';
    p.style.textAlign='center';
    list.appendChild(p);
    return;
  }

  filtered.forEach((st, i)=>{
    const openNow = isOpenNow(st.openHours);
    const badges = `
      <div class="badges">
        ${st.priceRange ? `<span class="badge">${st.priceRange}</span>`:''}
        ${st.seats ? `<span class="badge">席:${st.seats}</span>`:''}
        ${st.powerOutlets?.toLowerCase()==='yes' ? `<span class="badge">🔌電源</span>`:''}
        ${st.wifi?.toLowerCase()==='yes' ? `<span class="badge">📶Wi‑Fi</span>`:''}
        ${openNow ? `<span class="badge badge-open">● 営業中</span>`:''}
      </div>
    `;
    const card = document.createElement('div');
    card.className = 'store-card fade-in';
    card.style.animationDelay = `${i*40}ms`;
    card.innerHTML = `
      <h3>${st.name||'-'}</h3>
      <span class="smoking-label">${smokingLabel(st.smoking)}</span>
      ${badges}
      <p>カテゴリ：${st.category||'-'}</p>
      <p>喫煙形態：${st.smoking||'-'}</p>
      <p>住所：${st.address||'-'}</p>
      <p><a href="${st.mapUrl||'#'}" target="_blank" rel="noopener">Google Mapで見る</a></p>
    `;
    list.appendChild(card);
  });
}

/* ===== 起動 ===== */
async function boot(){
  // SW登録（PWA）
  if('serviceWorker' in navigator){
    try{ await navigator.serviceWorker.register('./sw.js', {scope:'./'}); }
    catch(e){ console.warn('SW register failed', e); }
  }

  // CSV読込
  try{
    stores = await loadCSV();
  }catch(e){
    console.error('CSV読み込み失敗。フォールバック表示:', e);
    stores = [
      { name:"Cafe バンカム", category:"喫茶店", smoking:"全席喫煙可",
        address:"福岡市博多区博多駅中央街2-1",
        mapUrl:"https://www.google.com/maps/search/?api=1&query=福岡市博多区博多駅中央街2-1",
        priceRange:"¥", openHours:"7:00-20:00", seats:"24", powerOutlets:"yes", wifi:"no"
      }
    ];
    statusEl.textContent = '※ オフライン or データ取得失敗のためサンプル表示中';
  }
  render();
}

['change','input'].forEach(ev=>{
  cat.addEventListener('change', render);
  smo.addEventListener('change', render);
  kw.addEventListener('input', render);
});

window.addEventListener('load', boot);

// A2HS（Add to Home Screen）案内（任意）
let deferredPrompt = null;
window.addEventListener('beforeinstallprompt', (e)=>{
  e.preventDefault(); deferredPrompt = e;
  // 必要ならインストール案内UIを出す
});
