import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { RoundedBoxGeometry } from "three/addons/geometries/RoundedBoxGeometry.js";

const asset = (path) => window.GRASP_ASSETS?.[path] ??
  new URL(path, new URL(import.meta.env.BASE_URL, document.baseURI)).href;
const material = (color, roughness = .68, metalness = 0) =>
  new THREE.MeshStandardMaterial({ color, roughness, metalness });

function solid(parent, geometry, surface, x, y, z) {
  const mesh = new THREE.Mesh(geometry, surface);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function box(parent, w, d, h, x, y, z, surface, radius = 0) {
  const geometry = radius ? new RoundedBoxGeometry(w, d, h, 2, radius) : new THREE.BoxGeometry(w, d, h);
  return solid(parent, geometry, surface, x, y, z);
}

function cylinder(parent, top, bottom, h, x, y, z, surface) {
  const geometry = new THREE.CylinderGeometry(top, bottom, h, 32).rotateX(Math.PI / 2);
  return solid(parent, geometry, surface, x, y, z);
}

function set(setup, transform) {
  setup.position.set(transform[0], transform[1], transform[2]);
  setup.quaternion.set(transform[4], transform[5], transform[6], transform[3]).normalize();
}

function buildKitchen(scene) {
  const counter = material(0x393d33, .92);
  const edge = material(0x30352c);
  const cabinet = material(0x475044);
  const grout = material(0x474b3f);
  const tileColors = [0x626c5b, 0x687160, 0x596455, 0x646b5d, 0x5a6557];
  const tiles = tileColors.map((color) => material(color, .85));
  const board = material(0x8e603c);
  const boardLine = material(0xae7b50);
  const rack = material(0x353b34, .45, .55);
  const cream = material(0xc6aa7d, .48);
  const clay = material(0xa96849, .62);
  const glass = material(0x717d60, .38);
  const lightWood = material(0xae7e50);

  box(scene, 5, 5, .04, 0, 0, -.61, grout);
  box(scene, 2.7, .06, 1.8, -.25, .53, .38, grout);
  for (let row = 0; row < 11; row++) {
    for (let col = 0; col < 18; col++) {
      const tile = box(scene, .147, .013, .071, -1.52 + col * .153 + (row % 2) * .076,
        .492, -.14 + row * .078, tiles[(row * 7 + col * 3) % tiles.length], .003);
      tile.castShadow = false;
    }
  }
  box(scene, 1.39, 1.02, .068, -.23, -.03, -.036, counter, .015);
  box(scene, 1.36, .98, .45, -.23, -.02, -.292, edge, .01);
  for (const x of [-.68, -.23, .22]) {
    box(scene, .423, .035, .401, x, -.517, -.29, cabinet, .007);
    box(scene, .145, .022, .013, x, -.546, -.13, rack, .004);
  }

  // The board surface sits below the simulated table plane at z = 0.
  box(scene, .53, .41, .014, .005, -.005, -.008, board, .008);
  for (let i = 0; i < 12; i++) {
    const line = box(scene, .514, .0007, .00025, .005, -.187 + i * .032, -.00092, boardLine);
    line.castShadow = false;
  }
  for (const x of [-.244, .255]) {
    const line = box(scene, .0012, .38, .00025, x, -.005, -.0009, boardLine);
    line.castShadow = false;
  }

  box(scene, 1.08, .16, .026, .25, .378, .464, lightWood, .005);
  for (const x of [-.18, .67]) box(scene, .023, .13, .15, x, .432, .389, rack, .002);
  for (const [x, h, surface] of [[-.15, .16, glass], [-.052, .101, clay], [.027, .122, cream]]) {
    cylinder(scene, .035, .036, h, x, .37, .48 + h / 2, surface);
    cylinder(scene, .036, .034, .014, x, .37, .485 + h, rack);
  }
  for (let i = 0; i < 4; i++) {
    cylinder(scene, .068 - i * .002, .063 - i * .002, .014, .38, .365, .485 + i * .014, cream);
  }
  cylinder(scene, .053, .032, .048, .35, .267, .023, clay);
  cylinder(scene, .046, .035, .004, .35, .267, .047, board);
  cylinder(scene, .029, .025, .14, .38, .377, .069, glass);
  cylinder(scene, .015, .018, .037, .38, .377, .156, glass);
  cylinder(scene, .016, .016, .016, .38, .377, .181, rack);
  cylinder(scene, .038, .033, .105, .22, .364, .051, cream);
  for (let i = 0; i < 3; i++) {
    const handle = cylinder(scene, .004, .004, .16, .197 + i * .022, .36, .135, lightWood);
    handle.rotation.y = -.18 + i * .18;
  }

  const warm = new THREE.MeshBasicMaterial({ color: 0xffcc8f });
  box(scene, .42, .018, .01, .068, .345, .446, warm, .004);
  const strip = new THREE.PointLight(0xffbb79, 5, 1.5, 2);
  strip.position.set(.10, .36, .398);
  scene.add(strip);
}

export async function createViewer(container, links) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x485044);
  scene.fog = new THREE.FogExp2(0x485044, .20);
  const camera = new THREE.PerspectiveCamera(38, 1, .02, 15);
  camera.up.set(0, 0, 1);

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.34;
  renderer.domElement.tabIndex = 0;
  renderer.domElement.setAttribute("aria-label", "3D 轨迹视图。拖动旋转，滚动缩放，方向键平移。");
  container.append(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.listenToKeyEvents(renderer.domElement);
  controls.enableDamping = true;
  controls.minDistance = .33;
  controls.maxDistance = 3;
  controls.maxPolarAngle = Math.PI * .52;
  const setCamera = (closeUp = false) => {
    if (closeUp) {
      camera.position.set(.38, -.58, .34);
      controls.target.set(-.025, 0, .135);
    } else {
      camera.position.set(.97, -1.36, .86);
      controls.target.set(-.18, .025, .215);
    }
    controls.update();
  };
  setCamera();

  scene.add(new THREE.HemisphereLight(0xf3e3c9, 0x636c64, 1.62));
  const key = new THREE.DirectionalLight(0xffecd5, 2.8);
  key.position.set(-.26, -.70, 1.28);
  key.target.position.set(-.22, 0, .05);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  Object.assign(key.shadow.camera, { left: -.95, right: .95, top: .8, bottom: -.8, near: .1, far: 4 });
  key.shadow.normalBias = .012;
  key.shadow.bias = -.00025;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xe7f1f7, 1.4);
  fill.position.set(.9, .17, .79);
  scene.add(fill);
  buildKitchen(scene);

  const groups = links.map(() => {
    const group = new THREE.Group();
    scene.add(group);
    return group;
  });
  const loader = new GLTFLoader();
  await Promise.all(links.map(async (link, i) => {
    const name = link.includes("finger") ? "finger" : link.replace("panda_", "");
    const model = await loader.loadAsync(asset("robot/" + name + ".glb"));
    if (link === "panda_rightfinger") model.scene.rotation.z = Math.PI;
    model.scene.traverse((mesh) => {
      if (!mesh.isMesh) return;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
    });
    groups[i].add(model.scene);
  }));

  const object = solid(scene, new RoundedBoxGeometry(1, 1, 1, 3, .055),
    material(0xeb9b48, .39), 0, 0, 0);
  const ring = solid(scene, new THREE.RingGeometry(.94, 1, 56),
    new THREE.MeshBasicMaterial({ color: 0xffc289, transparent: true, opacity: .68, side: THREE.DoubleSide }),
    0, 0, .0004);
  ring.castShadow = false;
  ring.receiveShadow = false;

  const resize = () => {
    const { clientWidth: width, clientHeight: height } = container;
    if (!width || !height) return;
    camera.aspect = width / height;
    camera.fov = width < height * 1.4 ? 46 : 38;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  const observer = new ResizeObserver(resize);
  observer.observe(container);
  resize();
  renderer.setAnimationLoop(() => {
    controls.update();
    renderer.render(scene, camera);
  });

  const nextPosition = new THREE.Vector3();
  const nextRotation = new THREE.Quaternion();
  return {
    setCamera,
    setWidth(width) {
      object.scale.setScalar(width / 1000);
      ring.scale.set(width * .00082, width * .00082, 1);
    },
    frame(current, next, alpha) {
      function apply(node, first, second) {
        set(node, first);
        if (alpha > 0) {
          node.position.lerp(nextPosition.set(second[0], second[1], second[2]), alpha);
          node.quaternion.slerp(nextRotation.set(second[4], second[5], second[6], second[3]).normalize(), alpha);
        }
      }
      apply(object, current.object, next.object);
      ring.position.x = object.position.x;
      ring.position.y = object.position.y;
      groups.forEach((group, i) => apply(group, current.robot[i], next.robot[i]));
    },
  };
}
