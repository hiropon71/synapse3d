import { createDummyMannequin } from './mannequin.js';

export function spawnMannequin() {
  const mannequinGroup = createDummyMannequin();
  // traverse safety: group is Object3D
  mannequinGroup.traverse((child) => {
    if (child.isMesh) {
      child.userData.originalColor = child.material?.color?.getHex?.() ?? child.userData.originalColor;
    }
  });
  return mannequinGroup;
}
