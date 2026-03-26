import * as THREE from 'three';

/**
 * FaceSelector.js
 * 面選択 & 面ドッキング機能
 * 
 * 使い方:
 *   const fs = new FaceSelector(scene, camera, renderer);
 *   fs.setActive(true);  // 面選択モード ON
 *   fs.onDock = (objA, objB) => { ... }; // ドッキング後コールバック
 */
export class FaceSelector {
  constructor(scene, camera, renderer) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer;

    this.active = false;         // 面選択モードON/OFF
    this.selections = [];        // [{mesh, faceIndex, normal, worldPos, helper}] 最大2件
    this.onDock = null;          // ドッキング後コールバック (objA, objB)

    this._highlightMat = new THREE.MeshBasicMaterial({
      color: 0xff4400,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.6,
      depthTest: false,
    });

    this._hoverHelper = null;    // hover中の面プレビュー
    this._raycaster = new THREE.Raycaster();

    this._onMouseMove = this._onMouseMove.bind(this);
    this._onClick = this._onClick.bind(this);
  }

  /** 面選択モードの有効/無効 */
  setActive(val) {
    this.active = val;
    if (val) {
      window.addEventListener('mousemove', this._onMouseMove);
      window.addEventListener('click', this._onClick);
    } else {
      window.removeEventListener('mousemove', this._onMouseMove);
      window.removeEventListener('click', this._onClick);
      this._removeHoverHelper();
    }
  }

  /** 選択をリセット */
  reset() {
    this.selections.forEach(s => {
      if (s.helper) this.scene.remove(s.helper);
    });
    this.selections = [];
    this._removeHoverHelper();
  }

  // ---- internal ----

  _getMouseNDC(e) {
    return new THREE.Vector2(
      (e.clientX / window.innerWidth) * 2 - 1,
      -(e.clientY / window.innerHeight) * 2 + 1
    );
  }

  _raycastFace(e) {
    const ndc = this._getMouseNDC(e);
    this._raycaster.setFromCamera(ndc, this.camera);
    const hits = this._raycaster.intersectObjects(this.scene.children, true);
    return hits.find(h =>
      h.object?.isMesh &&
      !h.object.userData?.isFaceHighlight &&
      h.face != null
    ) || null;
  }

  /**
   * クリックした三角形と同じ法線を持つ全三角形を取得（＝四角面グループ）
   * @returns { normal, worldCenter, triIndices, vertices[] }
   */
  _getLogicalFace(mesh, faceIndex) {
    const geo = mesh.geometry;
    const posAttr = geo.attributes.position;
    const THRESH = 0.999; // 法線の一致しきい値（ほぼ同じ方向）

    // クリックした三角形の法線（ローカル）
    const getNormal = (fi) => {
      let a, b, c;
      if (geo.index) {
        const idx = geo.index.array;
        a = new THREE.Vector3().fromBufferAttribute(posAttr, idx[fi * 3]);
        b = new THREE.Vector3().fromBufferAttribute(posAttr, idx[fi * 3 + 1]);
        c = new THREE.Vector3().fromBufferAttribute(posAttr, idx[fi * 3 + 2]);
      } else {
        a = new THREE.Vector3().fromBufferAttribute(posAttr, fi * 3);
        b = new THREE.Vector3().fromBufferAttribute(posAttr, fi * 3 + 1);
        c = new THREE.Vector3().fromBufferAttribute(posAttr, fi * 3 + 2);
      }
      const n = new THREE.Vector3();
      const ab = new THREE.Vector3().subVectors(b, a);
      const ac = new THREE.Vector3().subVectors(c, a);
      n.crossVectors(ab, ac).normalize();
      return { n, a, b, c };
    };

    const triCount = geo.index
      ? geo.index.count / 3
      : posAttr.count / 3;

    const { n: targetN } = getNormal(faceIndex);

    // 同じ法線を持つ三角形を全部集める
    const groupVerts = [];
    const uniqueVerts = new Map(); // 重複頂点除去用

    for (let fi = 0; fi < triCount; fi++) {
      const { n, a, b, c } = getNormal(fi);
      if (Math.abs(n.dot(targetN)) < THRESH) continue;

      [a, b, c].forEach(v => {
        const key = `${v.x.toFixed(4)},${v.y.toFixed(4)},${v.z.toFixed(4)}`;
        if (!uniqueVerts.has(key)) {
          uniqueVerts.set(key, v.clone());
        }
      });
      groupVerts.push(a, b, c);
    }

    // ワールド座標に変換
    const worldVerts = groupVerts.map(v => v.clone().applyMatrix4(mesh.matrixWorld));

    // 面中心（ワールド）
    const worldCenter = new THREE.Vector3();
    worldVerts.forEach(v => worldCenter.add(v));
    worldCenter.divideScalar(worldVerts.length);

    // ワールド法線
    const normalMatrix = new THREE.Matrix3().getNormalMatrix(mesh.matrixWorld);
    const worldNormal = targetN.clone().applyMatrix3(normalMatrix).normalize();

    return { worldNormal, worldCenter, worldVerts };
  }

  /**
   * 四角面ハイライトを生成（同法線の全三角形を塗る）
   */
  _makeFaceHighlight(hit, color = 0xff4400, opacity = 0.6) {
    if (!hit?.face) return null;

    const { worldVerts } = this._getLogicalFace(hit.object, hit.faceIndex);
    if (!worldVerts.length) return null;

    const positions = [];
    worldVerts.forEach(v => positions.push(v.x, v.y, v.z));

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    // 三角形インデックスを再構成
    const indices = [];
    for (let i = 0; i < positions.length / 3; i += 3) {
      indices.push(i, i + 1, i + 2);
    }
    geo.setIndex(indices);
    geo.computeVertexNormals();

    const mat = new THREE.MeshBasicMaterial({
      color,
      side: THREE.DoubleSide,
      transparent: true,
      opacity,
      depthTest: false,
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.userData.isFaceHighlight = true;
    this.scene.add(mesh);
    return mesh;
  }

  _removeHoverHelper() {
    if (this._hoverHelper) {
      this.scene.remove(this._hoverHelper);
      this._hoverHelper.geometry.dispose();
      this._hoverHelper = null;
    }
  }

  _onMouseMove(e) {
    if (!this.active) return;
    this._removeHoverHelper();
    const hit = this._raycastFace(e);
    if (!hit || !hit.face) return;
    this._hoverHelper = this._makeFaceHighlight(hit, 0x00ffcc, 0.35);
  }

  _onClick(e) {
    if (!this.active) return;
    if (e.target && e.target.tagName !== 'CANVAS') return;

    const hit = this._raycastFace(e);
    if (!hit || !hit.face) return;

    // 同じメッシュを2回選ばせない
    if (this.selections.length === 1 && this.selections[0].mesh === hit.object) return;

    // 四角面（論理面）を取得
    const { worldNormal, worldCenter } = this._getLogicalFace(hit.object, hit.faceIndex);

    const helper = this._makeFaceHighlight(hit, 0xff4400, 0.7);

    this.selections.push({
      mesh: hit.object,
      faceIndex: hit.faceIndex,
      normal: worldNormal,
      worldPos: worldCenter,
      helper,
    });

    console.log(`Face selected [${this.selections.length}]:`, worldNormal, worldCenter);

    if (this.selections.length === 2) {
      this._notifyReady();
    }
  }

  _notifyReady() {
    // ドッキングボタンを有効化するためにイベント発火
    const event = new CustomEvent('facesReady', { detail: { selections: this.selections } });
    window.dispatchEvent(event);
  }

  /**
   * ドッキング実行
   * selections[1] のオブジェクトを、selections[0] の面に貼り付ける
   */
  dock() {
    if (this.selections.length < 2) return;

    const [faceA, faceB] = this.selections;

    let rootB = faceB.mesh;
    while (rootB && !rootB.userData?.isSelectable && rootB.parent) rootB = rootB.parent;
    if (!rootB?.userData?.isSelectable) return;

    let rootA = faceA.mesh;
    while (rootA && !rootA.userData?.isSelectable && rootA.parent) rootA = rootA.parent;

    // 1) faceBの法線をfaceAの法線と逆向きに合わせる
    const targetNormal = faceA.normal.clone().negate();
    const sourceNormal = faceB.normal.clone();
    const quaternion = new THREE.Quaternion().setFromUnitVectors(sourceNormal, targetNormal);
    rootB.quaternion.premultiply(quaternion);
    rootB.updateMatrixWorld(true);

    // 2) 回転後のfaceB四角面中心を再計算してfaceA中心に合わせる
    const { worldCenter: newCenterB } = this._getLogicalFace(faceB.mesh, faceB.faceIndex);
    const delta = new THREE.Vector3().subVectors(faceA.worldPos, newCenterB);
    rootB.position.add(delta);
    rootB.updateMatrixWorld(true);

    console.log('Docked!', rootA, rootB);

    if (this.onDock) this.onDock(rootA, rootB);
    this.reset();
  }

  /**
   * ジオメトリマージ実行
   * rootA と rootB のすべてのMeshをワールド座標で統合し、
   * 新しい単一Meshをシーンに追加。元のオブジェクトは削除。
   * @returns {THREE.Mesh} マージ済みの新しいMesh
   */
  merge(rootA, rootB) {
    // 両オブジェクト配下の全Meshをワールド座標に展開して収集
    const collectVertices = (root) => {
      const positions = [];
      root.updateMatrixWorld(true);
      root.traverse((child) => {
        if (!child.isMesh) return;
        if (child.userData?.isFaceHighlight) return;

        const geo = child.geometry;
        const posAttr = geo.attributes.position;
        child.updateMatrixWorld(true);

        const getVertex = (i) => {
          const v = new THREE.Vector3().fromBufferAttribute(posAttr, i);
          v.applyMatrix4(child.matrixWorld);
          return v;
        };

        if (geo.index) {
          const idx = geo.index.array;
          for (let i = 0; i < idx.length; i += 3) {
            const a = getVertex(idx[i]);
            const b = getVertex(idx[i + 1]);
            const c = getVertex(idx[i + 2]);
            positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
          }
        } else {
          for (let i = 0; i < posAttr.count; i++) {
            const v = getVertex(i);
            positions.push(v.x, v.y, v.z);
          }
        }
      });
      return positions;
    };

    const posA = collectVertices(rootA);
    const posB = collectVertices(rootB);
    const merged = new Float32Array([...posA, ...posB]);

    const mergedGeo = new THREE.BufferGeometry();
    mergedGeo.setAttribute('position', new THREE.BufferAttribute(merged, 3));
    mergedGeo.computeVertexNormals();

    const mergedMesh = new THREE.Mesh(
      mergedGeo,
      new THREE.MeshLambertMaterial({ color: 0x00ff88 })
    );
    mergedMesh.userData = {
      type: 'primitive',
      isSelectable: true,
      originalColor: 0x00ff88,
      isMerged: true,
    };

    // 元オブジェクトを削除して新しいMeshをシーンに追加
    this.scene.remove(rootA);
    this.scene.remove(rootB);
    this.scene.add(mergedMesh);

    console.log('Merged!', mergedMesh);
    return mergedMesh;
  }
}
