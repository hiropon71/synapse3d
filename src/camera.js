import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export function createCamera(canvas) {
    const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 2000);
    camera.position.set(300, 300, 300);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = true; 
    controls.dampingFactor = 0.05;
    
    // ヒロさんの発見した「移動」をより快適に
    controls.screenSpacePanning = true; // 画面と平行に移動
    controls.minDistance = 50;          // 寄りすぎ防止
    controls.maxDistance = 1000;        // 離れすぎ防止

    return { camera, controls };
}