import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { createScene } from './scene.js';
import { createCamera } from './camera.js';
import { createGrid } from './grid.js';
import { spawnMannequin } from './MannequinManager.js';
import { createPrimitive, rebuildPrimitiveGeometry } from './PrimitiveManager.js';
import { FaceSelector } from './FaceSelector.js';
import { HistoryManager } from './HistoryManager.js';

const scene = createScene();
const canvas = document.querySelector('canvas') || document.body.appendChild(document.createElement('canvas'));
const { camera, controls } = createCamera(canvas);
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
createGrid(scene);

// --- TransformControls ---
const transformControls = new TransformControls(camera, canvas);
scene.add(transformControls);
transformControls.addEventListener('dragging-changed', (e) => (controls.enabled = !e.value));

let selectedRoot = null;
let selectedBone = null;
let selectedJointMesh = null;

// coordinate UI
let coordUI = null;
let coordX = null;
let coordY = null;
let coordZ = null;
let coordUpdating = false;

// --- FaceSelector ---
const faceSelector = new FaceSelector(scene, camera, renderer);
let faceModeActive = false;
let _pendingMergeA = null;
let _pendingMergeB = null;

faceSelector.onDock = (rootA, rootB) => {
  console.log('Dock complete');
  setFaceMode(false);
  updateDockBtn();
  _pendingMergeA = rootA;
  _pendingMergeB = rootB;
  showMergePrompt();
};

window.addEventListener('facesReady', () => {
  updateDockBtn();
});

// --- HistoryManager ---
const history = new HistoryManager(scene);
window._historyManager = history; // スナップショットUIのボタンから参照
history.buildSnapUI();
history.startAutoSnapshot();

// --- utils ---
function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }
function isNumber(x) { return typeof x === 'number' && Number.isFinite(x); }

function clearHighlight() {
  if (selectedRoot) {
    selectedRoot.traverse((c) => {
      if (c.isMesh && c.userData?.originalColor != null) c.material.color.setHex(c.userData.originalColor);
    });
  }
  if (selectedJointMesh && selectedJointMesh.isMesh && selectedJointMesh.userData?.originalColor != null) {
    selectedJointMesh.material.color.setHex(selectedJointMesh.userData.originalColor);
  }
  selectedJointMesh = null;
}

function clampToGround(obj) {
  if (!obj) return;
  const box = new THREE.Box3().setFromObject(obj);
  if (box.min.y < 0) obj.position.y += (-box.min.y);
}

transformControls.addEventListener('objectChange', () => {
  if (selectedRoot) clampToGround(selectedRoot);
  syncCoordUI();
});

// --- STL export ---
function exportSTL() {
  const exporter = new STLExporter();
  const tmp = new THREE.Scene();
  scene.traverse((o) => {
    if (!o.isMesh) return;
    if (o.userData?.isFaceHighlight) return; // ハイライトは除外
    let t = o;
    while (t && !t.userData?.isSelectable && t.parent) t = t.parent;
    if (!t?.userData?.isSelectable) return;
    const cloned = o.clone();
    cloned.geometry = o.geometry.clone();
    cloned.material = o.material.clone();
    cloned.applyMatrix4(o.matrixWorld);
    cloned.matrixAutoUpdate = false;
    tmp.add(cloned);
  });
  const result = exporter.parse(tmp);
  const blob = new Blob([result], { type: 'text/plain' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = 'synapse_model.stl';
  link.click();
}

// --- selection ---
function selectByHit(hitObj) {
  // 面選択モード中は通常選択を無効
  if (faceModeActive) return;

  clearHighlight();
  selectedBone = null;

  if (hitObj?.userData?.isJoint && hitObj.userData.boneRef) {
    selectedJointMesh = hitObj;
    selectedJointMesh.material.color.setHex(0xffff00);
    let t = hitObj;
    while (t && !t.userData?.isSelectable && t.parent) t = t.parent;
    selectedRoot = t?.userData?.isSelectable ? t : null;
    selectedBone = hitObj.userData.boneRef;
    transformControls.attach(selectedBone);
    transformControls.setMode('rotate');
    syncUI();
    syncCoordUI();
    return;
  }

  let target = hitObj;
  while (target && !target.userData?.isSelectable && target.parent) target = target.parent;

  if (target?.userData?.isSelectable) {
    selectedRoot = target;
    transformControls.attach(selectedRoot);
    transformControls.setMode('translate');
    selectedRoot.traverse((c) => { if (c.isMesh) c.material.color.setHex(0xffff00); });
  } else {
    selectedRoot = null;
    transformControls.detach();
  }
  syncUI();
  syncCoordUI();
}

function isPrimitiveSelected() {
  return !!(selectedRoot?.isMesh && selectedRoot.userData?.type === 'primitive');
}

// --- マージ確認ダイアログ ---
let mergePrompt = null;
function showMergePrompt() {
  if (mergePrompt) mergePrompt.remove();

  mergePrompt = document.createElement('div');
  mergePrompt.style.cssText = [
    'position:fixed', 'bottom:80px', 'left:50%',
    'transform:translateX(-50%)',
    'background:rgba(0,0,0,0.92)',
    'border:1px solid #00ffcc',
    'border-radius:14px',
    'color:#fff',
    'z-index:10000',
    'padding:16px 24px',
    'text-align:center',
    'box-shadow:0 0 24px rgba(0,255,204,0.25)',
    'font-size:14px',
  ].join(';');

  mergePrompt.innerHTML = `
    <div style="margin-bottom:12px;font-weight:900;color:#00ffcc;">ドッキング完了 ✅</div>
    <div style="margin-bottom:14px;opacity:0.8;">ジオメトリを完全に結合しますか？<br><small>（STL出力時に一体化されます）</small></div>
    <div style="display:flex;gap:10px;justify-content:center;">
      <button id="merge-yes" style="padding:8px 20px;background:#00aa44;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:900;">🔗 結合する</button>
      <button id="merge-no" style="padding:8px 20px;background:#555;color:white;border:none;border-radius:8px;cursor:pointer;font-weight:900;">このまま保持</button>
    </div>
  `;
  document.body.appendChild(mergePrompt);

  mergePrompt.querySelector('#merge-yes').onclick = () => {
    if (_pendingMergeA && _pendingMergeB) {
      const merged = faceSelector.merge(_pendingMergeA, _pendingMergeB);
      selectByHit(merged);
    }
    _pendingMergeA = _pendingMergeB = null;
    mergePrompt.remove();
    mergePrompt = null;
  };

  mergePrompt.querySelector('#merge-no').onclick = () => {
    _pendingMergeA = _pendingMergeB = null;
    mergePrompt.remove();
    mergePrompt = null;
  };
}

// --- 面選択モード切替 ---
function setFaceMode(val) {
  faceModeActive = val;
  faceSelector.setActive(val);

  if (val) {
    // 通常選択を解除してtransformControlsを外す
    transformControls.detach();
    clearHighlight();
    selectedRoot = null;
    selectedBone = null;
    syncUI();
    syncCoordUI();
    faceSelector.reset();
    faceModeBtn.style.background = '#ff4400';
    faceModeBtn.innerText = '🔴 面選択中\nキャンセル';
  } else {
    faceSelector.reset();
    faceModeBtn.style.background = '#2f2f2f';
    faceModeBtn.innerText = '🔷 面選択\nモード';
  }
  updateDockBtn();
}

function updateDockBtn() {
  if (!dockBtn) return;
  const ready = faceSelector.selections.length >= 2;
  dockBtn.disabled = !ready;
  dockBtn.style.opacity = ready ? '1' : '0.4';
  dockBtn.style.background = ready ? '#00aa44' : '#2f2f2f';
  if (ready) {
    dockBtn.innerText = '🔗 ドッキング\n実行';
  } else {
    const n = faceSelector.selections.length;
    dockBtn.innerText = `🔗 ドッキング\n(${n}/2面選択)`;
  }
}

// --- UI ---
const ui = document.createElement('div');
ui.id = 'synapse-toolbox';
ui.style.cssText = [
  'position:fixed', 'top:90px', 'right:10px', 'width:280px',
  'background:rgba(0,0,0,0.88)', 'border:1px solid #3c3c3c',
  'border-radius:14px', 'color:#fff', 'z-index:9999',
  'box-shadow:0 8px 28px rgba(0,0,0,0.45)', 'user-select:none'
].join(';');
document.body.appendChild(ui);

// Coordinate UI
(() => {
  coordUI = document.createElement('div');
  coordUI.id = 'synapse-coords';
  coordUI.style.cssText = [
    'position:fixed', 'top:10px', 'right:10px', 'width:240px',
    'background:rgba(0,0,0,0.72)', 'border:1px solid rgba(255,255,255,0.12)',
    'border-radius:12px', 'color:#fff', 'z-index:9999',
    'padding:10px 12px', 'backdrop-filter: blur(6px)',
    'box-shadow:0 8px 24px rgba(0,0,0,0.35)'
  ].join(';');

  const title = document.createElement('div');
  title.style.cssText = 'display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;cursor:move;';

  const titleLabel = document.createElement('span');
  titleLabel.textContent = 'POS';
  titleLabel.style.cssText = 'font-weight:900;letter-spacing:0.6px;opacity:0.9;flex:1;';

  const posCollapseBtn = document.createElement('button');
  posCollapseBtn.textContent = '▼';
  posCollapseBtn.style.cssText = [
    'background:none', 'border:none', 'color:#aaa',
    'font-size:12px', 'cursor:pointer', 'padding:0 2px', 'line-height:1'
  ].join(';');

  let posCollapsed = false;
  posCollapseBtn.onclick = (e) => {
    e.stopPropagation();
    posCollapsed = !posCollapsed;
    posGrid.style.maxHeight = posCollapsed ? '0' : '200px';
    posGrid.style.opacity   = posCollapsed ? '0' : '1';
    posGrid.style.overflow  = 'hidden';
    posCollapseBtn.textContent = posCollapsed ? '▶' : '▼';
  };

  // POSパネルのドラッグ
  (() => {
    let dragging = false;
    let startX = 0, startY = 0, startLeft = 0, startTop = 0;
    title.addEventListener('mousedown', (e) => {
      if (e.target === posCollapseBtn) return;
      dragging = true;
      const rect = coordUI.getBoundingClientRect();
      startX = e.clientX; startY = e.clientY;
      startLeft = rect.left; startTop = rect.top;
      coordUI.style.right = 'auto';
      coordUI.style.left = rect.left + 'px';
      coordUI.style.top  = rect.top  + 'px';
      e.preventDefault();
    });
    window.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const w = coordUI.getBoundingClientRect().width;
      const h = coordUI.getBoundingClientRect().height;
      coordUI.style.left = clamp(startLeft + dx, 6, window.innerWidth  - w - 6) + 'px';
      coordUI.style.top  = clamp(startTop  + dy, 6, window.innerHeight - h - 6) + 'px';
    });
    window.addEventListener('mouseup', () => dragging = false);
  })();

  title.append(titleLabel, posCollapseBtn);
  const posGrid = document.createElement('div');
  posGrid.style.cssText = 'display:grid;grid-template-columns:18px 1fr;gap:8px 10px;align-items:center;transition:max-height 0.2s,opacity 0.2s;max-height:200px;overflow:hidden;';

  function lab(t) {
    const d = document.createElement('div');
    d.textContent = t;
    d.style.cssText = 'font-weight:900;opacity:0.85;';
    return d;
  }

  function numBox() {
    const n = document.createElement('input');
    n.type = 'number';
    n.step = '0.1';
    n.style.cssText = [
      'width:100%', 'background:rgba(255,255,255,0.08)',
      'border:1px solid rgba(255,255,255,0.12)', 'border-radius:8px',
      'color:white', 'padding:6px 8px', 'font-weight:800', 'outline:none'
    ].join(';');
    return n;
  }

  coordX = numBox(); coordY = numBox(); coordZ = numBox();
  posGrid.append(lab('X'), coordX, lab('Y'), coordY, lab('Z'), coordZ);
  coordUI.append(title, posGrid);
  document.body.appendChild(coordUI);

  function applyPos() {
    if (!selectedRoot || selectedBone) return;
    const x = parseFloat(coordX.value);
    const y = parseFloat(coordY.value);
    const z = parseFloat(coordZ.value);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return;
    coordUpdating = true;
    selectedRoot.position.set(x, y, z);
    clampToGround(selectedRoot);
    coordUpdating = false;
  }

  coordX.addEventListener('change', applyPos);
  coordY.addEventListener('change', applyPos);
  coordZ.addEventListener('change', applyPos);
})();

const header = document.createElement('div');
header.style.cssText = [
  'padding:10px 12px', 'font-weight:900', 'letter-spacing:1px',
  'opacity:0.9', 'cursor:pointer',
  'border-bottom:1px solid rgba(255,255,255,0.08)',
  'display:flex', 'justify-content:space-between', 'align-items:center'
].join(';');

const headerLabel = document.createElement('span');
headerLabel.textContent = 'TOOLS';
headerLabel.style.cssText = 'cursor:move;flex:1;';

const content = document.createElement('div');
content.style.cssText = [
  'padding:10px 12px',
  'display:flex', 'flex-direction:column', 'gap:10px',
  'overflow:hidden',
  'transition:max-height 0.25s ease, opacity 0.2s ease, padding 0.2s',
  'max-height:2000px',
].join(';');

const collapseBtn = document.createElement('button');
collapseBtn.textContent = '▼';
collapseBtn.style.cssText = [
  'background:none', 'border:none', 'color:#aaa',
  'font-size:13px', 'cursor:pointer', 'padding:0 2px',
  'line-height:1', 'transition:transform 0.2s'
].join(';');

let toolsCollapsed = false;
collapseBtn.onclick = (e) => {
  e.stopPropagation();
  toolsCollapsed = !toolsCollapsed;
  content.style.maxHeight = toolsCollapsed ? '0' : '2000px';
  content.style.opacity  = toolsCollapsed ? '0' : '1';
  content.style.padding  = toolsCollapsed ? '0 12px' : '10px 12px';
  collapseBtn.textContent = toolsCollapsed ? '▶' : '▼';
};

header.append(headerLabel, collapseBtn);
ui.appendChild(header);
ui.appendChild(content);

// Drag logic
(() => {
  let dragging = false;
  let startX = 0, startY = 0, startLeft = 0, startTop = 0;
  headerLabel.addEventListener('mousedown', (e) => {
    dragging = true;
    const rect = ui.getBoundingClientRect();
    startX = e.clientX; startY = e.clientY;
    startLeft = rect.left; startTop = rect.top;
    ui.style.left = rect.left + 'px'; ui.style.top = rect.top + 'px';
    ui.style.right = 'auto';
    e.preventDefault();
  });
  window.addEventListener('mousemove', (e) => {
    if (!dragging) return;
    const dx = e.clientX - startX; const dy = e.clientY - startY;
    const w = ui.getBoundingClientRect().width;
    const h = ui.getBoundingClientRect().height;
    const left = clamp(startLeft + dx, 6, window.innerWidth - w - 6);
    const top  = clamp(startTop + dy, 6, window.innerHeight - h - 6);
    ui.style.left = left + 'px'; ui.style.top = top + 'px';
  });
  window.addEventListener('mouseup', () => dragging = false);
})();

// オブジェクト追加ボタン行
const btnCol = document.createElement('div');
btnCol.style.cssText = 'display:flex;gap:8px;justify-content:space-between;';
content.appendChild(btnCol);

function makeBtn(label, onClick, bg = '#2f2f2f', parent = btnCol) {
  const b = document.createElement('button');
  b.innerText = label;
  b.onclick = onClick;
  b.style.cssText = [
    'flex:1', 'height:54px', 'cursor:pointer',
    `background:${bg}`, 'color:white', 'border:none',
    'border-radius:10px', 'font-weight:900', 'font-size:15px', 'line-height:1.05'
  ].join(';');
  parent.appendChild(b);
  return b;
}

makeBtn('🧍\n人型', () => { history.pushUndo(); const m = spawnMannequin(); scene.add(m); selectByHit(m); });
makeBtn('■', () => { history.pushUndo(); const s = createPrimitive('box', { w:40,h:40,d:40,r:0 }); scene.add(s); selectByHit(s); });
makeBtn('▲', () => { history.pushUndo(); const s = createPrimitive('prism', { w:40,h:40,d:40,r:0 }); scene.add(s); selectByHit(s); });
makeBtn('●', () => { history.pushUndo(); const s = createPrimitive('sphere', { w:40,h:40,d:40,r:0 }); scene.add(s); selectByHit(s); });
makeBtn('💾', exportSTL, '#007bff');

// JSON保存・読み込み・UNDOボタン行
const histCol = document.createElement('div');
histCol.style.cssText = 'display:flex;gap:8px;';
content.appendChild(histCol);

makeBtn('📋\nJSON保存', () => { history.saveJSON(); }, '#1a4a2a', histCol);
makeBtn('📂\nJSON読込', () => { history.loadJSON(() => { syncUI(); syncCoordUI(); }); }, '#1a2a4a', histCol);
makeBtn('↩\nUNDO', () => { history.undo(); syncUI(); syncCoordUI(); }, '#4a2a1a', histCol);

// --- 面選択 & ドッキング ボタン行 ---
const faceCol = document.createElement('div');
faceCol.style.cssText = 'display:flex;gap:8px;';
content.appendChild(faceCol);

// 区切り線
const sep = document.createElement('div');
sep.style.cssText = 'border-top:1px solid rgba(255,255,255,0.1);margin:0 -2px;';
content.insertBefore(sep, faceCol);

const faceModeBtn = makeBtn('🔷 面選択\nモード', () => {
  setFaceMode(!faceModeActive);
}, '#1a3a5c', faceCol);

const dockBtn = makeBtn('🔗 ドッキング\n(0/2面選択)', () => {
  faceSelector.dock();
}, '#2f2f2f', faceCol);
dockBtn.disabled = true;
dockBtn.style.opacity = '0.4';

// 面選択リセットボタン
const resetFaceBtn = makeBtn('↩\nリセット', () => {
  faceSelector.reset();
  updateDockBtn();
}, '#333', faceCol);
resetFaceBtn.style.flex = '0 0 48px';
resetFaceBtn.style.fontSize = '11px';

// Sliders
function sliderRow(label, cfg) {
  const row = document.createElement('div');
  row.style.cssText = 'display:grid;grid-template-columns:18px 1fr 64px;gap:10px;align-items:center;';
  const lab = document.createElement('div');
  lab.textContent = label;
  lab.style.cssText = 'width:18px;font-weight:900;opacity:0.85;';
  const input = document.createElement('input');
  input.type = 'range';
  input.min = String(cfg.min); input.max = String(cfg.max);
  input.step = String(cfg.step); input.value = String(cfg.value);
  input.style.cssText = 'width:100%;';
  const num = document.createElement('input');
  num.type = 'number';
  num.min = String(cfg.min); num.max = String(cfg.max);
  num.step = String(cfg.step); num.value = String(cfg.value);
  num.style.cssText = [
    'width:64px', 'background:rgba(255,255,255,0.08)',
    'border:1px solid rgba(255,255,255,0.12)', 'border-radius:8px',
    'color:white', 'padding:6px 6px', 'font-weight:800', 'outline:none'
  ].join(';');
  row.append(lab, input, num);
  content.appendChild(row);
  function set(v) {
    const vv = clamp(v, cfg.min, cfg.max);
    input.value = String(vv);
    num.value = String(Number(vv).toFixed(2));
    cfg.onChange?.(vv);
  }
  input.addEventListener('input', () => set(parseFloat(input.value)));
  num.addEventListener('change', () => set(parseFloat(num.value)));
  return { row, input, num,
    setEnabled(enabled) {
      input.disabled = !enabled; num.disabled = !enabled;
      row.style.opacity = enabled ? '1' : '0.35';
    },
    setValue(v){ set(v); }
  };
}

const rUI = sliderRow('R', { min:0, max:1, step:0.01, value:0, onChange:(v) => {
  const prim = isPrimitiveSelected() ? selectedRoot : null;
  if (!prim) return;
  const pType = prim.userData.primitiveType;
  if (pType !== 'box' && pType !== 'prism') return;
  prim.userData.size.r = v;
  rebuildPrimitiveGeometry(prim);
  clampToGround(prim);
}});

const xUI = sliderRow('X', { min:0.2, max:3.0, step:0.01, value:1, onChange:(v) => onXYZ('x', v) });
const yUI = sliderRow('Y', { min:0.2, max:3.0, step:0.01, value:1, onChange:(v) => onXYZ('y', v) });
const zUI = sliderRow('Z', { min:0.2, max:3.0, step:0.01, value:1, onChange:(v) => onXYZ('z', v) });

const sUI = sliderRow('S', { min:0.2, max:3.0, step:0.01, value:1, onChange:(v) => {
  if (!selectedRoot) return;
  selectedRoot.userData.scaleAll = v;
  selectedRoot.scale.setScalar(v);
  clampToGround(selectedRoot);
}});

function onXYZ(axis, v) {
  const prim = isPrimitiveSelected() ? selectedRoot : null;
  if (!prim) return;
  const pType = prim.userData.primitiveType;
  if (pType !== 'box' && pType !== 'diamond') return;
  prim.userData.scaleXYZ = prim.userData.scaleXYZ || { x: 1, y: 1, z: 1 };
  prim.userData.scaleXYZ[axis] = v;
  rebuildPrimitiveGeometry(prim);
  clampToGround(prim);
}

function syncUI() {
  const prim = isPrimitiveSelected() ? selectedRoot : null;
  const pType = prim?.userData?.primitiveType;
  const rEnabled = !!(prim && (pType === 'box' || pType === 'prism'));
  rUI.setEnabled(rEnabled);
  if (rEnabled) {
    rUI.setValue(clamp(prim.userData.size?.r ?? 0, 0, 1));
  } else { rUI.num.value = '-'; }

  const xyzEnabled = !!(prim && (pType === 'box' || pType === 'diamond'));
  xUI.setEnabled(xyzEnabled); yUI.setEnabled(xyzEnabled); zUI.setEnabled(xyzEnabled);
  if (xyzEnabled) {
    const sc = prim.userData.scaleXYZ || { x: 1, y: 1, z: 1 };
    xUI.setValue(isNumber(sc.x) ? sc.x : 1);
    yUI.setValue(isNumber(sc.y) ? sc.y : 1);
    zUI.setValue(isNumber(sc.z) ? sc.z : 1);
  } else { xUI.num.value = yUI.num.value = zUI.num.value = '-'; }

  const sEnabled = !!selectedRoot;
  sUI.setEnabled(sEnabled);
  if (sEnabled) {
    sUI.setValue(clamp(selectedRoot.userData?.scaleAll ?? selectedRoot.scale.x ?? 1, 0.2, 3.0));
  } else { sUI.num.value = '-'; }
}
syncUI();

function syncCoordUI() {
  if (!coordUI || !coordX || !coordY || !coordZ) return;
  const enabled = !!(selectedRoot && !selectedBone);
  coordUI.style.opacity = enabled ? '1' : '0.35';
  coordX.disabled = coordY.disabled = coordZ.disabled = !enabled;
  if (!enabled) { coordX.value = coordY.value = coordZ.value = ''; return; }
  if (coordUpdating) return;
  coordUpdating = true;
  coordX.value = String(Number(selectedRoot.position.x).toFixed(1));
  coordY.value = String(Number(selectedRoot.position.y).toFixed(1));
  coordZ.value = String(Number(selectedRoot.position.z).toFixed(1));
  coordUpdating = false;
}
syncCoordUI();

// --- events ---
window.addEventListener('mousedown', (e) => {
  if (faceModeActive) return; // 面選択モード中は通常クリック無効
  if (transformControls.dragging) return;
  if (e.target && (ui.contains(e.target) || (coordUI && coordUI.contains(e.target)))) return;

  const mouse = new THREE.Vector2((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1);
  const ray = new THREE.Raycaster();
  ray.setFromCamera(mouse, camera);
  const hits = ray.intersectObjects(scene.children, true);
  const hit = hits.find((h) => h.object?.isMesh && !h.object.parent?.isTransformControls);
  if (hit) selectByHit(hit.object);
});

window.addEventListener('keydown', (e) => {
  // Ctrl+Z でUNDO
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
    e.preventDefault();
    history.undo();
    syncUI();
    syncCoordUI();
    return;
  }

  // ESCで面選択モード解除
  if (e.key === 'Escape' && faceModeActive) {
    setFaceMode(false);
    return;
  }

  if ((e.key === 'Delete' || e.key === 'Backspace') && selectedRoot) {
    history.pushUndo();
    transformControls.detach();
    scene.remove(selectedRoot);
    selectedRoot = null; selectedBone = null;
    clearHighlight(); syncUI(); syncCoordUI();
    return;
  }

  if (!selectedRoot && !selectedBone) return;
  const step = (e.shiftKey ? -1 : 1) * 0.1;
  const target = selectedBone || selectedRoot;
  if (e.key === 'r') { history.pushUndo(); target.rotation.x += step; }
  if (e.key === 'e') { history.pushUndo(); target.rotation.y += step; }
});

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
});

function animate() {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
