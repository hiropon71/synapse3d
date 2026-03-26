import * as THREE from 'three';

/**
 * ダミー人型（ボーン階層＋見た目メッシュ＋関節球）
 * 重要：scene.addは呼ばず、必ずTHREE.Group(=Object3D)を返す
 */
export function createDummyMannequin() {
  const group = new THREE.Group();
  group.name = 'mannequin_root';

  const bones = {};

  // --- 1) Bones ---
  bones.pelvis = new THREE.Bone();
  bones.spine = new THREE.Bone();
  bones.neck = new THREE.Bone();
  bones.head = new THREE.Bone();

  bones.rShoulder = new THREE.Bone(); bones.lShoulder = new THREE.Bone();
  bones.rElbow = new THREE.Bone();    bones.lElbow = new THREE.Bone();
  bones.rWrist = new THREE.Bone();    bones.lWrist = new THREE.Bone();

  bones.rHip = new THREE.Bone();      bones.lHip = new THREE.Bone();
  bones.rKnee = new THREE.Bone();     bones.lKnee = new THREE.Bone();
  bones.rAnkle = new THREE.Bone();    bones.lAnkle = new THREE.Bone();

  // --- 2) Hierarchy ---
  bones.pelvis.add(bones.spine, bones.rHip, bones.lHip);
  bones.spine.add(bones.neck);
  bones.neck.add(bones.head, bones.rShoulder, bones.lShoulder);
  bones.rShoulder.add(bones.rElbow); bones.rElbow.add(bones.rWrist);
  bones.lShoulder.add(bones.lElbow); bones.lElbow.add(bones.lWrist);
  bones.rHip.add(bones.rKnee); bones.rKnee.add(bones.rAnkle);
  bones.lHip.add(bones.lKnee); bones.lKnee.add(bones.lAnkle);

  // --- 3) Default placement ---
  bones.pelvis.position.y = 120;
  bones.spine.position.y = 40;
  bones.neck.position.y = 35;
  bones.head.position.y = 15;

  bones.rShoulder.position.set(-20, 0, 0);
  bones.lShoulder.position.set( 20, 0, 0);
  bones.rElbow.position.y = -32;
  bones.lElbow.position.y = -32;
  bones.rWrist.position.y = -28;
  bones.lWrist.position.y = -28;

  // 股関節はpelvisの下端付近
  bones.rHip.position.set(-12, -15, 0);
  bones.lHip.position.set( 12, -15, 0);
  // 膝はrHipから太もも分だけ下
  bones.rKnee.position.y = -46;
  bones.lKnee.position.y = -46;
  // 足首は膝からすね分だけ下
  bones.rAnkle.position.y = -44;
  bones.lAnkle.position.y = -44;

  // --- 4) Visuals ---
  // jointOffset: 関節球をボーン付け根（y=0）に表示
  // limbOffset:  メッシュはy=0から下方向に伸びる
  const addLimb = (bone, size, color, name, jointRadius = 6) => {
    const [sx, sy, sz] = size;
    const geometry = new THREE.BoxGeometry(sx, sy, sz);
    geometry.translate(0, -sy / 2, 0);

    const mesh = new THREE.Mesh(
      geometry,
      new THREE.MeshLambertMaterial({ color })
    );
    mesh.name = `mesh_${name}`;
    mesh.userData.isMannequinPart = true;
    mesh.userData.originalColor = color;
    bone.add(mesh);

    // 関節球：ボーン付け根（y=0）に配置 → メッシュに埋まらず見える
    const jointGeo = new THREE.SphereGeometry(jointRadius, 16, 16);
    const jointMat = new THREE.MeshBasicMaterial({ color: 0xffffff });
    const jointMesh = new THREE.Mesh(jointGeo, jointMat);
    jointMesh.name = `joint_${name}`;
    jointMesh.userData.isJoint = true;
    jointMesh.userData.boneName = name;
    jointMesh.userData.boneRef = bone;
    jointMesh.userData.originalColor = 0xffffff;
    // y=0 がボーンの回転軸 = 関節の位置
    jointMesh.position.set(0, 0, 0);
    bone.add(jointMesh);
  };

  const colors = {
    pelvis: 0x888888,
    spine:  0xaaaaaa,
    head:   0xff00ff,
    rArm:   0xffaa00,
    lArm:   0x55ff00,
    rLeg:   0x00ffaa,
    lLeg:   0x0055ff,
  };

  addLimb(bones.pelvis,    [30, 15, 15], colors.pelvis, 'pelvis',    0);
  addLimb(bones.spine,     [25, 35, 12], colors.spine,  'spine',     5);
  addLimb(bones.head,      [18, 18, 18], colors.head,   'head',      5);

  addLimb(bones.rShoulder, [ 8, 30,  8], colors.rArm,   'rShoulder', 5);
  addLimb(bones.rElbow,    [ 7, 28,  7], colors.rArm,   'rElbow',    4);

  addLimb(bones.lShoulder, [ 8, 30,  8], colors.lArm,   'lShoulder', 5);
  addLimb(bones.lElbow,    [ 7, 28,  7], colors.lArm,   'lElbow',    4);

  // 股関節・膝は関節球を大きめにしてクリックしやすく
  addLimb(bones.rHip,      [12, 46, 12], colors.rLeg,   'rHip',      7);
  addLimb(bones.rKnee,     [10, 44, 10], colors.rLeg,   'rKnee',     6);
  addLimb(bones.rAnkle,    [ 9, 14,  9], colors.rLeg,   'rAnkle',    5);

  addLimb(bones.lHip,      [12, 46, 12], colors.lLeg,   'lHip',      7);
  addLimb(bones.lKnee,     [10, 44, 10], colors.lLeg,   'lKnee',     6);
  addLimb(bones.lAnkle,    [ 9, 14,  9], colors.lLeg,   'lAnkle',    5);

  // ルートをgroupに格納
  group.add(bones.pelvis);

  // 選択/操作用メタ
  group.userData = {
    type: 'mannequin',
    isSelectable: true,
    bones,
  };

  return group;
}
