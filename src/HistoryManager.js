import * as THREE from 'three';
import { spawnMannequin } from './MannequinManager.js';
import { createPrimitive, rebuildPrimitiveGeometry } from './PrimitiveManager.js';

/**
 * HistoryManager.js
 * - UNDO（Ctrl+Z）
 * - 20分ごとの自動スナップショット（最大3世代=60分）
 * - JSONセーブ／ロード
 */
export class HistoryManager {
  constructor(scene) {
    this.scene = scene;
    this._undoStack = [];       // 手動UNDO用スタック（最大20件）
    this._snapshots = [];       // 自動スナップショット（最大3件）
    this._snapInterval = null;

    this.UNDO_MAX = 20;
    this.SNAP_MAX = 3;
    this.SNAP_INTERVAL_MS = 20 * 60 * 1000; // 20分
  }

  // ------------------------------------------------
  // UNDO
  // ------------------------------------------------

  /** 現在のシーン状態をUNDOスタックに積む（操作前に呼ぶ） */
  pushUndo() {
    const state = this._captureScene();
    this._undoStack.push(state);
    if (this._undoStack.length > this.UNDO_MAX) this._undoStack.shift();
  }

  /** 1つ前の状態に戻す */
  undo() {
    if (this._undoStack.length === 0) {
      console.log('[Undo] スタックが空です');
      return false;
    }
    const state = this._undoStack.pop();
    this._restoreScene(state);
    console.log(`[Undo] 復元完了（残り${this._undoStack.length}件）`);
    return true;
  }

  get canUndo() { return this._undoStack.length > 0; }

  // ------------------------------------------------
  // 自動スナップショット
  // ------------------------------------------------

  /** 自動スナップショットを開始 */
  startAutoSnapshot() {
    if (this._snapInterval) return;
    this._snapInterval = setInterval(() => {
      this._takeSnapshot();
    }, this.SNAP_INTERVAL_MS);
    console.log('[Snapshot] 自動スナップショット開始（20分ごと）');
  }

  stopAutoSnapshot() {
    if (this._snapInterval) {
      clearInterval(this._snapInterval);
      this._snapInterval = null;
    }
  }

  _takeSnapshot() {
    const state = this._captureScene();
    const ts = new Date().toLocaleTimeString('ja-JP');
    this._snapshots.push({ state, ts });
    if (this._snapshots.length > this.SNAP_MAX) this._snapshots.shift();
    console.log(`[Snapshot] 保存 ${ts}（${this._snapshots.length}/${this.SNAP_MAX}件）`);
    this._updateSnapUI();
  }

  /** スナップショットから復元 */
  restoreSnapshot(index) {
    const snap = this._snapshots[index];
    if (!snap) return;
    this._restoreScene(snap.state);
    console.log(`[Snapshot] 復元: ${snap.ts}`);
  }

  // ------------------------------------------------
  // JSON セーブ／ロード
  // ------------------------------------------------

  /** シーンをJSONファイルとして保存 */
  saveJSON(filename = 'synapse_scene.json') {
    const state = this._captureScene();
    const json = JSON.stringify(state, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = filename;
    link.click();
    console.log('[JSON] 保存:', filename);
  }

  /** JSONファイルを読み込んでシーンに復元 */
  loadJSON(onLoaded) {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const state = JSON.parse(ev.target.result);
          this._restoreScene(state);
          console.log('[JSON] 読み込み完了:', file.name);
          if (onLoaded) onLoaded();
        } catch (err) {
          console.error('[JSON] 読み込みエラー:', err);
          alert('JSONの読み込みに失敗しました。');
        }
      };
      reader.readAsText(file);
    };
    input.click();
  }

  // ------------------------------------------------
  // シーンのキャプチャ／リストア
  // ------------------------------------------------

  _captureScene() {
    const objects = [];
    this.scene.traverse((obj) => {
      if (!obj.userData?.isSelectable) return;
      if (obj.userData?.isFaceHighlight) return;

      const type = obj.userData.type;

      if (type === 'primitive' || type === 'merged' || obj.userData.isMerged) {
        objects.push({
          kind: 'primitive',
          primitiveType: obj.userData.primitiveType || 'merged',
          isMerged: !!obj.userData.isMerged,
          position: obj.position.toArray(),
          rotation: obj.rotation.toArray(),
          scale: obj.scale.toArray(),
          color: obj.material?.color?.getHex?.() ?? 0x00ff88,
          size: obj.userData.size ? { ...obj.userData.size } : null,
          scaleXYZ: obj.userData.scaleXYZ ? { ...obj.userData.scaleXYZ } : null,
          scaleAll: obj.userData.scaleAll ?? 1,
          // マージ済みはジオメトリを頂点データで保存
          geometry: obj.userData.isMerged ? this._serializeGeometry(obj.geometry) : null,
        });
      } else if (type === 'mannequin') {
        const bones = obj.userData.bones;
        const boneData = {};
        if (bones) {
          Object.entries(bones).forEach(([name, bone]) => {
            boneData[name] = {
              rotation: bone.rotation.toArray(),
              position: bone.position.toArray(),
            };
          });
        }
        objects.push({
          kind: 'mannequin',
          position: obj.position.toArray(),
          rotation: obj.rotation.toArray(),
          scale: obj.scale.toArray(),
          scaleAll: obj.userData.scaleAll ?? 1,
          bones: boneData,
        });
      }
    });
    return { objects };
  }

  _serializeGeometry(geo) {
    const pos = geo.attributes.position;
    return { positions: Array.from(pos.array) };
  }

  _deserializeGeometry(data) {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(data.positions, 3));
    geo.computeVertexNormals();
    return geo;
  }

  _restoreScene(state) {
    // 既存のselectable objectsを削除
    const toRemove = [];
    this.scene.traverse((obj) => {
      if (obj.userData?.isSelectable) toRemove.push(obj);
    });
    toRemove.forEach(obj => this.scene.remove(obj));

    // 復元
    state.objects.forEach((data) => {
      let obj = null;

      if (data.kind === 'primitive') {
        if (data.isMerged && data.geometry) {
          const geo = this._deserializeGeometry(data.geometry);
          obj = new THREE.Mesh(
            geo,
            new THREE.MeshLambertMaterial({ color: data.color ?? 0x00ff88 })
          );
          obj.userData = {
            type: 'primitive',
            isSelectable: true,
            originalColor: data.color ?? 0x00ff88,
            isMerged: true,
          };
        } else if (data.size) {
          obj = createPrimitive(data.primitiveType, data.size);
          if (data.scaleXYZ) {
            obj.userData.scaleXYZ = { ...data.scaleXYZ };
            rebuildPrimitiveGeometry(obj);
          }
          if (data.color) obj.material.color.setHex(data.color);
        }
      } else if (data.kind === 'mannequin') {
        obj = spawnMannequin();
        // ボーンの回転を復元
        if (data.bones && obj.userData.bones) {
          Object.entries(data.bones).forEach(([name, bd]) => {
            const bone = obj.userData.bones[name];
            if (!bone) return;
            bone.rotation.fromArray(bd.rotation);
            bone.position.fromArray(bd.position);
          });
        }
      }

      if (!obj) return;
      obj.position.fromArray(data.position);
      obj.rotation.fromArray(data.rotation);
      obj.scale.fromArray(data.scale);
      if (data.scaleAll != null) obj.userData.scaleAll = data.scaleAll;
      this.scene.add(obj);
    });

    console.log(`[Restore] ${state.objects.length}件復元`);
  }

  // ------------------------------------------------
  // スナップショットUI（画面左下に小さく表示）
  // ------------------------------------------------

  buildSnapUI() {
    const el = document.createElement('div');
    el.id = 'synapse-snapui';
    el.style.cssText = [
      'position:fixed', 'bottom:20px', 'right:20px',
      'background:rgba(0,0,0,0.75)',
      'border:1px solid #444',
      'border-radius:10px',
      'color:#aaa',
      'font-size:11px',
      'padding:8px 12px',
      'z-index:9998',
      'min-width:160px',
    ].join(';');
    el.innerHTML = '<div style="font-weight:900;margin-bottom:4px;color:#00ffcc;">📸 AUTO SNAPSHOT</div><div id="snap-list">まだありません</div>';
    document.body.appendChild(el);
    this._snapUIEl = el;
  }

  _updateSnapUI() {
    const list = document.getElementById('snap-list');
    if (!list) return;
    if (this._snapshots.length === 0) {
      list.innerHTML = 'まだありません';
      return;
    }
    list.innerHTML = this._snapshots.map((s, i) => `
      <div style="display:flex;align-items:center;gap:6px;margin:3px 0;">
        <span>${s.ts}</span>
        <button onclick="window._historyManager.restoreSnapshot(${i})"
          style="font-size:10px;padding:2px 6px;background:#333;color:#fff;border:none;border-radius:4px;cursor:pointer;">
          復元
        </button>
      </div>
    `).join('');
  }
}
