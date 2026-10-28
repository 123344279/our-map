/* ============================================================
   我们的地图 · 交互逻辑
   说明：纯原生 JS，双击 index.html 就能用，不需要装任何东西。
   ============================================================ */
(function () {
  'use strict';

  var STORY = window.STORY || { provinces: {} };
  var GEO = window.CHINA_GEO || [];
  var CITY_COORDS = window.CITY_COORDS || {};
  // ?static=1：关掉所有动效，给截图和"减少动态效果"用
  var STATIC = /[?&]static=1/.test(location.search);
  var REDUCED = STATIC || window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (STATIC) document.documentElement.classList.add('no-anim');

  // ----------------------------------------------------------
  // 1. 投影（Albers 等积圆锥，中国常用参数）
  // ----------------------------------------------------------
  var RAD = Math.PI / 180;
  var STD1 = 25 * RAD, STD2 = 47 * RAD, LAT0 = 35 * RAD, LON0 = 105;
  var NN = 0.5 * (Math.sin(STD1) + Math.sin(STD2));
  var CC = Math.cos(STD1) * Math.cos(STD1) + 2 * NN * Math.sin(STD1);
  var RHO0 = Math.sqrt(CC - 2 * NN * Math.sin(LAT0)) / NN;

  function rawProject(lon, lat) {
    var rho = Math.sqrt(Math.max(1e-9, CC - 2 * NN * Math.sin(lat * RAD))) / NN;
    var th = NN * (lon - LON0) * RAD;
    return [rho * Math.sin(th), -(RHO0 - rho * Math.cos(th))];
  }

  var B = { minX: 1e9, maxX: -1e9, minY: 1e9, maxY: -1e9 };
  function expand(lon, lat) {
    var p = rawProject(lon, lat);
    if (p[0] < B.minX) B.minX = p[0];
    if (p[0] > B.maxX) B.maxX = p[0];
    if (p[1] < B.minY) B.minY = p[1];
    if (p[1] > B.maxY) B.maxY = p[1];
  }

  var land = [], seaLines = [];
  GEO.forEach(function (f) {
    if (f.ad === '100000_JD' || !f.n) seaLines.push(f);
    else land.push(f);
  });
  function ringMaxLat(ring) {
    var m = -90;
    for (var i = 0; i < ring.length; i++) if (ring[i][1] > m) m = ring[i][1];
    return m;
  }

  // 只把北纬 17° 以上的陆地和主岛算进主图；南海诸岛留给右下角插图，
  // 否则主图会被拉到北纬 3°，整张地图变窄变空。
  land.forEach(function (f) {
    f.r.forEach(function (ring) {
      if (ringMaxLat(ring) < 17) return;
      ring.forEach(function (p) { expand(p[0], p[1]); });
    });
  });

  var SCALE = 1000 / (B.maxX - B.minX);
  var MAP_W = 1000;
  var MAP_H = (B.maxY - B.minY) * SCALE;

  function project(lon, lat) {
    var p = rawProject(lon, lat);
    return [(p[0] - B.minX) * SCALE, (p[1] - B.minY) * SCALE];
  }

  // ----------------------------------------------------------
  // 2. 省份几何
  // ----------------------------------------------------------
  var provs = new Map(); // name -> {name, ad, d, box, center}

  land.forEach(function (f) {
    var d = '', dMain = '', bx1 = 1e9, by1 = 1e9, bx2 = -1e9, by2 = -1e9;
    f.r.forEach(function (ring) {
      var pts = ring.map(function (p) { return project(p[0], p[1]); });
      var seg = 'M' + pts.map(function (q) { return q[0].toFixed(2) + ' ' + q[1].toFixed(2); }).join('L') + 'Z';
      d += seg;
      if (ringMaxLat(ring) < 17) return; // 南海诸岛只进插图
      dMain += seg;
      pts.forEach(function (q) {
        if (q[0] < bx1) bx1 = q[0];
        if (q[1] < by1) by1 = q[1];
        if (q[0] > bx2) bx2 = q[0];
        if (q[1] > by2) by2 = q[1];
      });
    });
    provs.set(f.n, {
      name: f.n,
      ad: f.ad,
      d: d,
      dMain: dMain || d,
      box: { x: bx1, y: by1, w: bx2 - bx1, h: by2 - by1 },
      center: project(f.c[0], f.c[1])
    });
  });

  var seaD = seaLines.map(function (f) {
    return f.r.map(function (ring) {
      var pts = ring.map(function (p) { return project(p[0], p[1]); });
      return 'M' + pts.map(function (q) { return q[0].toFixed(1) + ' ' + q[1].toFixed(1); }).join('L');
    }).join('');
  }).join('');

  // ----------------------------------------------------------
  // 3. 内容整理
  // ----------------------------------------------------------
  var stops = [];      // 有回忆的城市
  var visited = new Map(); // 省 -> {cities:Set, items:n, photos:n}

  Object.keys(STORY.provinces || {}).forEach(function (pname) {
    var pd = STORY.provinces[pname];
    var agg = { cities: [], items: 0, photos: 0 };
    Object.keys(pd.cities || {}).forEach(function (cname) {
      var cd = pd.cities[cname] || {};
      var items = (cd.items || []).slice().sort(function (a, b) {
        return String(a.date || '').localeCompare(String(b.date || ''));
      });
      if (!items.length) return;
      var coord = cd.coord || CITY_COORDS[cname] || null;
      var x, y;
      if (coord) { var q = project(coord[0], coord[1]); x = q[0]; y = q[1]; }
      else {
        var pv = provs.get(pname);
        var base = pv ? pv.center : [MAP_W / 2, MAP_H / 2];
        x = base[0]; y = base[1]; coord = 'auto';
      }
      var photos = items.reduce(function (n, it) { return n + (it.photos ? it.photos.length : 0); }, 0);
      stops.push({
        prov: pname, city: cname, coord: coord, x: x, y: y,
        items: items, first: items[0].date || '', photos: photos
      });
      agg.cities.push(cname);
      agg.items += items.length;
      agg.photos += photos;
    });
    if (agg.cities.length) visited.set(pname, agg);
  });

  stops.sort(function (a, b) { return String(a.first).localeCompare(String(b.first)); });
  stops.forEach(function (s, i) { s.order = i; });

  var stats = {
    prov: visited.size,
    city: stops.length,
    items: stops.reduce(function (n, s) { return n + s.items.length; }, 0),
    photos: stops.reduce(function (n, s) { return n + s.photos; }, 0),
    days: 0
  };
  if (STORY.couple && STORY.couple.startDate) {
    var t0 = new Date(STORY.couple.startDate + 'T00:00:00');
    stats.days = Math.max(0, Math.floor((Date.now() - t0.getTime()) / 86400000));
  }

  function findStop(prov, city) {
    for (var i = 0; i < stops.length; i++) {
      if (stops[i].prov === prov && stops[i].city === city) return stops[i];
    }
    return null;
  }

  // ----------------------------------------------------------
  // 4. 画地图
  // ----------------------------------------------------------
  var svg = document.getElementById('map');
  var gProv = document.getElementById('gProv');
  var gSea = document.getElementById('gSea');
  var gRoutes = document.getElementById('gRoutes');
  var gMarks = document.getElementById('gMarks');
  var gLabels = document.getElementById('gLabels');
  var scaleItems = [];

  provs.forEach(function (p) {
    var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', p.dMain || p.d);
    path.setAttribute('class', 'prov');
    path.setAttribute('data-prov', p.name);
    gProv.appendChild(path);
    p.el = path;
  });

  // 九段线只在右下角“南海诸岛”插图里出现，主图只画陆地，
  // 这样主图不会被拉成一条又长又空的竖条。
  if (gSea) gSea.parentNode && gSea.parentNode.removeChild(gSea);

  // 经纬网：全国视角隐藏，放大后淡入，让近景有“地图”的尺度感
  (function buildGraticule() {
    var g = document.getElementById('gGrat');
    if (!g) return;
    var ns = 'http://www.w3.org/2000/svg';
    function line(pts) {
      var p = document.createElementNS(ns, 'path');
      p.setAttribute('d', 'M' + pts.map(function (q) {
        return q[0].toFixed(1) + ' ' + q[1].toFixed(1);
      }).join('L'));
      p.setAttribute('class', 'grat-line');
      g.appendChild(p);
    }
    for (var lon = 70; lon <= 140; lon += 1) {
      var mer = [];
      for (var lat = 0; lat <= 56; lat += 1) mer.push(project(lon, lat));
      line(mer);
    }
    for (var la = 0; la <= 56; la += 1) {
      var par = [];
      for (var lo = 70; lo <= 140; lo += 1) par.push(project(lo, la));
      line(par);
    }
  })();

  // 路线
  if (stops.length > 1) {
    for (var i = 0; i < stops.length - 1; i++) {
      var a = stops[i], b = stops[i + 1];
      if (a.coord === 'auto' || b.coord === 'auto') continue;
      var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      var dx = b.x - a.x, dy = b.y - a.y;
      var len = Math.hypot(dx, dy) || 1;
      var cx = mx - (dy / len) * len * 0.16;
      var cy = my + (dx / len) * len * 0.16;
      var path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      path.setAttribute('d', 'M' + a.x.toFixed(1) + ' ' + a.y.toFixed(1) +
        'Q' + cx.toFixed(1) + ' ' + cy.toFixed(1) + ' ' + b.x.toFixed(1) + ' ' + b.y.toFixed(1));
      path.setAttribute('class', 'route');
      path.style.animationDelay = (0.45 + i * 0.09) + 's';
      gRoutes.appendChild(path);
    }
  }

  // 城市点
  stops.forEach(function (s) {
    var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'mark');
    g.setAttribute('data-prov', s.prov);
    g.setAttribute('data-city', s.city);

    var hit = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    hit.setAttribute('class', 'hit');
    hit.setAttribute('r', '16');

    var halo = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    halo.setAttribute('class', 'halo');
    halo.setAttribute('r', '8.5');

    var dot = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    dot.setAttribute('class', 'dot');
    dot.setAttribute('r', '3.6');

    g.appendChild(hit);
    g.appendChild(halo);
    g.appendChild(dot);
    gMarks.appendChild(g);
    s.el = g;
    scaleItems.push({ el: g, x: s.x, y: s.y });
  });

  // 省名位置微调（单位是屏幕像素，因为标签整体按屏幕尺寸缩放）
  var PROV_NUDGE = {
    '江苏': [-14, -14], '上海': [20, 2], '浙江': [4, 15],
    '重庆': [-4, 10], '北京': [-12, -10], '天津': [12, 6]
  };

  // 省份名
  var provLabelEls = [];
  provs.forEach(function (p) {
    if (p.ad === '100000_JD') return;
    var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'lbl provlbl');
    var t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('text-anchor', 'middle');
    var nudge = PROV_NUDGE[p.name];
    if (nudge) { t.setAttribute('dx', nudge[0]); t.setAttribute('dy', nudge[1]); }
    t.textContent = p.name;
    g.appendChild(t);
    gLabels.appendChild(g);
    scaleItems.push({ el: g, x: p.center[0], y: p.center[1] });
    provLabelEls.push({ name: p.name, el: g });
  });

  // 城市贴画（生图 + 抠底，见 shots/stamps-ai2.png）
  var STAMP = {
    '西安': 'xian', '杭州': 'hangzhou', '南浔': 'nanxun',
    '乌镇': 'wuzhen', '珠海': 'zhuhai', '汕尾': 'shanwei'
  };

  // 城市名
  var cityLabelEls = [];
  stops.forEach(function (s) {
    var g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.setAttribute('class', 'lbl citylbl');
    var key = STAMP[s.city];
    if (key) {
      var im = document.createElementNS('http://www.w3.org/2000/svg', 'image');
      var href = 'assets/stamp-' + key + '.png';
      im.setAttribute('href', href);
      im.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', href);
      im.setAttribute('x', '-11');
      im.setAttribute('y', '4');
      im.setAttribute('width', '22');
      im.setAttribute('height', '22');
      im.setAttribute('class', 'stamp');
      g.appendChild(im);
    }
    var t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('text-anchor', 'middle');
    t.setAttribute('dy', '-12');
    t.textContent = s.city;
    g.appendChild(t);
    gLabels.appendChild(g);
    scaleItems.push({ el: g, x: s.x, y: s.y });
    cityLabelEls.push({ prov: s.prov, city: s.city, el: g });
  });

  // ----------------------------------------------------------
  // 5. 视图（缩放）
  // ----------------------------------------------------------
  var COUNTRY = { x: 0, y: 0, w: MAP_W, h: MAP_H };
  var state = { level: 'country', prov: null, city: null, sheetFull: false, focus: null };
  var view = { x: COUNTRY.x, y: COUNTRY.y, w: COUNTRY.w, h: COUNTRY.h };
  var raf = 0;

  function isMobile() {
    return window.matchMedia('(max-width: 760px)').matches;
  }

  // 手机端底部卡片占掉的高度；相机要避开它，把目标放在可见区域中央
  function sheetPx() {
    if (!isMobile() || state.level === 'country') return 0;
    return Math.round((window.innerHeight || 700) * 0.58);
  }

  function fit(box, pad) {
    pad = pad == null ? 0.06 : pad;
    var cw = svg.clientWidth || 900;
    var ch = svg.clientHeight || 700;
    var visH = Math.max(140, ch - sheetPx());
    var bw = Math.max(box.w * (1 + pad), 1e-6);
    var bh = Math.max(box.h * (1 + pad), 1e-6);
    var k = Math.min(cw / bw, visH / bh);   // 屏幕像素 / 地图单位
    k = Math.min(k, cw / 0.25);             // 下限：视窗不小于 0.25 单位（约 1.7km），否则几何塌陷
    var w = cw / k, h = ch / k;
    var cx = box.x + box.w / 2, cy = box.y + box.h / 2;
    return { x: cx - w / 2, y: cy - (visH / 2) / k, w: w, h: h };
  }

  function markerScale() {
    var cw = svg.clientWidth || 900;
    // 标记以「屏幕像素」为单位：view.w / cw 是反比例因子；
    // 再乘一个随缩放缓慢增长的系数，放大后点会稍微变大，但不失控。
    var grow = Math.min(1.6, Math.max(1, Math.pow(MAP_W / view.w, 0.2)));
    return (view.w / cw) * grow;
  }

  function syncScale() {
    var txt = 'scale(' + markerScale().toFixed(4) + ')';
    for (var i = 0; i < scaleItems.length; i++) {
      var it = scaleItems[i];
      it.el.setAttribute('transform',
        'translate(' + it.x.toFixed(2) + ' ' + it.y.toFixed(2) + ') ' + txt);
    }
  }

  function setView(v) {
    view.x = v.x; view.y = v.y; view.w = v.w; view.h = v.h;
    svg.setAttribute('viewBox',
      v.x.toFixed(2) + ' ' + v.y.toFixed(2) + ' ' + v.w.toFixed(2) + ' ' + v.h.toFixed(2));
    syncScale();
    layoutPins();
    updateXianImgs();
  }

  function animateTo(v, dur) {
    cancelAnimationFrame(raf);
    dur = dur == null ? 780 : dur;
    if (REDUCED || dur <= 0) { setView(v); return; }
    var f = { cx: view.x + view.w / 2, cy: view.y + view.h / 2, w: view.w, h: view.h };
    var t = { cx: v.x + v.w / 2, cy: v.y + v.h / 2, w: v.w, h: v.h };
    var start = performance.now();
    // 拉得越远，中途"先退一点再推近"的弧度越大
    var arc = Math.min(0.16, Math.abs(Math.log(t.w / f.w)) * 0.045);
    function ease(x) { return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; }
    function step(now) {
      var p = Math.min(1, (now - start) / dur);
      var e = ease(p);
      var bump = 1 + arc * Math.sin(Math.PI * e);
      var w = f.w * Math.pow(t.w / f.w, e) * bump;
      var h = f.h * Math.pow(t.h / f.h, e) * bump;
      var cx = f.cx + (t.cx - f.cx) * e;
      var cy = f.cy + (t.cy - f.cy) * e;
      setView({ x: cx - w / 2, y: cy - h / 2, w: w, h: h });
      if (p < 1) raf = requestAnimationFrame(step);
    }
    raf = requestAnimationFrame(step);
  }

  function cityBox(coord) {
    var lon = coord[0], lat = coord[1];
    var dLon = 1.1, dLat = 0.9;
    var pts = [
      project(lon - dLon, lat - dLat), project(lon + dLon, lat - dLat),
      project(lon - dLon, lat + dLat), project(lon + dLon, lat + dLat)
    ];
    var bx1 = 1e9, by1 = 1e9, bx2 = -1e9, by2 = -1e9;
    pts.forEach(function (q) {
      if (q[0] < bx1) bx1 = q[0];
      if (q[1] < by1) by1 = q[1];
      if (q[0] > bx2) bx2 = q[0];
      if (q[1] > by2) by2 = q[1];
    });
    return { x: bx1, y: by1, w: bx2 - bx1, h: by2 - by1 };
  }

  // ----------------------------------------------------------
  // 6. 状态切换
  // ----------------------------------------------------------
  function paint() {
    document.body.setAttribute('data-level', state.level);
    provs.forEach(function (p) {
      p.el.classList.toggle('visited', visited.has(p.name));
      p.el.classList.toggle('active', state.prov === p.name);
      p.el.classList.toggle('dim', state.level !== 'country' && state.prov !== p.name);
    });
    stops.forEach(function (s) {
      s.el.classList.toggle('muted', state.level !== 'country' && s.prov !== state.prov);
      s.el.classList.toggle('current', state.city === s.city && state.prov === s.prov);
    });
    var showProvLabels = state.level === 'country';
    provLabelEls.forEach(function (o) {
      o.el.classList.toggle('show', showProvLabels && visited.has(o.name));
    });
    cityLabelEls.forEach(function (o) {
      var onCity = state.level === 'province' ||
        (state.level === 'city' && o.city === state.city);
      o.el.classList.toggle('show', onCity && o.prov === state.prov);
      o.el.classList.toggle('current', state.level === 'city' && o.city === state.city);
    });
    if (svg) svg.classList.toggle('zoomed', state.level !== 'country');
    if (svg) svg.classList.toggle('in-xian', state.level === 'city' && state.city === '西安');
    document.body.classList.toggle('sheet-full', state.level === 'country' && state.sheetFull);
    var hint = document.getElementById('sheetHint');
    if (hint) {
      hint.textContent = state.level === 'country'
        ? (state.sheetFull ? '收起' : '目录')
        : '收起';
    }
    var back = document.getElementById('back');
    var bt = document.getElementById('backText');
    if (back) back.classList.toggle('show', state.level !== 'country');
    if (bt) bt.textContent = state.level === 'city' ? '返回 ' + state.prov : '返回全国';
    var zb = document.getElementById('zoombox');
    if (zb) zb.classList.toggle('show', state.level === 'city' && state.city === '西安');
  }

  function goCountry() {
    state.level = 'country'; state.prov = null; state.city = null; state.sheetFull = false;
    paint(); renderPanel();
    animateTo(fit(COUNTRY, 0.035), 1150);
    syncHash();
  }

  function goProvince(name) {
    if (!provs.has(name)) return;
    state.level = 'province'; state.prov = name; state.city = null; state.sheetFull = false;
    paint(); renderPanel();
    animateTo(fit(provs.get(name).box, 0.42), 1100);
    syncHash();
  }

  function goCity(prov, city) {
    var s = findStop(prov, city);
    if (!s) return;
    state.level = 'city'; state.prov = prov; state.city = city; state.focus = null;
    paint(); renderPanel();
    if (city === '西安' && xianBox) animateTo(fit(xianBox, 0.05), 1300);
    else if (s.coord === 'auto') animateTo(fit(provs.get(prov).box, 0.42), 1000);
    else animateTo(fit(cityBox(s.coord), 0.06), 1050);
    syncHash();
  }

  function syncHash() {
    var h = '';
    if (state.level === 'province') h = encodeURIComponent(state.prov);
    else if (state.level === 'city') h = encodeURIComponent(state.prov) + '/' + encodeURIComponent(state.city);
    try {
      history.replaceState(null, '', h ? '#' + h : location.pathname + location.search);
    } catch (err) { /* file:// 下个别浏览器不允许，忽略即可 */ }
  }

  function fromHash() {
    var raw = decodeURIComponent((location.hash || '').replace(/^#/, ''));
    if (!raw) return false;
    var parts = raw.split('/');
    var p = parts[0], c = parts[1];
    if (p && findStop(p, c)) { goCity(p, c); return true; }
    if (p && provs.has(p)) { goProvince(p); return true; }
    return false;
  }

  // ----------------------------------------------------------
  // 7. 面板
  // ----------------------------------------------------------
  var crumbsEl = document.getElementById('crumbs');
  var titleEl = document.getElementById('pTitle');
  var subEl = document.getElementById('pSub');
  var bodyEl = document.getElementById('pBody');
  var footEl = document.getElementById('pFoot');

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }
  function fmtDate(d) {
    return String(d || '').replace(/-/g, '.');
  }
  function fmtMD(d) {
    var m = String(d || '').match(/^\d{4}-(\d{2})-(\d{2})/);
    return m ? m[1] + '.' + m[2] : String(d || '');
  }

  function setCrumbs(list) {
    crumbsEl.innerHTML = list.map(function (c, i) {
      var last = i === list.length - 1;
      if (last) return '<span class="crumb current">' + esc(c.label) + '</span>';
      return '<button class="crumb" data-crumb="' + c.kind + '" data-val="' + esc(c.val || '') + '">' +
        esc(c.label) + '</button><span class="sep">/</span>';
    }).join('');
  }

  var panelTimer = 0;
  function renderPanel() {
    clearTimeout(panelTimer);
    if (REDUCED) { renderPanelNow(); return; }
    bodyEl.style.opacity = '0';
    bodyEl.style.transform = 'translateY(6px)';
    panelTimer = setTimeout(function () {
      renderPanelNow();
      requestAnimationFrame(function () {
        bodyEl.style.opacity = '1';
        bodyEl.style.transform = 'none';
      });
    }, 130);
  }

  function renderPanelNow() {
    if (state.level === 'country') renderCountry();
    else if (state.level === 'province') renderProvince(state.prov);
    else renderCity(state.prov, state.city);
  }

  function renderCountry() {
    setCrumbs([{ label: '中国' }]);
    var names = (STORY.couple && STORY.couple.names) || [];
    titleEl.textContent = names.length === 2 ? names[0] + ' 与 ' + names[1] : (STORY.couple && STORY.couple.title) || '我们的地图';
    subEl.innerHTML = '<span class="stat">相伴 ' + stats.days.toLocaleString('en-US') + ' 天</span>' +
      '<span class="dotsep">·</span><span class="stat">' + stats.prov + ' 省</span>' +
      '<span class="dotsep">·</span><span class="stat">' + stats.city + ' 城</span>' +
      '<span class="dotsep">·</span><span class="stat">' + stats.items + ' 段回忆</span>' +
      '<span class="dotsep">·</span><span class="stat">' + stats.photos + ' 张照片</span>';

    var intro = (STORY.couple && STORY.couple.intro) || '';
    var years = {};
    stops.forEach(function (s) {
      s.items.forEach(function (it) {
        var y = String(it.date || '').slice(0, 4) || '未记';
        (years[y] = years[y] || []).push({ it: it, s: s });
      });
    });
    var ys = Object.keys(years).sort().reverse();

    var html = '';
    if (intro) html += '<p class="intro">' + esc(intro) + '</p>';
    html += '<div class="sec-label">这些年，走过的地方</div>';
    ys.forEach(function (y) {
      var rows = years[y].slice().sort(function (a, b) {
        return String(b.it.date).localeCompare(String(a.it.date));
      });
      html += '<div class="year"><span>' + esc(y) + '</span><span class="rule"></span>' +
        '<span class="ycount">' + rows.length + '</span></div>';
      rows.forEach(function (r) {
        html += '<button class="row" data-prov="' + esc(r.s.prov) + '" data-city="' + esc(r.s.city) + '">' +
          '<span class="r-date">' + esc(fmtMD(r.it.date)) + '</span>' +
          '<span class="r-title">' + esc(r.it.title || '一段回忆') + '</span>' +
          '<span class="r-city">' + esc(r.s.city) + '</span></button>';
      });
    });
    bodyEl.innerHTML = html;
    footEl.innerHTML = '<span>点地图上的省份放大，或点上面任意一条</span><kbd>Esc</kbd><span>回到全国</span>';
    bodyEl.scrollTop = 0;
  }

  function renderProvince(name) {
    var v = visited.get(name);
    var pv = provs.get(name);
    setCrumbs([{ label: '中国', kind: 'country' }, { label: name }]);
    titleEl.textContent = name;

    if (!v) {
      subEl.innerHTML = '<span class="stat muted">这里还是一张白纸</span>';
      bodyEl.innerHTML =
        '<div class="empty">' +
        '<p class="empty-mark">留白</p>' +
        '<p class="empty-text">在 ' + esc(name) + ' 还没有写下什么。<br>下次去的时候，记得回来补上。</p>' +
        '<button class="ghost" data-crumb="country">回到全国</button>' +
        '</div>';
      footEl.innerHTML = '<kbd>Esc</kbd><span>回到全国</span>';
      return;
    }

    subEl.innerHTML = '<span class="stat">' + v.cities.length + ' 座城市</span>' +
      '<span class="dotsep">·</span><span class="stat">' + v.items + ' 段回忆</span>' +
      '<span class="dotsep">·</span><span class="stat">' + v.photos + ' 张照片</span>';

    var pd = STORY.provinces[name] || {};
    var html = '';
    if (pd.note) html += '<p class="note">' + esc(pd.note) + '</p>';
    html += '<div class="cities">';
    v.cities.forEach(function (c) {
      var s = findStop(name, c);
      if (!s) return;
      html += '<button class="citem" data-prov="' + esc(name) + '" data-city="' + esc(c) + '">' +
        '<span class="c-dot"></span><span class="c-name">' + esc(c) + '</span>' +
        '<span class="c-meta">' + s.items.length + ' 段 · ' + s.photos + ' 张</span></button>';
    });
    html += '</div>';

    // 这个省的时间线
    var rows = [];
    v.cities.forEach(function (c) {
      var s = findStop(name, c);
      if (!s) return;
      s.items.forEach(function (it) { rows.push({ it: it, city: c }); });
    });
    rows.sort(function (a, b) { return String(b.it.date).localeCompare(String(a.it.date)); });
    if (rows.length > 1 && v.cities.length > 1) {
      html += '<div class="sec-label">这个省的时间线</div>';
      rows.forEach(function (r) {
        html += '<button class="row" data-prov="' + esc(name) + '" data-city="' + esc(r.city) + '">' +
          '<span class="r-date">' + esc(fmtMD(r.it.date)) + '</span>' +
          '<span class="r-title">' + esc(r.it.title || '一段回忆') + '</span>' +
          '<span class="r-city">' + esc(r.city) + '</span></button>';
      });
    }

    // 这个省的照片
    var shots = [];
    rows.forEach(function (r) {
      (r.it.photos || []).forEach(function (src) { shots.push({ src: src, city: r.city }); });
    });
    if (shots.length) {
      html += '<div class="sec-label">这个省的照片</div><div class="shotgrid">';
      shots.slice(0, 6).forEach(function (s) {
        html += '<button class="shot" data-prov="' + esc(name) + '" data-city="' + esc(s.city) + '">' +
          '<img src="' + esc(s.src) + '" alt="" loading="lazy" ' +
          'onerror="this.parentNode.classList.add(\'broken\')"></button>';
      });
      html += '</div>';
    }

    bodyEl.innerHTML = html;
    footEl.innerHTML = '<kbd>Esc</kbd><span>回到全国</span>';
    bodyEl.scrollTop = 0;
  }

  function renderCity(prov, city) {
    var s = findStop(prov, city);
    if (!s) { renderProvince(prov); return; }
    setCrumbs([{ label: '中国', kind: 'country' }, { label: prov, kind: 'prov', val: prov }, { label: city }]);
    titleEl.textContent = city;
    var first = s.items[0] && s.items[0].date;
    var placeMap = {};
    s.items.forEach(function (it) { if (it.place) placeMap[it.place] = 1; });
    var placeCount = Object.keys(placeMap).length;
    subEl.innerHTML = '<span class="stat">' + (first ? fmtDate(first) + ' 起' : '') + '</span>' +
      '<span class="dotsep">·</span><span class="stat">' + s.items.length + ' 段回忆</span>' +
      (placeCount > 2 ? '<span class="dotsep">·</span><span class="stat">' + placeCount + ' 个地方</span>' : '') +
      (s.photos ? '<span class="dotsep">·</span><span class="stat">' + s.photos + ' 张照片</span>' : '');

    var html = '';
    var list = [];
    s.items.forEach(function (it, i) {
      if (state.focus && state.focus.length && state.focus.indexOf(i) < 0) return;
      list.push({ it: it, i: i });
    });
    if (state.focus && state.focus.length) {
      var fname = s.items[state.focus[0]].place || '这一段';
      html += '<div class="filter-chip"><span>只看 ' + esc(fname) + ' · ' + list.length + ' 段</span>' +
        '<button type="button" data-clear="1">看全部</button></div>';
    }
    list.forEach(function (o) {
      var it = o.it, i = o.i;
      var photos = it.photos || [];
      html += '<article class="memory" id="m-' + i + '" style="--i:' + list.indexOf(o) + '">';
      html += '<div class="m-meta"><span class="m-date">' + esc(fmtDate(it.date)) + '</span>';
      if (it.place) html += '<span class="m-place">' + esc(it.place) + '</span>';
      html += '</div>';
      if (it.title) html += '<h3 class="m-title">' + esc(it.title) + '</h3>';
      if (it.text) html += '<p class="m-text">' + esc(it.text) + '</p>';
      if (photos.length) {
        html += '<div class="m-photos n' + Math.min(3, photos.length) + '">';
        photos.forEach(function (src, k) {
          html += '<button class="photo" data-photos="' + i + '" data-k="' + k + '">' +
            '<img src="' + esc(src) + '" alt="' + esc(it.title || city) + '" loading="lazy" ' +
            'onerror="this.parentNode.classList.add(\'broken\')">' +
            '<span class="ph-note">照片待放入</span>' +
            '</button>';
        });
        html += '</div>';
      }
      html += '</article>';
    });

    var idx = stops.indexOf(s);
    var prev = idx > 0 ? stops[idx - 1] : null;
    var next = idx < stops.length - 1 ? stops[idx + 1] : null;
    html += '<nav class="stopnav">';
    if (s.items.length > 8 && !state.focus) {
      html += '<span class="sn-note">这里的故事最多，慢慢看</span>';
    } else {
      html += prev
        ? '<button class="sn" data-prov="' + esc(prev.prov) + '" data-city="' + esc(prev.city) + '"><span class="ar">←</span> 上一站 ' + esc(prev.city) + '</button>'
        : '<span></span>';
      html += next
        ? '<button class="sn" data-prov="' + esc(next.prov) + '" data-city="' + esc(next.city) + '">下一站 ' + esc(next.city) + ' <span class="ar">→</span></button>'
        : '<span></span>';
    }
    html += '</nav>';

    bodyEl.innerHTML = html;
    footEl.innerHTML = '<kbd>Esc</kbd><span>回到' + esc(prov) + '</span>';
    bodyEl.scrollTop = 0;
  }

  // 面板点击
  bodyEl.addEventListener('click', function (e) {
    var clearBtn = e.target.closest('[data-clear]');
    if (clearBtn) {
      state.focus = null;
      renderPanel();
      return;
    }
    var crumb = e.target.closest('[data-crumb]');
    if (crumb) {
      if (crumb.dataset.crumb === 'country') goCountry();
      return;
    }
    var photo = e.target.closest('.photo');
    if (photo) {
      var s = findStop(state.prov, state.city);
      if (!s) return;
      var idx = +photo.dataset.photos;
      var k = +photo.dataset.k;
      var list = [];
      s.items.forEach(function (it) {
        (it.photos || []).forEach(function (src) {
          list.push({ src: src, item: it });
        });
      });
      var at = 0;
      for (var i = 0; i < idx; i++) at += (s.items[i].photos || []).length;
      at += k;
      openLightbox(list, at);
      return;
    }
    var btn = e.target.closest('[data-city]');
    if (btn) {
      var p = btn.dataset.prov || state.prov;
      goCity(p, btn.dataset.city);
    }
  });

  crumbsEl.addEventListener('click', function (e) {
    var c = e.target.closest('[data-crumb]');
    if (!c) return;
    if (c.dataset.crumb === 'country') goCountry();
    if (c.dataset.crumb === 'prov') goProvince(c.dataset.val);
  });

  // ----------------------------------------------------------
  // 8. 地图交互
  // ----------------------------------------------------------
  var tip = document.getElementById('tip');
  var stage = document.querySelector('.stage');

  function showTip(html, ev) {
    tip.innerHTML = html;
    tip.classList.add('on');
    moveTip(ev);
  }
  function moveTip(ev) {
    var r = stage.getBoundingClientRect();
    var x = ev.clientX - r.left, y = ev.clientY - r.top;
    tip.style.transform = 'translate(' + (x + 14) + 'px,' + (y - 8) + 'px)';
  }
  function hideTip() { tip.classList.remove('on'); }

  gProv.addEventListener('mouseover', function (e) {
    var p = e.target.closest('.prov');
    if (!p) return;
    var name = p.dataset.prov;
    var v = visited.get(name);
    showTip(
      '<b>' + esc(name) + '</b>' +
      (v ? '<i>' + v.cities.length + ' 城 · ' + v.items + ' 段</i>' : '<i>还没有故事</i>'),
      e
    );
  });
  gProv.addEventListener('mousemove', function (e) {
    if (e.target.closest('.prov')) moveTip(e);
  });
  gProv.addEventListener('mouseout', function (e) {
    if (e.target.closest('.prov')) hideTip();
  });

  gMarks.addEventListener('mouseover', function (e) {
    var m = e.target.closest('.mark');
    if (!m) return;
    var s = findStop(m.dataset.prov, m.dataset.city);
    if (!s) return;
    var it = s.items[0];
    showTip('<b>' + esc(s.city) + '</b><i>' + esc(fmtDate(it.date)) + ' · ' + esc(it.title || '') + '</i>', e);
  });
  gMarks.addEventListener('mousemove', function (e) {
    if (e.target.closest('.mark')) moveTip(e);
  });
  gMarks.addEventListener('mouseout', function (e) {
    if (e.target.closest('.mark')) hideTip();
  });

  gProv.addEventListener('click', function (e) {
    var p = e.target.closest('.prov');
    if (!p) return;
    hideTip();
    if (state.prov === p.dataset.prov && state.level !== 'country') goCountry();
    else goProvince(p.dataset.prov);
  });

  gMarks.addEventListener('click', function (e) {
    var m = e.target.closest('.mark');
    if (!m) return;
    e.stopPropagation();
    hideTip();
    goCity(m.dataset.prov, m.dataset.city);
  });

  // 点空白回全国
  svg.addEventListener('click', function (e) {
    if (e.target === svg || e.target.id === 'bg') goCountry();
  });

  // 地图上的返回按钮
  var backBtn = document.getElementById('back');
  backBtn.addEventListener('click', function () {
    if (state.level === 'city') goProvince(state.prov);
    else goCountry();
  });

  // 手机上把底部卡片收起来
  var sheetHandle = document.getElementById('sheetHandle');
  if (sheetHandle) {
    sheetHandle.addEventListener('click', function () {
      if (state.level === 'country') {
        state.sheetFull = !state.sheetFull;
        paint();
      } else if (state.level === 'city') {
        goProvince(state.prov);
      } else {
        goCountry();
      }
    });
  }

  document.addEventListener('keydown', function (e) {
    if (e.key === 'Escape') {
      if (lightbox.classList.contains('open')) { closeLightbox(); return; }
      if (state.level === 'city') goProvince(state.prov);
      else if (state.level === 'province') goCountry();
    }
    if (lightbox.classList.contains('open')) {
      if (e.key === 'ArrowRight') stepLightbox(1);
      if (e.key === 'ArrowLeft') stepLightbox(-1);
    }
  });

  // ----------------------------------------------------------
  // 9. 灯箱
  // ----------------------------------------------------------
  var lightbox = document.getElementById('lightbox');
  var lbImg = document.getElementById('lbImg');
  var lbCap = document.getElementById('lbCap');
  var lbState = { list: [], i: 0 };

  function openLightbox(list, i) {
    lbState.list = list; lbState.i = i;
    paintLightbox();
    lightbox.classList.add('open');
    document.body.classList.add('locked');
  }
  function paintLightbox() {
    var it = lbState.list[lbState.i];
    if (!it) return;
    lbImg.src = it.src;
    lbImg.alt = (it.item && it.item.title) || '';
    lbCap.innerHTML = '<span class="cap-date">' + esc(fmtDate(it.item && it.item.date)) + '</span>' +
      '<span class="cap-title">' + esc((it.item && it.item.title) || '') + '</span>' +
      '<span class="cap-count">' + (lbState.i + 1) + ' / ' + lbState.list.length + '</span>';
    var multi = lbState.list.length > 1;
    lightbox.classList.toggle('single', !multi);
  }
  function stepLightbox(d) {
    if (lbState.list.length < 2) return;
    lbState.i = (lbState.i + d + lbState.list.length) % lbState.list.length;
    paintLightbox();
  }
  function closeLightbox() {
    lightbox.classList.remove('open');
    document.body.classList.remove('locked');
  }
  lightbox.addEventListener('click', function (e) {
    if (e.target.closest('.lb-close')) { closeLightbox(); return; }
    if (e.target.closest('.lb-prev')) { stepLightbox(-1); return; }
    if (e.target.closest('.lb-next')) { stepLightbox(1); return; }
    if (e.target === lightbox || e.target.classList.contains('lb-stage')) closeLightbox();
  });

  // ----------------------------------------------------------
  // 10. 南海诸岛插图
  // ----------------------------------------------------------
  function buildInset() {
    var host = document.getElementById('inset');
    if (!host) return;
    var lon1 = 105.5, lon2 = 124, lat1 = 2.6, lat2 = 24.5;
    var pts = [
      project(lon1, lat1), project(lon2, lat1),
      project(lon1, lat2), project(lon2, lat2)
    ];
    var x1 = 1e9, x2 = -1e9, y1 = 1e9, y2 = -1e9;
    pts.forEach(function (p) {
      if (p[0] < x1) x1 = p[0];
      if (p[0] > x2) x2 = p[0];
      if (p[1] < y1) y1 = p[1];
      if (p[1] > y2) y2 = p[1];
    });
    var ns = 'http://www.w3.org/2000/svg';
    var s = document.createElementNS(ns, 'svg');
    s.setAttribute('viewBox', x1.toFixed(1) + ' ' + y1.toFixed(1) + ' ' + (x2 - x1).toFixed(1) + ' ' + (y2 - y1).toFixed(1));
    s.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    s.setAttribute('aria-hidden', 'true');

    provs.forEach(function (p) {
      var el = document.createElementNS(ns, 'path');
      el.setAttribute('d', p.d);
      el.setAttribute('class', 'prov');
      s.appendChild(el);
    });
    if (seaD) {
      var sea = document.createElementNS(ns, 'path');
      sea.setAttribute('d', seaD);
      sea.setAttribute('class', 'sea-line');
      s.appendChild(sea);
    }
    host.insertBefore(s, host.firstChild);
  }

  // ----------------------------------------------------------
  // 10b. 西安街道层
  // ----------------------------------------------------------
  var XI = window.XIAN || null;
  var xianBox = null;

  // 三级瓦片：同一中心，32km / 16km / 8km
  var XI_IMG = { lon0: 108.7665, lat0: 34.4073, lon1: 109.1179, lat1: 34.1147 };
  var XI_RECT = { x: 3000, y: 3000, w: 1000, h: 1000 };
  var xiImgs = [];

  function xiProject(lon, lat) {
    return [
      XI_RECT.x + (lon - XI_IMG.lon0) / (XI_IMG.lon1 - XI_IMG.lon0) * XI_RECT.w,
      XI_RECT.y + (XI_IMG.lat0 - lat) / (XI_IMG.lat0 - XI_IMG.lat1) * XI_RECT.h
    ];
  }

  function updateXianImgs() {
    if (!xiImgs.length) return;
    var g = document.getElementById('gXianImg');
    // 图层浓度跟着镜头一帧帧逼近目标值（不再一次性切换）
    if (g) {
      var want = svg.classList.contains('in-xian') ? 1 : 0;
      if (REDUCED) {
        g.style.opacity = String(want);
      } else {
        var cur = parseFloat(g.style.opacity || '0');
        if (isNaN(cur)) cur = 0;
        g.style.opacity = (cur + (want - cur) * 0.12).toFixed(3);
      }
    }
    var k = view.w / XI_RECT.w;
    var o13 = Math.max(0, Math.min(1, (0.9 - k) / 0.28));
    var o14 = Math.max(0, Math.min(1, (0.56 - k) / 0.18));
    xiImgs[1].style.opacity = o13.toFixed(3);
    xiImgs[2].style.opacity = o14.toFixed(3);
  }

  function buildXianImgs() {
    var g = document.getElementById('gXianImg');
    if (!g) return;
    var ns = 'http://www.w3.org/2000/svg';
    var specs = [[1000, 'xian-z12.png'], [500, 'xian-z13.png'], [250, 'xian-z14.png']];
    specs.forEach(function (s) {
      var im = document.createElementNS(ns, 'image');
      var href = 'assets/' + s[1];
      im.setAttribute('href', href);
      im.setAttributeNS('http://www.w3.org/1999/xlink', 'xlink:href', href);
      im.setAttribute('x', XI_RECT.x + (XI_RECT.w - s[0]) / 2);
      im.setAttribute('y', XI_RECT.y + (XI_RECT.h - s[0]) / 2);
      im.setAttribute('width', s[0]);
      im.setAttribute('height', s[0]);
      im.setAttribute('preserveAspectRatio', 'none');
      im.setAttribute('class', 'xn-layer');
      g.appendChild(im);
      xiImgs.push(im);
    });
    xianBox = { x: XI_RECT.x, y: XI_RECT.y, w: XI_RECT.w, h: XI_RECT.h };
    updateXianImgs();
  }

  function buildXian() {
    var g = document.getElementById('gXian');
    if (!g || !XI) return;
    var ns = 'http://www.w3.org/2000/svg';

    function line(pts, cls) {
      var d = '';
      for (var i = 0; i < pts.length; i++) {
        var p = project(pts[i][0], pts[i][1]);
        d += (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2);
      }
      var el = document.createElementNS(ns, 'path');
      el.setAttribute('d', d);
      el.setAttribute('class', cls);
      g.appendChild(el);
      return el;
    }

    function poly(pts, cls) {
      var d = '';
      for (var i = 0; i < pts.length; i++) {
        var p = project(pts[i][0], pts[i][1]);
        d += (i ? 'L' : 'M') + p[0].toFixed(2) + ' ' + p[1].toFixed(2);
      }
      var el = document.createElementNS(ns, 'path');
      el.setAttribute('d', d + 'Z');
      el.setAttribute('class', cls);
      g.appendChild(el);
    }

    // 绿地与水面
    (XI.parks || []).forEach(function (p) { poly(p.pts, 'xn-park'); });
    (XI.ponds || []).forEach(function (p) { poly(p.pts, 'xn-pond'); });

    // 街区肌理：越靠钟楼越小越密
    if (XI.fabric) {
      var F = XI.fabric, CX = 108.9422, CY = 34.2610;
      for (var lo = F.lon0; lo < F.lon1; ) {
        var dLon = 0.0034 + Math.min(0.0085, Math.abs(lo - CX) * 0.055);
        for (var la = F.lat0; la < F.lat1; ) {
          var dLat = dLon * 0.74;
          var dx = lo + dLon / 2 - CX, dy = la + dLat / 2 - CY;
          if (Math.sqrt(dx * dx + dy * dy) < F.r) {
            var jit = Math.sin(lo * 900 + la * 700) * 0.0004;
            var k = 0.62 + Math.sin(lo * 1300 + la * 400) * 0.07;
            var a = project(lo + dLon * 0.18 + jit, la + dLat * 0.18);
            var b2 = project(lo + dLon * 0.18 + jit + dLon * k, la + dLat * 0.18 + dLat * k);
            var rc = document.createElementNS(ns, 'rect');
            rc.setAttribute('x', a[0].toFixed(2));
            rc.setAttribute('y', Math.min(a[1], b2[1]).toFixed(2));
            rc.setAttribute('width', Math.abs(b2[0] - a[0]).toFixed(2));
            rc.setAttribute('height', Math.abs(b2[1] - a[1]).toFixed(2));
            rc.setAttribute('class', 'xn-block');
            g.appendChild(rc);
          }
          la += dLat;
        }
        lo += dLon;
      }
    }

    (XI.water || []).forEach(function (w) { line(w.pts, 'xn-water'); });
    (XI.roads || []).forEach(function (r) { line(r.pts, 'xn-road'); });
    (XI.arterials || []).forEach(function (r) { line(r.pts, 'xn-art'); });
    (XI.rings || []).forEach(function (r) { line(r.pts, 'xn-ring'); });
    (XI.metro || []).forEach(function (m) { line(m.pts, 'xn-metro'); });
    if (XI.moat) line(XI.moat, 'xn-moat');
    if (XI.wall) line(XI.wall, 'xn-wall');

    // 地名（跟随缩放，保持屏幕字号）
    (XI.labels || []).forEach(function (L) {
      var p = project(L.at[0], L.at[1]);
      var grp = document.createElementNS(ns, 'g');
      var t = document.createElementNS(ns, 'text');
      t.setAttribute('class', 'xn-label');
      t.setAttribute('text-anchor', 'middle');
      t.textContent = L.name;
      grp.appendChild(t);
      g.appendChild(grp);
      scaleItems.push({ el: grp, x: p[0], y: p[1] });
    });

    if (XI.bbox) {
      var a = project(XI.bbox[0], XI.bbox[1]);
      var b = project(XI.bbox[2], XI.bbox[3]);
      xianBox = {
        x: Math.min(a[0], b[0]), y: Math.min(a[1], b[1]),
        w: Math.abs(b[0] - a[0]), h: Math.abs(b[1] - a[1])
      };
    }
  }

  // 西安的回忆按坐标落成钉子；靠得太近的自动合并成一个「簇」，
  // 簇上显示条数，点一下就把镜头推到那一片。
  var pinData = [];
  var pinPool = [];
  var pinLayer = null;
  var CLUSTER_PX = 34;

  function collectPins() {
    pinData = [];
    var prov = STORY.provinces['陕西'];
    var city = prov && prov.cities && prov.cities['西安'];
    if (!city || !city.items) return;
    city.items.forEach(function (it, idx) {
      if (!it.coord) return;
      var p = xiProject(it.coord[0], it.coord[1]);
      pinData.push({ x: p[0], y: p[1], idx: idx, name: it.place || '' });
    });
  }

  function pinElAt(i) {
    if (pinPool[i]) return pinPool[i];
    var ns = 'http://www.w3.org/2000/svg';
    var g = document.createElementNS(ns, 'g');
    g.setAttribute('class', 'pin');

    var hitEl = document.createElementNS(ns, 'circle');
    hitEl.setAttribute('class', 'pin-hit');
    hitEl.setAttribute('r', '18');

    var ringEl = document.createElementNS(ns, 'circle');
    ringEl.setAttribute('class', 'pin-ring');

    var dotEl = document.createElementNS(ns, 'circle');
    dotEl.setAttribute('class', 'pin-dot');
    dotEl.setAttribute('r', '2.6');

    var cntEl = document.createElementNS(ns, 'text');
    cntEl.setAttribute('class', 'pin-count');
    cntEl.setAttribute('text-anchor', 'middle');
    cntEl.setAttribute('y', '4.2');

    g.appendChild(hitEl);
    g.appendChild(ringEl);
    g.appendChild(dotEl);
    g.appendChild(cntEl);
    pinLayer.appendChild(g);
    pinPool[i] = { g: g, ring: ringEl, dot: dotEl, cnt: cntEl };
    return pinPool[i];
  }

  function layoutPins() {
    if (!pinLayer || !pinData.length) return;
    var cw = svg.clientWidth || 900;
    var thr = CLUSTER_PX * view.w / cw;       // 屏幕 34px 换算成地图单位
    var groups = [];
    var used = {};

    for (var i = 0; i < pinData.length; i++) {
      if (used[i]) continue;
      var members = [pinData[i]];
      used[i] = 1;
      for (var j = i + 1; j < pinData.length; j++) {
        if (used[j]) continue;
        var dx = pinData[j].x - pinData[i].x;
        var dy = pinData[j].y - pinData[i].y;
        if (Math.sqrt(dx * dx + dy * dy) < thr) { members.push(pinData[j]); used[j] = 1; }
      }
      var sx = 0, sy = 0;
      for (var m = 0; m < members.length; m++) { sx += members[m].x; sy += members[m].y; }
      groups.push({ x: sx / members.length, y: sy / members.length, members: members });
    }

    var s = markerScale();
    for (var k = 0; k < groups.length; k++) {
      var gr = groups[k];
      var el = pinElAt(k);
      el.g.style.display = '';
      el.g.setAttribute('transform',
        'translate(' + gr.x.toFixed(2) + ' ' + gr.y.toFixed(2) + ') scale(' + s.toFixed(4) + ')');
      el.g._members = gr.members;
      var n = gr.members.length;
      el.g.classList.toggle('cluster', n > 1);
      el.ring.setAttribute('r', n > 1 ? String(8 + Math.min(7, n * 1.2)) : '7');
      el.cnt.textContent = n > 1 ? String(n) : '';
      el.dot.style.display = n > 1 ? 'none' : '';
    }
    for (var z = groups.length; z < pinPool.length; z++) pinPool[z].g.style.display = 'none';
  }

  // ----------------------------------------------------------
  // 11. 启动
  // ----------------------------------------------------------
  function fitNow() {
    if (state.level === 'country') setView(fit(COUNTRY, 0.035));
    else if (state.level === 'province') setView(fit(provs.get(state.prov).box, 0.42));
    else if (state.city === '西安' && xianBox) setView(fit(xianBox, 0.05));
    else {
      var s = findStop(state.prov, state.city);
      if (s && s.coord !== 'auto') setView(fit(cityBox(s.coord), 0.06));
      else setView(fit(provs.get(state.prov).box, 0.42));
    }
  }

  var rt = 0;
  window.addEventListener('resize', function () {
    clearTimeout(rt);
    rt = setTimeout(function () { fitNow(); paint(); }, 120);
  });

  // 手机上地址栏收起、横竖屏切换都会改尺寸，用 ResizeObserver 兜住
  if (window.ResizeObserver) {
    var ro = new ResizeObserver(function () {
      clearTimeout(rt);
      rt = setTimeout(fitNow, 80);
    });
    ro.observe(svg);
  }

  var pinMenu = null;

  function closePinMenu() {
    if (pinMenu) pinMenu.classList.remove('show');
  }

  function scrollToCard(idx) {
    var card = document.getElementById('m-' + idx);
    if (!card) return;
    card.scrollIntoView({ behavior: REDUCED ? 'auto' : 'smooth', block: 'center' });
    card.classList.add('flash');
    setTimeout(function () { card.classList.remove('flash'); }, 1400);
  }

  function openPinMenu(pinEl, members) {
    var stage = document.querySelector('.stage');
    if (!pinMenu) {
      pinMenu = document.createElement('div');
      pinMenu.className = 'pin-menu';
      stage.appendChild(pinMenu);
      pinMenu.addEventListener('click', function (e) {
        var b = e.target.closest('[data-idx]');
        if (!b) return;
        e.stopPropagation();
        state.focus = [+b.getAttribute('data-idx')];
        renderPanel();
        closePinMenu();
      });
    }
    var city = STORY.provinces['陕西'].cities['西安'];
    var head = city.items[members[0].idx].place || '';
    var html = '<div class="pm-title">' + esc(head) + '</div>';
    members.forEach(function (mem) {
      var it = city.items[mem.idx];
      html += '<button class="pm-item" type="button" data-idx="' + mem.idx + '">' +
        '<span class="pm-date">' + esc(fmtDate(it.date)) + '</span>' +
        '<span class="pm-name">' + esc(it.title || '') + '</span></button>';
    });
    pinMenu.innerHTML = html;
    pinMenu.classList.add('show');

    var r = pinEl.getBoundingClientRect();
    var s = stage.getBoundingClientRect();
    var mw = pinMenu.offsetWidth, mh = pinMenu.offsetHeight;
    var left = r.left - s.left + r.width / 2 - mw / 2;
    var top = r.top - s.top - mh - 14;
    left = Math.max(12, Math.min(left, s.width - mw - 12));
    top = Math.max(12, top);
    if (top < 12) top = r.bottom - s.top + 14;
    pinMenu.style.transform = 'translate(' + left + 'px,' + top + 'px)';
  }

  function init() {
    // 封面：点「进去看看」才进地图；带 hash 或 ?nocc=1 时直接跳过
    var cover = document.getElementById('cover');
    var coverBtn = document.getElementById('coverBtn');
    function hideCover() {
      if (!cover) return;
      cover.classList.add('gone');
      setTimeout(function () { cover.style.display = 'none'; }, 900);
    }
    if (coverBtn) coverBtn.addEventListener('click', hideCover);
    var skip = (location.hash.length > 1) || /[?&]nocc=1/.test(location.search);
    if (!skip && cover) cover.classList.add('show');
    if (skip) hideCover();

    buildInset();
    buildXianImgs();
    pinLayer = document.getElementById('gPins');
    collectPins();

    // 调试：?focustest=1 点中第一个单点，验证“只看这一处”
    if (/[?&]focustest=1/.test(location.search)) {
      setTimeout(function () {
        var pins = document.querySelectorAll('#gPins .pin');
        for (var i = 0; i < pins.length; i++) {
          if (pins[i]._members && pins[i]._members.length === 1) {
            pins[i].dispatchEvent(new MouseEvent('click', { bubbles: true }));
            break;
          }
        }
      }, 900);
    }

    // 调试：?menutest=1 直接弹出第一个多条的钉菜单
    if (/[?&]menutest=1/.test(location.search)) {
      setTimeout(function () {
        var pins = document.querySelectorAll('#gPins .pin');
        for (var i = 0; i < pins.length; i++) {
          if (pins[i]._members && pins[i]._members.length > 1) {
            openPinMenu(pins[i], pins[i]._members);
            break;
          }
        }
      }, 900);
    }

    if (pinLayer) {
      pinLayer.addEventListener('click', function (e) {
        var pin = e.target.closest('.pin');
        if (!pin) return;
        var members = pin._members || [];
        if (!members.length) return;
        e.stopPropagation();
        if (members.length > 1) {
          var x1 = 1e9, y1 = 1e9, x2 = -1e9, y2 = -1e9;
          members.forEach(function (m) {
            if (m.x < x1) x1 = m.x;
            if (m.y < y1) y1 = m.y;
            if (m.x > x2) x2 = m.x;
            if (m.y > y2) y2 = m.y;
          });
          // 同一个地点（坐标几乎一致）：放大也分不开，改成弹出列表
          if ((x2 - x1) < 0.004 && (y2 - y1) < 0.004) {
            openPinMenu(pin, members);
            return;
          }
          animateTo(fit({
            x: x1, y: y1,
            w: Math.max(x2 - x1, 0.0008),
            h: Math.max(y2 - y1, 0.0008)
          }, 1.1), 640);
          return;
        }
        scrollToCard(members[0].idx);
        state.focus = members.map(function (m) { return m.idx; });
        renderPanel();
      });
    }

    // 手动放大 / 缩小（西安街道图上才显示）
    function zoomBy(f) {
      var cx = view.x + view.w / 2, cy = view.y + view.h / 2;
      var w = view.w / f, h = view.h / f;
      animateTo({ x: cx - w / 2, y: cy - h / 2, w: w, h: h }, 380);
    }
    var zin = document.getElementById('zin');
    var zout = document.getElementById('zout');
    if (zin) zin.addEventListener('click', function () { zoomBy(1.7); });
    if (zout) zout.addEventListener('click', function () { zoomBy(1 / 1.7); });

    var c = STORY.couple || {};
    var bt = document.getElementById('brandTitle');
    if (bt && c.title) bt.textContent = c.title;
    var be = document.getElementById('brandEyebrow');
    if (be) {
      be.textContent = c.startDate ? 'OUR MAP · SINCE ' + String(c.startDate).slice(0, 4) : 'OUR MAP';
    }
    var bs = document.getElementById('brandSub');
    if (bs && c.tagline) bs.textContent = c.tagline;

    setView(fit(COUNTRY, 0.035));
    paint();
    if (!fromHash()) renderCountry();
    document.body.classList.add('ready');
  }

  // 等一帧，确保能看到容器尺寸
  requestAnimationFrame(function () { requestAnimationFrame(init); });

  window.__MAP__ = { goCountry: goCountry, goProvince: goProvince, goCity: goCity, state: state, view: view };
})();
