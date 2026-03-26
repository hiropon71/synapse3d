import * as THREE from 'three';

export function createGrid(scene) {
    // メングリッド (1000x1000の範囲、100px間隔の太線)
    const gridMajor = new THREE.GridHelper(1000, 10, 0x888888, 0x444444);
    scene.add(gridMajor);

    // サブグリッド (1000x1000の範囲、20px間隔の細線)
    const gridMinor = new THREE.GridHelper(1000, 50, 0x333333, 0x222222);
    gridMinor.position.y = -0.1; // 重なり防止
    scene.add(gridMinor);
    
    console.log("Grid added to scene");
}