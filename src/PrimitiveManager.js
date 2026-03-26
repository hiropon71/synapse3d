import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

function makeBox({ w, h, d, r }) {
  const seg = 2;
  const radius = clamp(r ?? 0, 0, 1) * Math.min(w, h, d) * 0.25;
  return new RoundedBoxGeometry(w, h, d, seg, Math.max(0.01, radius));
}

function makePrism({ w, h, d, r }) {
  // 三角柱→三角錐：r=0で柱、r=1で錐、途中は連続テーパー
  const bottomRadius = Math.max(w, d) * 0.5;
  const topRadius = bottomRadius * (1 - clamp(r ?? 0, 0, 1));
  return new THREE.CylinderGeometry(topRadius, bottomRadius, h, 3);
}

function makeSphere({ h }) {
  return new THREE.SphereGeometry(h / 2, 32, 32);
}

function makeDiamond({ w, h, d }) {
  const g = new THREE.BoxGeometry(w, h, d);
  return g;
}

export function createPrimitive(type, size) {
  const material = new THREE.MeshStandardMaterial({ color: 0x00ff88 });
  const { w = 40, h = 40, d = 40, r = 0 } = size || {};

  let geometry;
  if (type === 'box') geometry = makeBox({ w, h, d, r });
  else if (type === 'prism') geometry = makePrism({ w, h, d, r });
  else if (type === 'sphere') geometry = makeSphere({ h });
  else if (type === 'diamond') geometry = makeDiamond({ w, h, d });
  else geometry = makeBox({ w, h, d, r });

  const mesh = new THREE.Mesh(geometry, material);

  // 接地
  mesh.position.y = h / 2;

  if (type === 'diamond') {
    // ◆っぽく見えるように回転（ジオメトリ自体は箱）
    mesh.rotation.y = Math.PI / 4;
  }

  mesh.userData = {
    type: 'primitive',
    primitiveType: type,
    isSelectable: true,
    size: { w, h, d, r },
    originalColor: 0x00ff88,
    // 伸縮（長方形化）用
    scaleXYZ: { x: 1, y: 1, z: 1 },
  };

  return mesh;
}

export function rebuildPrimitiveGeometry(mesh) {
  if (!mesh?.isMesh || mesh.userData?.type !== 'primitive') return;
  const t = mesh.userData.primitiveType;
  const s = mesh.userData.size;
  const sc = mesh.userData.scaleXYZ || { x: 1, y: 1, z: 1 };

  const w = (s.w ?? 40) * (sc.x ?? 1);
  const h = (s.h ?? 40) * (sc.y ?? 1);
  const d = (s.d ?? 40) * (sc.z ?? 1);
  const r = s.r ?? 0;

  let newGeo;
  if (t === 'box') newGeo = makeBox({ w, h, d, r });
  else if (t === 'prism') newGeo = makePrism({ w, h, d, r });
  else if (t === 'sphere') newGeo = makeSphere({ h });
  else if (t === 'diamond') newGeo = makeDiamond({ w, h, d });
  else newGeo = makeBox({ w, h, d, r });

  mesh.geometry.dispose();
  mesh.geometry = newGeo;

  // 接地再調整（中心を上げる）
  mesh.position.y = h / 2;
}
