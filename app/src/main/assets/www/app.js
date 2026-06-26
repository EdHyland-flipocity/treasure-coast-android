'use strict';

window.onerror = function(msg, src, line) {
  console.error('JS ERROR: ' + msg + ' at line ' + line);
  return true;
};

function q(sql) {
  return new Promise(function(resolve) {
    try {
      var result = AndroidDB.query(sql, '[]');
      if (!result || result === 'undefined' || result === '') { resolve([]); return; }
      resolve(JSON.parse(result));
    } catch(e) {
      console.error('Query error: ' + e.message + ' SQL: ' + sql.substring(0,80));
      resolve([]);
    }
  });
}

var PAGE_LABELS = {
  slreport:    'St. Lucie - Market Report',
  slsales:     'St. Lucie - Sales Registry',
  martinreport:'Martin County - Market Report',
  matchmaker:  'Martin County - Matchmaker',
  radar:       'Martin County - Radar',
  fliptracker: 'Martin County - Flip Tracker',
  indianriver: 'Indian River County',
  entityintel: 'Regional - Entity Intelligence'
};

function openDrawer() {
  document.getElementById('drawer').classList.add('open');
  document.getElementById('drawerOverlay').classList.add('open');
}
function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
  document.getElementById('drawerOverlay').classList.remove('open');
}
function navTo(page) { closeDrawer(); switchPage(page); }

var activePage = 'slreport';
var loaded = {};

function switchPage(page) {
  var cur = document.querySelector('.page.active');
  if (cur) cur.classList.remove('active');
  var next = document.getElementById('page-' + page);
  if (next) next.classList.add('active');
  document.querySelectorAll('.drawer-item').forEach(function(el) {
    el.classList.toggle('active', el.dataset.page === page);
  });
  var ind = document.getElementById('pageIndicator');
  if (ind) ind.textContent = PAGE_LABELS[page] || page;
  activePage = page;
  if (!loaded[page]) {
    loaded[page] = true;
    if (page === 'slreport')     loadSLReport();
    if (page === 'martinreport') loadMartinReport();
    if (page === 'fliptracker')  loadFlipKPIs();
    if (page === 'indianriver')  loadIRReport();
    if (page === 'entityintel')  loadEntityKPIs();
    if (page === 'matchmaker')   loadMatchmakerKPIs();
    if (page === 'radar')        loadRadarKPIs();
  }
}

function fmtK(n) {
  var v = parseFloat(n) || 0;
  if (!v) return '-';
  if (v >= 1e9) return '$' + (v/1e9).toFixed(1) + 'B';
  if (v >= 1e6) return '$' + (v/1e6).toFixed(1) + 'M';
  return '$' + (v/1000).toFixed(0) + 'K';
}
function fmtNum(n) { return Math.round(parseFloat(n)||0).toLocaleString(); }
function esc(s) { return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function scoreClass(s) { return s>=80?'hot':s>=60?'warm':'mod'; }

function renderPagination(elId, total, perPage, current, callbackName) {
  var el = document.getElementById(elId);
  if (!el) return;
  var pages = Math.ceil(total / perPage);
  if (pages <= 1) { el.innerHTML = ''; return; }
  var html = '<div class="page-info">Page ' + current + ' of ' + pages + ' - ' + fmtNum(total) + ' records</div>';
  html += '<div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:center;margin-top:6px">';
  if (current > 1) html += '<button class="page-btn" onclick="' + callbackName + '(' + (current-1) + ')">prev</button>';
  for (var p = Math.max(1, current-2); p <= Math.min(pages, current+2); p++) {
    html += '<button class="page-btn' + (p===current?' active':'') + '" onclick="' + callbackName + '(' + p + ')">' + p + '</button>';
  }
  if (current < pages) html += '<button class="page-btn" onclick="' + callbackName + '(' + (current+1) + ')">next</button>';
  html += '</div>';
  el.innerHTML = html;
}

// SL REPORT
async function loadSLReport() {
  console.log('loadSLReport started');
  try {
    var kpi = await q('SELECT COUNT(*) as total, COUNT(DISTINCT "Parcel ID") as parcels, SUM(CASE WHEN "State" != "FL" AND "State" IS NOT NULL THEN 1 ELSE 0 END) as oos FROM stluciecty_singleFamily');
    var kpi2 = await q('SELECT ROUND(AVG(sp)) as avg_price FROM (SELECT CAST(REPLACE(REPLACE("Sale Price","$",""),",","") AS REAL) as sp FROM stluciecty_singleFamily WHERE CAST(REPLACE(REPLACE("Sale Price","$",""),",","") AS REAL) > 50000)');
    console.log('KPI: ' + JSON.stringify(kpi));
    console.log('KPI2: ' + JSON.stringify(kpi2));
    if (kpi && kpi[0]) {
      document.getElementById('sl-total').textContent   = fmtNum(kpi[0].total);
      document.getElementById('sl-parcels').textContent = fmtNum(kpi[0].parcels);
      document.getElementById('sl-oos').textContent     = fmtNum(kpi[0].oos);
    }
    if (kpi2 && kpi2[0]) {
      document.getElementById('sl-avg').textContent = fmtK(kpi2[0].avg_price);
    }

    var quarterly = await q('SELECT CAST(substr("Sale Date",-4) AS INTEGER) as yr, CAST((CAST(substr("Sale Date",1,2) AS INTEGER)+2)/3 AS INTEGER) as qtr, COUNT(*) as cnt, ROUND(AVG(CAST(REPLACE(REPLACE("Sale Price","$",""),",","") AS REAL))) as avg_p FROM stluciecty_singleFamily WHERE CAST(REPLACE(REPLACE("Sale Price","$",""),",","") AS REAL) > 50000 AND "Sale Date" IS NOT NULL GROUP BY yr, qtr ORDER BY yr, qtr');
    console.log('Quarterly rows: ' + (quarterly ? quarterly.length : 0));
    if (quarterly && quarterly.length) {
      var labels = quarterly.map(function(r) { return r.yr + ' Q' + r.qtr; });
      var prices = quarterly.map(function(r) { return parseFloat(r.avg_p)||0; });
      var vols   = quarterly.map(function(r) { return parseInt(r.cnt)||0; });
      var peakIdx = prices.indexOf(Math.max.apply(null, prices));
      document.getElementById('sl-peak').textContent = labels[peakIdx] || '-';
      var q26 = quarterly.filter(function(r) { return r.yr == 2026; });
      var q25 = quarterly.filter(function(r) { return r.yr == 2025; });
      if (q26.length && q25.length) {
        var avg26 = q26.reduce(function(s,r){return s+parseFloat(r.avg_p||0);},0)/q26.length;
        var avg25 = q25.reduce(function(s,r){return s+parseFloat(r.avg_p||0);},0)/q25.length;
        var trend = ((avg26-avg25)/avg25*100).toFixed(1);
        document.getElementById('sl-trend').textContent = (trend>0?'+':'')+trend+'%';
      }
      renderLineBarChart('chart-sl-price', labels, prices, vols, 'Avg Price', 'Volume');
    }

    var oos = await q('SELECT "State" as st, COUNT(*) as cnt FROM stluciecty_singleFamily WHERE "State" != "FL" AND "State" IS NOT NULL AND "State" != "" AND "State" != "UNITED STATES" AND length("State") = 2 GROUP BY "State" ORDER BY cnt DESC LIMIT 10');
    if (oos && oos.length)
      renderBarChart('chart-oos', oos.map(function(r){return r.st;}), oos.map(function(r){return parseInt(r.cnt);}), 'Buyers', '#8B5CF6');
  } catch(e) { console.error('SL Report error: ' + e.message); }
}

// SL SALES
var slSalesPage = 1;
var slPerPage = 25;

async function loadSLSales(page) {
  page = page || 1;
  slSalesPage = page;
  var name    = document.getElementById('sl-name').value.trim();
  var address = document.getElementById('sl-address').value.trim();
  var where = [];
  if (name)    where.push('(Owner LIKE "%' + name + '%" OR Grantee LIKE "%' + name + '%")');
  if (address) where.push('Situs LIKE "%' + address + '%"');
  var w = where.length ? 'WHERE ' + where.join(' AND ') : '';
  var offset = (page-1)*slPerPage;

  var total = await q('SELECT COUNT(*) as cnt FROM stluciecty_singleFamily ' + w);
  if (total && total[0]) document.getElementById('sl-sales-info').textContent = fmtNum(total[0].cnt) + ' records';

  var rows = await q('SELECT Owner, Situs, "Sale Price" as sp, "Sale Date" as sd, "Finished Area (sq ft)" as sqft FROM stluciecty_singleFamily ' + w + ' ORDER BY "Sale Date" DESC LIMIT ' + slPerPage + ' OFFSET ' + offset);
  if (rows) document.getElementById('sl-sales-body').innerHTML = rows.map(function(r) {
    return '<tr><td>' + esc(r.Owner||'-') + '</td><td>' + esc(r.Situs||'-') + '</td><td style="color:var(--gold)">' + fmtK(String(r.sp||"").replace(/[$,]/g,"")) + '</td><td style="color:var(--text2)">' + String(r.sd||'').substring(0,10) + '</td><td>' + fmtNum(r.sqft) + '</td></tr>';
  }).join('');

  if (total && total[0]) renderPagination('sl-sales-pages', parseInt(total[0].cnt), slPerPage, page, 'loadSLSales');
}

function clearSLSales() {
  document.getElementById('sl-name').value    = '';
  document.getElementById('sl-address').value = '';
  loadSLSales(1);
}

// MARTIN REPORT
async function loadMartinReport() {
  try {
    var kpi = await q('SELECT COUNT(*) as total, COUNT(DISTINCT ParcelID) as parcels FROM martin_transfers WHERE SaleDate IS NOT NULL');
    var kpi2 = await q('SELECT ROUND(AVG(CAST(SalePrice AS REAL))) as avg24 FROM martin_transfers WHERE DeedType="WD" AND CAST(SalePrice AS REAL)>10000 AND strftime("%Y",SaleDate)="2024"');
    var kpi3 = await q('SELECT ROUND(100.0*SUM(CASE WHEN DeedType IN ("QC","CT") THEN 1 ELSE 0 END)/COUNT(*),1) as stress FROM martin_transfers WHERE strftime("%Y",SaleDate)="2025"');
    if (kpi && kpi[0]) {
      document.getElementById('martin-total').textContent   = fmtNum(kpi[0].total);
      document.getElementById('martin-parcels').textContent = fmtNum(kpi[0].parcels);
    }
    if (kpi2 && kpi2[0]) document.getElementById('martin-avg').textContent    = fmtK(kpi2[0].avg24);
    if (kpi3 && kpi3[0]) document.getElementById('martin-stress').textContent = (kpi3[0].stress||0)+'%';
    document.getElementById('martin-drop').textContent     = '-87.3%';
    document.getElementById('martin-recovery').textContent = '+196.9%';

    var annual = await q('SELECT CAST(strftime("%Y",SaleDate) AS INTEGER) as yr, COUNT(*) as cnt, ROUND(AVG(CASE WHEN DeedType="WD" AND CAST(SalePrice AS REAL)>10000 THEN CAST(SalePrice AS REAL) END)) as avg_p FROM martin_transfers WHERE SaleDate IS NOT NULL AND CAST(strftime("%Y",SaleDate) AS INTEGER) >= 2000 GROUP BY yr ORDER BY yr');
    if (annual && annual.length)
      renderLineBarChart('chart-martin-annual', annual.map(function(r){return r.yr;}), annual.map(function(r){return parseFloat(r.avg_p)||0;}), annual.map(function(r){return parseInt(r.cnt)||0;}), 'Avg Price', 'Volume');

    var deeds = await q('SELECT DeedType, COUNT(*) as cnt FROM martin_transfers WHERE CAST(strftime("%Y",SaleDate) AS INTEGER) >= 2020 AND SaleDate IS NOT NULL AND DeedType IN ("WD","QC","CT","TD","TR") GROUP BY DeedType ORDER BY cnt DESC');
    if (deeds && deeds.length)
      renderBarChart('chart-martin-deed', deeds.map(function(r){return r.DeedType;}), deeds.map(function(r){return parseInt(r.cnt);}), 'Deeds', '#2ABFB0');
  } catch(e) { console.error('Martin error: ' + e.message); }
}

// MATCHMAKER
async function loadMatchmakerKPIs() {
  try {
    var s = await q('SELECT COUNT(*) as total, SUM(CASE WHEN score>=80 THEN 1 ELSE 0 END) as hot FROM martin_motivated_sellers WHERE score>=40');
    var b = await q('SELECT COUNT(*) as total, SUM(CASE WHEN BuyScore>=70 THEN 1 ELSE 0 END) as hot, SUM(CASE WHEN IsEntity=1 THEN 1 ELSE 0 END) as entities, SUM(CASE WHEN LastBuy >= date("now","-6 months") THEN 1 ELSE 0 END) as recent FROM martin_motivated_buyers');
    if (s && s[0]) { document.getElementById('mm-sellers').textContent = fmtNum(s[0].total); document.getElementById('mm-hot').textContent = fmtNum(s[0].hot); }
    if (b && b[0]) { document.getElementById('mm-buyers').textContent = fmtNum(b[0].total); document.getElementById('mm-hot-buyers').textContent = fmtNum(b[0].hot); document.getElementById('mm-entities').textContent = fmtNum(b[0].entities); document.getElementById('mm-recent').textContent = fmtNum(b[0].recent); }
    loadMatchmaker(1);
  } catch(e) { console.error('MM KPI: ' + e.message); }
}

var mmPage = 1;
var mmPerPage = 10;

async function loadMatchmaker(page) {
  page = page || 1;
  mmPage = page;
  var city   = document.getElementById('mm-city').value.trim();
  var search = document.getElementById('mm-search').value.trim();
  var where  = ['score >= 40'];
  if (city)   where.push('SiteCity LIKE "%' + city + '%"');
  if (search) where.push('(CurrentOwner LIKE "%' + search + '%" OR SiteAddress LIKE "%' + search + '%")');
  var w = 'WHERE ' + where.join(' AND ');
  var offset = (page-1)*mmPerPage;

  var total = await q('SELECT COUNT(*) as cnt FROM martin_motivated_sellers ' + w);
  if (total && total[0]) document.getElementById('mm-info').textContent = fmtNum(total[0].cnt) + ' motivated sellers';

  var sellers = await q('SELECT id, CurrentOwner, SiteAddress, SiteCity, SiteZip, SalePrice, JustValue, PremiumPaid, days_held, score, price_tier, Homestead, is_llc_owner, ParcelID FROM martin_motivated_sellers ' + w + ' ORDER BY score DESC, SalePrice DESC LIMIT ' + mmPerPage + ' OFFSET ' + offset);
  var allBuyers = await q('SELECT BuyerName, IsEntity, PurchasesSince2020, LastBuy, AvgPrice, MinPrice, MaxPrice, PriceTier, PrimaryCity, Cities, BuyScore FROM martin_motivated_buyers WHERE BuyScore >= 40 ORDER BY BuyScore DESC LIMIT 100');

  if (!sellers) return;
  var cards = sellers.map(function(s) {
    var sc   = scoreClass(parseInt(s.score));
    var yrs  = ((parseInt(s.days_held)||0)/365).toFixed(1);
    var prem = parseFloat(s.PremiumPaid)||0;
    var scored = (allBuyers||[]).map(function(b) {
      var ms = 0;
      if (b.PrimaryCity === s.SiteCity || (b.Cities||'').indexOf(s.SiteCity) >= 0) ms += 40;
      if (b.PriceTier === s.price_tier) ms += 30;
      else if (parseFloat(b.MinPrice) <= parseFloat(s.SalePrice) && parseFloat(b.MaxPrice) >= parseFloat(s.SalePrice)) ms += 20;
      ms += parseInt(b.BuyScore) >= 70 ? 10 : 5;
      return {name:b.BuyerName, city:b.PrimaryCity, avg:b.AvgPrice, buys:b.PurchasesSince2020, ms:ms};
    }).filter(function(b){return b.ms>=30;}).sort(function(a,b){return b.ms-a.ms;}).slice(0,3);

    var buyerRows = scored.length ? scored.map(function(b) {
      return '<div class="match-buyer-row"><div class="match-buyer-score">' + b.ms + '</div><div><div class="match-buyer-name">' + esc(b.name) + '</div><div class="match-buyer-meta">' + esc(b.city||'') + ' - ' + fmtK(b.avg) + ' avg - ' + b.buys + ' buys</div></div></div>';
    }).join('') : '<div style="font-size:11px;color:var(--text3);padding:8px 0">No buyers matched</div>';

    return '<div class="match-card">' +
      '<div class="match-card-header"><div>' +
      '<div class="match-owner">' + esc(s.CurrentOwner||'Unknown') + '</div>' +
      '<div class="match-address">' + esc(s.SiteAddress||'') + ' - ' + esc(s.SiteCity||'') + '</div>' +
      '<div style="font-size:9px;color:var(--text3);font-family:monospace">' + esc(s.ParcelID||'') + '</div>' +
      '</div><div class="match-score-badge ' + sc + '">Score ' + s.score + ' - ' + sc.toUpperCase() + '</div></div>' +
      '<div class="match-metrics">' +
      '<div class="match-metric"><div class="match-metric-label">Peak Price</div><div class="match-metric-val" style="color:var(--gold)">' + fmtK(s.SalePrice) + '</div></div>' +
      '<div class="match-metric"><div class="match-metric-label">Just Value</div><div class="match-metric-val" style="color:var(--teal)">' + fmtK(s.JustValue) + '</div></div>' +
      '<div class="match-metric"><div class="match-metric-label">Premium</div><div class="match-metric-val" style="color:' + (prem>30?'var(--red)':'var(--text)') + '">' + (prem>0?'+'+prem.toFixed(0)+'%':'-') + '</div></div>' +
      '<div class="match-metric"><div class="match-metric-label">Hold</div><div class="match-metric-val">' + yrs + 'yr</div></div>' +
      '</div><div class="match-buyers-label">TOP BUYER MATCHES (' + scored.length + ')</div>' + buyerRows + '</div>';
  }).join('');

  document.getElementById('mm-cards').innerHTML = cards || '<div class="loading" style="color:var(--text3)">No results</div>';
  if (total && total[0]) renderPagination('mm-pages', parseInt(total[0].cnt), mmPerPage, page, 'loadMatchmaker');
}

function clearMatchmaker() {
  document.getElementById('mm-city').value   = '';
  document.getElementById('mm-search').value = '';
  loadMatchmaker(1);
}

// RADAR
async function loadRadarKPIs() {
  try {
    var kpi = await q('SELECT COUNT(*) as total, SUM(CASE WHEN score>=80 THEN 1 ELSE 0 END) as hot, SUM(CASE WHEN score>=60 AND score<80 THEN 1 ELSE 0 END) as warm, ROUND(AVG(CAST(SalePrice AS REAL))) as avg_price, ROUND(AVG(days_held)/365.0,1) as avg_hold, ROUND(AVG(CAST(PremiumPaid AS REAL)),1) as avg_prem FROM martin_motivated_sellers WHERE score>=40');
    if (kpi && kpi[0]) {
      document.getElementById('radar-total').textContent   = fmtNum(kpi[0].total);
      document.getElementById('radar-hot').textContent     = fmtNum(kpi[0].hot);
      document.getElementById('radar-warm').textContent    = fmtNum(kpi[0].warm);
      document.getElementById('radar-price').textContent   = fmtK(kpi[0].avg_price);
      document.getElementById('radar-hold').textContent    = (kpi[0].avg_hold||0)+'yr';
      document.getElementById('radar-premium').textContent = '+'+(kpi[0].avg_prem||0)+'%';
    }
    loadRadar(1);
  } catch(e) { console.error('Radar KPI: ' + e.message); }
}

var radarPage = 1;
var radarPerPage = 15;

async function loadRadar(page) {
  page = page || 1;
  radarPage = page;
  var minScore = document.getElementById('radar-score').value;
  var city     = document.getElementById('radar-city').value.trim();
  var where    = ['score >= ' + minScore];
  if (city) where.push('SiteCity LIKE "%' + city + '%"');
  var w = 'WHERE ' + where.join(' AND ');
  var offset = (page-1)*radarPerPage;

  var total = await q('SELECT COUNT(*) as cnt FROM martin_motivated_sellers ' + w);
  if (total && total[0]) document.getElementById('radar-info').textContent = fmtNum(total[0].cnt) + ' candidates';

  var rows = await q('SELECT CurrentOwner, SiteAddress, SiteCity, SiteZip, SalePrice, JustValue, PremiumPaid, days_held, score, score_reasons, Homestead, is_llc_owner, price_tier, MailState FROM martin_motivated_sellers ' + w + ' ORDER BY score DESC, SalePrice DESC LIMIT ' + radarPerPage + ' OFFSET ' + offset);

  if (!rows) return;
  document.getElementById('radar-cards').innerHTML = rows.map(function(r) {
    var sc   = scoreClass(parseInt(r.score));
    var yrs  = ((parseInt(r.days_held)||0)/365).toFixed(1);
    var prem = parseFloat(r.PremiumPaid)||0;
    var isOOS = r.MailState && r.MailState !== 'FL';
    return '<div class="radar-card ' + sc + '">' +
      '<div class="radar-card-header"><div>' +
      '<div class="radar-owner">' + esc(r.CurrentOwner||'Unknown') + '</div>' +
      '<div class="radar-address">' + esc(r.SiteAddress||'') + ' - ' + esc(r.SiteCity||'') + '</div>' +
      '</div><div class="match-score-badge ' + sc + '">Score ' + r.score + '</div></div>' +
      '<div class="radar-metrics">' +
      '<div class="radar-metric"><div class="radar-metric-label">Peak Price</div><div class="radar-metric-val" style="color:var(--gold)">' + fmtK(r.SalePrice) + '</div></div>' +
      '<div class="radar-metric"><div class="radar-metric-label">Premium</div><div class="radar-metric-val" style="color:var(--red)">' + (prem>0?'+'+prem.toFixed(0)+'%':'-') + '</div></div>' +
      '<div class="radar-metric"><div class="radar-metric-label">Hold</div><div class="radar-metric-val">' + yrs + 'yr</div></div>' +
      '<div class="radar-metric"><div class="radar-metric-label">Type</div><div class="radar-metric-val" style="font-size:10px">' + (r.Homestead==='N'?'INVESTOR':'OWNER') + '</div></div>' +
      '<div class="radar-metric"><div class="radar-metric-label">Tier</div><div class="radar-metric-val" style="font-size:10px">' + esc(r.price_tier||'-') + '</div></div>' +
      '<div class="radar-metric"><div class="radar-metric-label">Mail</div><div class="radar-metric-val" style="font-size:10px;' + (isOOS?'color:var(--violet)':'') + '">' + esc(r.MailState||'FL') + '</div></div>' +
      '</div><div class="radar-reasons">' + esc(r.score_reasons||'') + '</div></div>';
  }).join('');

  if (total && total[0]) renderPagination('radar-pages', parseInt(total[0].cnt), radarPerPage, page, 'loadRadar');
}

function clearRadar() {
  document.getElementById('radar-score').value = '40';
  document.getElementById('radar-city').value  = '';
  loadRadar(1);
}

// FLIP TRACKER
async function loadFlipKPIs() {
  try {
    var kpi = await q('SELECT COUNT(*) as total, ROUND(AVG(CAST(gain_pct AS REAL)),1) as avg_gain, ROUND(AVG(hold_days)) as avg_hold, ROUND(AVG(CAST(dollar_gain AS REAL))) as avg_dollar, ROUND(SUM(CAST(dollar_gain AS REAL))/1000000000,2) as total_val, MAX(CAST(gain_pct AS REAL)) as best FROM martin_flip_pairs');
    if (kpi && kpi[0]) {
      document.getElementById('flip-total').textContent      = fmtNum(kpi[0].total);
      document.getElementById('flip-avg-gain').textContent   = (kpi[0].avg_gain||0)+'%';
      document.getElementById('flip-avg-hold').textContent   = fmtNum(kpi[0].avg_hold)+'d';
      document.getElementById('flip-avg-dollar').textContent = fmtK(kpi[0].avg_dollar);
      document.getElementById('flip-total-val').textContent  = '$'+(kpi[0].total_val||0)+'B';
      document.getElementById('flip-best').textContent       = fmtNum(kpi[0].best)+'%';
    }
    loadFlips(1);
  } catch(e) { console.error('Flip KPI: ' + e.message); }
}

var flipPage = 1;
var flipPerPage = 25;

async function loadFlips(page) {
  page = page || 1;
  flipPage = page;
  var yf      = document.getElementById('flip-year-from').value;
  var yt      = document.getElementById('flip-year-to').value;
  var minGain = document.getElementById('flip-min-gain').value;
  var grantor = document.getElementById('flip-grantor').value.trim();
  var where = ['CAST(strftime("%Y",buy_date) AS INTEGER) >= ' + yf, 'CAST(strftime("%Y",buy_date) AS INTEGER) <= ' + yt];
  if (minGain) where.push('CAST(gain_pct AS REAL) >= ' + minGain);
  if (grantor) where.push('seller LIKE "%' + grantor + '%"');
  var w = 'WHERE ' + where.join(' AND ');
  var offset = (page-1)*flipPerPage;

  var total = await q('SELECT COUNT(*) as cnt FROM martin_flip_pairs ' + w);
  if (total && total[0]) document.getElementById('flip-info').textContent = fmtNum(total[0].cnt) + ' flip pairs';

  var rows = await q('SELECT ParcelID, buy_date, sell_date, buy_price, sell_price, gain_pct, dollar_gain as gain_dollars, hold_days FROM martin_flip_pairs ' + w + ' ORDER BY CAST(gain_pct AS REAL) DESC LIMIT ' + flipPerPage + ' OFFSET ' + offset);

  if (!rows) return;
  document.getElementById('flip-body').innerHTML = rows.map(function(r) {
    var g = parseFloat(r.gain_pct)||0;
    var color = g >= 100 ? 'var(--amber)' : 'var(--green)';
    return '<tr>' +
      '<td style="font-family:monospace;font-size:10px">' + esc(r.ParcelID) + '</td>' +
      '<td style="color:var(--text2)">' + String(r.buy_date||'').substring(0,10) + '</td>' +
      '<td style="color:var(--text2)">' + String(r.sell_date||'').substring(0,10) + '</td>' +
      '<td style="color:' + color + ';font-weight:700">+' + g.toFixed(1) + '%</td>' +
      '<td style="color:var(--amber)">' + fmtK(r.gain_dollars) + '</td>' +
      '<td style="font-family:monospace">' + r.hold_days + '</td></tr>';
  }).join('');

  if (total && total[0]) renderPagination('flip-pages', parseInt(total[0].cnt), flipPerPage, page, 'loadFlips');
}

function clearFlips() {
  document.getElementById('flip-year-from').value = '2023';
  document.getElementById('flip-year-to').value   = '2026';
  document.getElementById('flip-min-gain').value  = '';
  document.getElementById('flip-grantor').value   = '';
  loadFlips(1);
}

// INDIAN RIVER
async function loadIRReport() {
  try {
    var kpi = await q('SELECT COUNT(*) as total, COUNT(DISTINCT ParcelID) as parcels FROM indian_river_sales WHERE SaleDate IS NOT NULL');
    var kpi2 = await q('SELECT ROUND(AVG(CAST(SalePrice AS REAL))) as avg25, ROUND(100.0*SUM(CASE WHEN DeedType IN ("QC","CT") THEN 1 ELSE 0 END)/COUNT(*),1) as stress FROM indian_river_sales WHERE strftime("%Y",SaleDate)="2025"');
    var flips = await q('SELECT COUNT(*) as total, ROUND(SUM(CAST(gain_dollars AS REAL))/1000000000,2) as total_val FROM indian_river_flip_pairs');
    if (kpi && kpi[0]) { document.getElementById('ir-total').textContent = fmtNum(kpi[0].total); document.getElementById('ir-parcels').textContent = fmtNum(kpi[0].parcels); }
    if (kpi2 && kpi2[0]) { document.getElementById('ir-avg25').textContent = fmtK(kpi2[0].avg25); document.getElementById('ir-stress').textContent = (kpi2[0].stress||0)+'%'; }
    if (flips && flips[0]) { document.getElementById('ir-flips').textContent = fmtNum(flips[0].total); document.getElementById('ir-value').textContent = '$'+(flips[0].total_val||0)+'B'; }

    var annual = await q('SELECT CAST(strftime("%Y",SaleDate) AS INTEGER) as yr, COUNT(*) as cnt, ROUND(AVG(CASE WHEN CAST(SalePrice AS REAL)<=2000000 THEN CAST(SalePrice AS REAL) END)) as avg_p FROM indian_river_sales WHERE DeedType="WD" AND CAST(SalePrice AS REAL)>10000 AND SaleDate IS NOT NULL AND CAST(strftime("%Y",SaleDate) AS INTEGER) >= 2000 GROUP BY yr ORDER BY yr');
    if (annual && annual.length)
      renderLineBarChart('chart-ir-annual', annual.map(function(r){return r.yr;}), annual.map(function(r){return parseFloat(r.avg_p)||0;}), annual.map(function(r){return parseInt(r.cnt)||0;}), 'Avg Price', 'Volume');

    var oos = await q('SELECT State, COUNT(*) as cnt FROM indian_river_owners WHERE State != "FL" AND State IS NOT NULL AND State != "" AND PrimaryOwner = "Y" GROUP BY State ORDER BY cnt DESC LIMIT 10');
    if (oos && oos.length)
      renderBarChart('chart-ir-oos', oos.map(function(r){return r.State;}), oos.map(function(r){return parseInt(r.cnt);}), 'Owners', '#2E86AB');
  } catch(e) { console.error('IR error: ' + e.message); }
}

// ENTITY INTEL
async function loadEntityKPIs() {
  try {
    var kpi = await q('SELECT COUNT(*) as total, SUM(CASE WHEN county_count>=2 THEN 1 ELSE 0 END) as multi, SUM(total_txn) as txn, ROUND(SUM(CAST(total_vol_m AS REAL))/1000,2) as vol_b FROM entity_intelligence');
    if (kpi && kpi[0]) {
      document.getElementById('entity-total').textContent = fmtNum(kpi[0].total);
      document.getElementById('entity-multi').textContent = fmtNum(kpi[0].multi);
      document.getElementById('entity-txn').textContent   = fmtNum(kpi[0].txn);
      document.getElementById('entity-vol').textContent   = '$'+(kpi[0].vol_b||0)+'B';
    }
    document.getElementById('entity-builders').textContent = '60';
    document.getElementById('entity-ibuyers').textContent  = '5';
    loadEntities(1);
  } catch(e) { console.error('Entity KPI: ' + e.message); }
}

var entityPage = 1;
var entityPerPage = 25;

async function loadEntities(page) {
  page = page || 1;
  entityPage = page;
  var search = document.getElementById('entity-search').value.trim();
  var w = search ? 'WHERE canonical_name LIKE "%' + search + '%"' : '';
  var offset = (page-1)*entityPerPage;

  var total = await q('SELECT COUNT(*) as cnt FROM entity_intelligence ' + w);
  if (total && total[0]) document.getElementById('entity-info').textContent = fmtNum(total[0].cnt) + ' entities';

  var rows = await q('SELECT canonical_name, entity_type, counties_list, total_txn, total_vol_m FROM entity_intelligence ' + w + ' ORDER BY CAST(total_vol_m AS REAL) DESC LIMIT ' + entityPerPage + ' OFFSET ' + offset);
  if (!rows) return;
  document.getElementById('entity-body').innerHTML = rows.map(function(r) {
    return '<tr>' +
      '<td style="font-weight:500;max-width:120px;overflow:hidden;text-overflow:ellipsis">' + esc(r.canonical_name) + '</td>' +
      '<td style="color:var(--teal);font-size:10px">' + esc(r.entity_type||'-') + '</td>' +
      '<td style="font-size:10px;color:var(--text2)">' + esc(r.counties_list||'-') + '</td>' +
      '<td style="color:var(--gold)">' + fmtNum(r.total_txn) + '</td>' +
      '<td style="color:var(--green)">' + fmtK((parseFloat(r.total_vol_m)||0)*1000000) + '</td></tr>';
  }).join('');

  if (total && total[0]) renderPagination('entity-pages', parseInt(total[0].cnt), entityPerPage, page, 'loadEntities');
}

function clearEntities() {
  document.getElementById('entity-search').value = '';
  loadEntities(1);
}

// CHARTS
function renderBarChart(canvasId, labels, data, label, color) {
  var el = document.getElementById(canvasId);
  if (!el) return;
  var existing = Chart.getChart(el);
  if (existing) existing.destroy();
  new Chart(el, {
    type: 'bar',
    data: { labels: labels, datasets: [{ label: label, data: data, backgroundColor: color+'99', borderColor: color, borderWidth: 1 }] },
    options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { ticks: { color: '#6B7A8D', font: { size: 9 } }, grid: { color: 'rgba(26,46,74,0.5)' } }, y: { ticks: { color: '#6B7A8D', font: { size: 9 } }, grid: { color: 'rgba(26,46,74,0.5)' } } } }
  });
}

function renderLineBarChart(canvasId, labels, lineData, barData, lineLabel, barLabel) {
  var el = document.getElementById(canvasId);
  if (!el) return;
  var existing = Chart.getChart(el);
  if (existing) existing.destroy();
  new Chart(el, {
    data: { labels: labels, datasets: [
      { type:'bar',  label: barLabel,  data: barData,  backgroundColor: 'rgba(42,191,176,0.25)', borderColor: 'rgba(42,191,176,0.5)', borderWidth: 1, yAxisID: 'y1' },
      { type:'line', label: lineLabel, data: lineData, borderColor: '#C9A84C', backgroundColor: 'rgba(201,168,76,0.1)', borderWidth: 2, pointRadius: 2, tension: 0.3, yAxisID: 'y2', fill: true }
    ]},
    options: { responsive: true, maintainAspectRatio: false,
      plugins: { legend: { labels: { color: '#94A3B8', font: { size: 9 }, boxWidth: 10 } } },
      scales: {
        x:  { ticks: { color: '#6B7A8D', font: { size: 9 }, maxRotation: 45 }, grid: { color: 'rgba(26,46,74,0.5)' } },
        y1: { position: 'left',  ticks: { color: '#6B7A8D', font: { size: 9 } }, grid: { color: 'rgba(26,46,74,0.5)' } },
        y2: { position: 'right', ticks: { color: '#C9A84C', font: { size: 9 }, callback: function(v) { return '$'+(v/1000).toFixed(0)+'K'; } }, grid: { display: false } }
      }
    }
  });
}

// INIT
window.addEventListener('load', function() {
  console.log('Window loaded');
  function waitForDB(attempts) {
    if (typeof AndroidDB !== 'undefined') {
      console.log('AndroidDB ready');
      // Diagnostic - get column names
      try {
        var cols = AndroidDB.query('SELECT * FROM stluciecty_singleFamily LIMIT 1', '[]');
        console.log('SL columns: ' + cols);
        var fp = AndroidDB.query('SELECT * FROM martin_flip_pairs LIMIT 1', '[]');
        console.log('Flip columns: ' + fp);
      } catch(e) { console.log('Diag error: ' + e.message); }
      loaded['slreport'] = true;
      loadSLReport();
    } else if (attempts > 0) {
      setTimeout(function() { waitForDB(attempts - 1); }, 300);
    } else {
      console.error('AndroidDB not available');
    }
  }
  waitForDB(20);
});
