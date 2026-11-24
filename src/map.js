import labels from '../assets/map-labels.js';
import { latestBySite, statusNames } from './data.js';
import { icon } from './icons.js';

// The bundled city extract covers a 6 × 6 tile rectangle at Web Mercator z12.
const ORIGIN_X = 3261 * 256;
const ORIGIN_Y = 1422 * 256;
const WORLD = 4096 * 256;
const EXTENT = 6 * 256;
const RASTER = new URL('../assets/map-ulaanbaatar.webp', import.meta.url).href;
const baseLabels = labels.filter(([, x, y]) => x >= 0 && x < EXTENT && y >= 0 && y < EXTENT)
  .sort((a, b) => Number(b[3] === 'city') - Number(a[3] === 'city'));

function project(lat, lng) {
  const radians = Math.max(-85.051129, Math.min(85.051129, lat)) * Math.PI / 180;
  return { x: (Number(lng) + 180) / 360 * WORLD - ORIGIN_X,
    y: (1 - Math.asinh(Math.tan(radians)) / Math.PI) / 2 * WORLD - ORIGIN_Y };
}

function element(tag, className, parent) {
  const node = document.createElement(tag);
  node.className = className;
  parent?.append(node);
  return node;
}

function control(parent, title, glyph, handler) {
  const button = element('button', 'geo-control', parent);
  button.type = 'button';
  button.title = title;
  button.setAttribute('aria-label', title);
  button.innerHTML = glyph;
  button.addEventListener('click', handler);
  return button;
}

export function mountMap(container, { sites = [], records = [], onSite, expanded = false }) {
  const controller = new AbortController();
  const { signal } = controller;
  const map = element('div', 'geo-map' + (expanded ? ' geo-expanded' : ''));
  map.tabIndex = 0;
  map.setAttribute('role', 'region');
  map.setAttribute('aria-label', 'Хяналтын цэгүүдийн газрын зураг. Сумтай товчоор зөөж, нэмэх, хасах товчоор томруулж, жижигрүүлнэ.');
  container.replaceChildren(map);

  const tiles = element('div', 'geo-tiles', map);
  const raster = element('img', 'geo-raster', map);
  raster.alt = '';
  raster.src = RASTER;
  raster.draggable = false;
  const labelLayer = element('div', 'geo-labels', map);
  const markerLayer = element('div', 'geo-markers', map);
  const labelNodes = baseLabels.map(([name, x, y, kind]) => {
    const node = element('span', 'geo-label' + (kind === 'city' ? ' geo-city' : ''), labelLayer);
    node.textContent = name;
    node.setAttribute('aria-hidden', 'true');
    return { node, x, y, width: name.length * (kind === 'city' ? 9 : 6.5) + 6 };
  });
  const latest = latestBySite(records);
  const points = sites.filter(s => Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng))).map(site => {
    const status = latest.get(site.id)?.status || 'unread';
    const node = element('button', 'geo-marker', markerLayer);
    node.dataset.status = status;
    node.type = 'button';
    node.setAttribute('aria-label', `${site.name} · ${statusNames[status] || statusNames.unread}`);
    element('span', 'geo-marker-dot', node);
    const hint = element('span', 'geo-marker-hint', node);
    hint.textContent = site.name;
    hint.setAttribute('aria-hidden', 'true');
    node.addEventListener('click', () => onSite?.(site));
    return { ...project(site.lat, site.lng), node };
  });

  const toolbar = element('div', 'geo-tools', map);
  const zoomGroup = element('div', 'geo-group', toolbar);
  const add = control(zoomGroup, 'Газрын зураг томруулах', icon('plus', 16), () => zoomAt(1.5));
  const minus = control(zoomGroup, 'Газрын зураг жижигрүүлэх', '<svg width="16" height="16" aria-hidden="true" viewBox="0 0 24 24"><path d="M4 12h16" stroke="currentColor" stroke-linecap="round" stroke-width="2"/></svg>', () => zoomAt(1 / 1.5));
  control(toolbar, 'Бүх цэгийг багтаах', icon('locate', 16), fit);

  const layerWrap = element('div', 'geo-layers', map);
  const layerButton = control(layerWrap, 'Газрын зургийн давхарга', icon('layers', 16), () => showOptions(options.hidden));
  layerButton.setAttribute('aria-expanded', 'false');
  const options = element('div', 'geo-options', layerWrap);
  options.hidden = true;
  for (const [text, layer] of [['Хяналтын цэг', markerLayer], ['Газрын нэр', labelLayer]]) {
    const row = element('label', '', options);
    const checkbox = element('input', '', row);
    checkbox.type = 'checkbox';
    checkbox.checked = true;
    checkbox.addEventListener('change', () => { layer.hidden = !checkbox.checked; render(); });
    row.append(document.createTextNode(text));
  }
  function showOptions(show) {
    options.hidden = !show;
    layerButton.setAttribute('aria-expanded', String(show));
  }
  document.addEventListener('pointerdown', e => { if (!layerWrap.contains(e.target)) showOptions(false); }, { signal });

  const scaleBar = element('div', 'geo-scale', map);
  scaleBar.setAttribute('aria-hidden', 'true');
  const credits = element('details', 'geo-credits', map);
  credits.innerHTML = '<summary aria-label="Газрын зургийн эх сурвалж">© OpenStreetMap</summary><div><a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap contributors</a> · <a href="https://openfreemap.org/" target="_blank" rel="noopener">OpenFreeMap</a> · <a href="https://openmaptiles.org/" target="_blank" rel="noopener">© OpenMapTiles</a><br>Өндөршил · <a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" target="_blank" rel="noopener">Mapzen Terrain, USGS, NASA</a></div>';

  let width = 0, height = 0, scale = 1, minScale = 0.3, cx = 827, cy = 725;
  const maxScale = 8;
  let pending = 0;
  let changedView = false;
  const networkTiles = new Map();
  window.addEventListener('online', () => {
    for (const [key, tile] of networkTiles) {
      if (tile.hidden) {
        tile.remove();
        networkTiles.delete(key);
      }
    }
    render();
  }, { signal });
  function fit() {
    changedView = false;
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const left = xs.length ? Math.min(...xs) : 505;
    const right = xs.length ? Math.max(...xs) : 1186;
    const top = ys.length ? Math.min(...ys) : 536;
    const bottom = ys.length ? Math.max(...ys) : 833;
    // Keep the city centre and the river valley in view behind the ger districts.
    const regionalView = (points.length > 1 || !points.length) && left > 400 && right < 1260 && top > 440 && bottom < 900;
    const valleyMargin = regionalView ? Math.min(100, (bottom - top) / 3) : 0;
    cx = (left + right) / 2;
    cy = (top + bottom + valleyMargin) / 2;
    const fitScale = Math.min((width - Math.min(90, width * 0.19)) / Math.max(120, right-left), (height - Math.min(74, height * 0.21)) / Math.max(80, bottom-top+valleyMargin));
    scale = Math.max(0.0002, Math.min(fitScale, 2));
    minScale = Math.max(0.00017, Math.min(0.45, scale * 0.65));
    render();
  }
  function zoomAt(factor, atX = width / 2, atY = height / 2) {
    const next = Math.min(maxScale, Math.max(minScale, scale * factor));
    cx += (atX - width / 2) * (1 / scale - 1 / next);
    cy += (atY - height / 2) * (1 / scale - 1 / next);
    scale = next;
    changedView = true;
    render();
  }

  // Exterior coverage and street-level detail load on demand. A failed detail
  // tile remains transparent over the local base when the device is offline.
  function paintTiles(x0, y0) {
    const minX = -x0 / scale, minY = -y0 / scale;
    const maxX = (width - x0) / scale, maxY = (height - y0) / scale;
    const needed = new Set();
    const details = scale > 3;
    tiles.classList.toggle('geo-tiles-detail', details);
    if (details || minX < 0 || minY < 0 || maxX > EXTENT || maxY > EXTENT) {
      const z = Math.max(0, Math.min(19, Math.round(12 + Math.log2(scale))));
      const size = 256 * 2 ** (12 - z), limit = 2 ** z;
      for (let x = Math.floor((minX + ORIGIN_X) / size); x <= Math.floor((maxX + ORIGIN_X) / size); x++) {
        for (let y = Math.floor((minY + ORIGIN_Y) / size); y <= Math.floor((maxY + ORIGIN_Y) / size); y++) {
          const tx = x * size - ORIGIN_X, ty = y * size - ORIGIN_Y;
          const covered = tx >= 0 && ty >= 0 && tx + size <= EXTENT && ty + size <= EXTENT;
          if (x < 0 || y < 0 || x >= limit || y >= limit || (covered && !details)) continue;
          const key = `${z}/${x}/${y}`;
          needed.add(key);
          let tile = networkTiles.get(key);
          if (!tile) {
            if (navigator.onLine === false) continue;
            tile = element('img', 'geo-tile', tiles);
            tile.alt = '';
            tile.draggable = false;
            tile.referrerPolicy = 'strict-origin-when-cross-origin';
            tile.addEventListener('error', () => { tile.hidden = true; });
            tile.src = `https://tile.openstreetmap.org/${key}.png`;
            networkTiles.set(key, tile);
          }
          tile.style.cssText = `left:${x0 + tx * scale}px;top:${y0 + ty * scale}px;width:${size * scale + 0.5}px;height:${size * scale + 0.5}px;`;
        }
      }
    }
    for (const [key, tile] of networkTiles) {
      if (!needed.has(key)) { tile.remove(); networkTiles.delete(key); }
    }
  }

  function draw() {
    pending = 0;
    cx = Math.max(-ORIGIN_X, Math.min(cx, WORLD - ORIGIN_X));
    cy = Math.max(-ORIGIN_Y, Math.min(cy, WORLD - ORIGIN_Y));
    const x0 = width / 2 - cx * scale, y0 = height / 2 - cy * scale;
    raster.style.transform = `translate(${x0}px,${y0}px) scale(${scale})`;
    paintTiles(x0, y0);
    const usedLabels = [];
    for (const p of points) {
      const x = x0 + p.x * scale, y = y0 + p.y * scale;
      p.node.hidden = x < -15 || y < -15 || x > width + 15 || y > height + 15;
      p.node.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
      if (!markerLayer.hidden) usedLabels.push({ left: x - 10, right: x + 10, top: y - 11, bottom: y + 11 });
    }
    for (const p of labelNodes) {
      const x = x0 + p.x * scale, originalY = y0 + p.y * scale;
      let visible = false;
      for (const dy of [0, 16, -16]) {
        const y = originalY + dy;
        const box = { left: x - p.width / 2, right: x + p.width / 2, top: y - 8, bottom: y + 8 };
        if (box.left < 6 || box.top < 4 || box.right > width - 4 || box.bottom > height - 12) continue;
        if (usedLabels.some(b => b.left < box.right && b.right > box.left && b.top < box.bottom && b.bottom > box.top)) continue;
        usedLabels.push(box);
        p.node.style.transform = `translate(${x}px,${y}px) translate(-50%,-50%)`;
        visible = true;
        break;
      }
      p.node.hidden = !visible;
    }
    const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (cy + ORIGIN_Y) / WORLD)));
    const metersPerPixel = 40075016.686 * Math.cos(lat) / WORLD / scale;
    const target = metersPerPixel * 62, power = 10 ** Math.floor(Math.log10(target));
    const distance = ([5, 2, 1].find(n => n * power <= target) || 1) * power;
    scaleBar.textContent = distance >= 1000 ? `${distance / 1000} км` : `${distance} м`;
    scaleBar.style.width = `${Math.max(1, distance / metersPerPixel)}px`;
    add.disabled = scale >= maxScale;
    minus.disabled = scale <= minScale;
  }
  function render() {
    if (!pending) pending = requestAnimationFrame(draw);
  }
  function resize() {
    width = map.clientWidth; height = map.clientHeight;
    if (!width || !height) return;
    if (changedView) render(); else fit();
  }
  const observer = new ResizeObserver(resize);
  observer.observe(map);
  resize();

  const pointers = new Map();
  function gesture() {
    const [first, second] = pointers.values();
    if (!second) return first;
    return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2,
      distance: Math.hypot(second.x - first.x, second.y - first.y) };
  }
  map.addEventListener('pointerdown', e => {
    if (!expanded && e.pointerType === 'touch') return;
    if (e.button !== 0 || e.target.closest('button,details,.geo-options')) return;
    if (pointers.size >= 2) return;
    showOptions(false);
    credits.open = false;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    map.setPointerCapture(e.pointerId);
    map.classList.add('geo-dragging');
  });
  map.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const previous = gesture();
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const next = gesture();
    if (previous.distance > 0 && next.distance > 0) {
      const rect = map.getBoundingClientRect();
      zoomAt(next.distance / previous.distance, previous.x - rect.left, previous.y - rect.top);
    }
    cx -= (next.x - previous.x) / scale;
    cy -= (next.y - previous.y) / scale;
    changedView = true;
    render();
  });
  map.addEventListener('lostpointercapture', e => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) map.classList.remove('geo-dragging');
  });
  map.addEventListener('dblclick', e => {
    if (e.target.closest('button,details,.geo-options')) return;
    const rect = map.getBoundingClientRect();
    zoomAt(e.shiftKey ? 1 / 1.5 : 1.5, e.clientX - rect.left, e.clientY - rect.top);
  });
  map.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey && !expanded) return;
    e.preventDefault();
    const rect = map.getBoundingClientRect();
    zoomAt(Math.exp(-Math.sign(e.deltaY) * 0.21), e.clientX - rect.left, e.clientY - rect.top);
  }, { passive: false });
  map.addEventListener('keydown', e => {
    if (e.key === 'Escape') { showOptions(false); credits.open = false; return; }
    if (e.target !== map) return;
    const movement = { ArrowRight: [1, 0], ArrowLeft: [-1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
    if (movement) {
      e.preventDefault(); changedView = true;
      cx += movement[0] * 60 / scale; cy += movement[1] * 60 / scale; render();
    } else if (['+', '=', '-'].includes(e.key)) {
      e.preventDefault(); zoomAt(e.key === '-' ? 1 / 1.5 : 1.5);
    } else if (e.key === 'Home') { e.preventDefault(); fit(); }
  });
  return () => { observer.disconnect(); controller.abort(); cancelAnimationFrame(pending); map.remove(); };
}
