import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Maximize2, Pause, Play, RotateCcw } from "lucide-react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { OBJLoader } from "three/examples/jsm/loaders/OBJLoader.js";
import { buildApiUrl, getAuthHeaders } from "@/services/api";

export interface PhysicsKeyframe {
  step: number;
  time: number;
  phase: string;
  joint_positions: number[];
  link_positions?: number[][];
  end_effector: number[];
  object_position: number[];
}

interface PhysicsEvidence {
  kind?: string;
  engine?: { name?: string; version?: string; time_step_seconds?: number };
  playback?: { keyframe_count?: number; keyframes?: PhysicsKeyframe[] };
  rendered_frames?: { count?: number; renderer?: string };
  input?: { point_count?: number };
  scene?: { mesh?: { faces?: number; voxel_count?: number } };
  navigation?: { path_length_m?: number; waypoints?: number[][] };
}

interface PhysicsSimulationViewportProps {
  sceneId: string;
  runId?: string;
  status: string;
  robotModel?: string;
  evidence?: PhysicsEvidence;
  pose?: { x: number; y: number; heading: number; trustworthy?: boolean };
}

interface SceneHandles {
  scene: THREE.Scene;
  renderer: THREE.WebGLRenderer;
  camera: THREE.PerspectiveCamera;
  controls: OrbitControls;
  armRoot: THREE.Group;
  linkSegments: THREE.Mesh[];
  linkMarkers: THREE.Mesh[];
  object: THREE.Mesh;
  mobileRobot: THREE.Group;
  path: THREE.Line;
  retailMesh?: THREE.Group;
  resizeObserver: ResizeObserver;
  animationFrame: number;
}

const phaseLabel: Record<string, string> = {
  approach: "接近",
  pre_grasp: "预抓取",
  grasp: "闭合夹爪",
  lift: "提升",
  transfer: "搬运",
  place: "放置",
  release: "释放",
  retreat: "撤离",
};

const bulletPoint = (point: number[]) => new THREE.Vector3(
  (Number(point?.[0] || 0) - 0.0) * 3.6,
  1.07 + Number(point?.[2] || 0) * 3.6,
  -Number(point?.[1] || 0) * 3.6,
);

const retailPoint = (point: number[]) => new THREE.Vector3(
  Number(point?.[0] || 0) - 4,
  0.035,
  3 - Number(point?.[1] || 0),
);

const material = (color: number, metalness = 0.55, roughness = 0.34) =>
  new THREE.MeshStandardMaterial({ color, metalness, roughness });

const box = (
  scene: THREE.Object3D,
  size: [number, number, number],
  position: [number, number, number],
  color: number,
  options: { opacity?: number; metalness?: number } = {},
) => {
  const meshMaterial = material(color, options.metalness ?? 0.55, 0.38);
  if (options.opacity !== undefined) {
    meshMaterial.transparent = true;
    meshMaterial.opacity = options.opacity;
  }
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), meshMaterial);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);
  return mesh;
};

function addShelf(scene: THREE.Scene, x: number, z: number, labelColor: number) {
  const group = new THREE.Group();
  group.position.set(x, 0, z);
  const frame = material(0x334155, 0.8, 0.28);
  for (const side of [-1, 1]) {
    const upright = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.6, 0.08), frame);
    upright.position.set(side * 0.9, 1.3, 0);
    upright.castShadow = true;
    group.add(upright);
  }
  for (let level = 0; level < 4; level += 1) {
    const shelf = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.08, 0.72), frame);
    shelf.position.set(0, 0.35 + level * 0.68, 0);
    shelf.castShadow = true;
    group.add(shelf);
    for (let product = 0; product < 6; product += 1) {
      const item = new THREE.Mesh(
        new THREE.BoxGeometry(0.22, 0.34 + (product % 2) * 0.08, 0.22),
        material(product % 3 === 0 ? labelColor : 0x64748b, 0.15, 0.52),
      );
      item.position.set(-0.72 + product * 0.29, 0.58 + level * 0.68, 0);
      item.castShadow = true;
      group.add(item);
    }
  }
  scene.add(group);
}

function addIndustrialCell(scene: THREE.Scene) {
  box(scene, [5.4, 0.22, 3.8], [0.7, 0.92, 0], 0x263548, { metalness: 0.72 });
  box(scene, [5.8, 0.82, 0.12], [0.7, 0.43, -1.86], 0x111827);
  box(scene, [0.12, 0.82, 3.8], [-2.18, 0.43, 0], 0x111827);
  const target = new THREE.Mesh(
    new THREE.CylinderGeometry(0.25, 0.25, 0.018, 48),
    new THREE.MeshStandardMaterial({
      color: 0x22c55e,
      emissive: 0x052e16,
      emissiveIntensity: 1.5,
      transparent: true,
      opacity: 0.82,
    }),
  );
  const targetPoint = bulletPoint([0.43, 0.27, 0]);
  target.position.set(targetPoint.x, 1.055, targetPoint.z);
  scene.add(target);

  const rail = material(0x64748b, 0.82, 0.25);
  for (const x of [-2.35, 3.75]) {
    for (const z of [-2.05, 2.05]) {
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.08, 2.7, 0.08), rail);
      post.position.set(x, 1.35, z);
      scene.add(post);
    }
  }
  const scanner = box(scene, [0.44, 0.3, 0.24], [2.9, 2.45, -1.75], 0x0f766e);
  scanner.rotation.y = -0.4;
}

function createArm(scene: THREE.Scene) {
  const base = new THREE.Group();
  base.position.set(0, 1.08, 0);
  const pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(0.34, 0.42, 0.34, 40),
    material(0xcbd5e1, 0.78, 0.2),
  );
  pedestal.position.y = 0.17;
  pedestal.castShadow = true;
  base.add(pedestal);
  scene.add(base);

  let parent = base;
  const lengths = [0.42, 0.44, 0.41, 0.36, 0.32, 0.27, 0.22];
  lengths.forEach((length, index) => {
    const joint = new THREE.Group();
    joint.position.y = index === 0 ? 0.34 : lengths[index - 1];
    parent.add(joint);
    const collar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.15 - index * 0.008, 0.15 - index * 0.008, 0.18, 28),
      material(index % 2 ? 0x94a3b8 : 0xe2e8f0, 0.76, 0.22),
    );
    collar.rotation.x = index % 2 ? Math.PI / 2 : 0;
    collar.castShadow = true;
    joint.add(collar);
    const link = new THREE.Mesh(
      new THREE.BoxGeometry(0.17, length, 0.17),
      material(index === 3 ? 0x38bdf8 : 0xdbe4ee, 0.68, 0.24),
    );
    link.position.y = length / 2;
    link.castShadow = true;
    joint.add(link);
    parent = joint;
  });
  const tool = new THREE.Mesh(new THREE.BoxGeometry(0.24, 0.12, 0.24), material(0x0f172a));
  tool.position.y = lengths[lengths.length - 1] + 0.04;
  parent.add(tool);
  for (const z of [-0.11, 0.11]) {
    const finger = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.28, 0.05), material(0x111827));
    finger.position.set(0, lengths[lengths.length - 1] + 0.16, z);
    parent.add(finger);
  }
  return base;
}

function createTelemetryArm(scene: THREE.Scene) {
  const linkSegments: THREE.Mesh[] = [];
  const linkMarkers: THREE.Mesh[] = [];
  for (let index = 0; index < 10; index += 1) {
    const marker = new THREE.Mesh(
      new THREE.SphereGeometry(index === 9 ? 0.1 : 0.075, 24, 16),
      material(index === 9 ? 0x22d3ee : 0xdbe4ee, 0.65, 0.25),
    );
    marker.visible = false;
    marker.castShadow = true;
    scene.add(marker);
    linkMarkers.push(marker);
    if (index < 9) {
      const segment = new THREE.Mesh(
        new THREE.CylinderGeometry(0.065, 0.065, 1, 20),
        material(index === 4 ? 0x38bdf8 : 0x94a3b8, 0.72, 0.24),
      );
      segment.visible = false;
      segment.castShadow = true;
      scene.add(segment);
      linkSegments.push(segment);
    }
  }
  return { linkSegments, linkMarkers };
}

function createMobileRobot(scene: THREE.Scene) {
  const group = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.32, 0.72), material(0x2563eb));
  body.position.y = 0.34;
  body.castShadow = true;
  group.add(body);
  const lidar = new THREE.Mesh(new THREE.CylinderGeometry(0.13, 0.13, 0.12, 32), material(0x22d3ee));
  lidar.position.y = 0.58;
  group.add(lidar);
  for (const x of [-0.32, 0.32]) {
    for (const z of [-0.38, 0.38]) {
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.08, 24), material(0x020617));
      wheel.position.set(x, 0.18, z);
      wheel.rotation.x = Math.PI / 2;
      group.add(wheel);
    }
  }
  scene.add(group);
  return group;
}

export default function PhysicsSimulationViewport({
  sceneId,
  runId,
  status,
  robotModel,
  evidence,
  pose,
}: PhysicsSimulationViewportProps) {
  const mountRef = useRef<HTMLDivElement>(null);
  const handlesRef = useRef<SceneHandles | null>(null);
  const [playing, setPlaying] = useState(true);
  const [frameIndex, setFrameIndex] = useState(0);
  const [webglError, setWebglError] = useState<string | null>(null);
  const [cameraFrames, setCameraFrames] = useState<string[]>([]);
  const [retailPreview, setRetailPreview] = useState<string | null>(null);
  const [retailMeshState, setRetailMeshState] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const keyframes = useMemo(() => evidence?.playback?.keyframes || [], [evidence]);
  const retailWaypoints = useMemo(() => evidence?.navigation?.waypoints || [], [evidence]);
  const playbackLength = keyframes.length || retailWaypoints.length;
  const activeFrame = keyframes[Math.min(frameIndex, Math.max(0, keyframes.length - 1))];
  const activeRetailPoint = retailWaypoints[Math.min(frameIndex, Math.max(0, retailWaypoints.length - 1))];
  const cameraFrame = cameraFrames.length > 0
    ? cameraFrames[Math.min(
        cameraFrames.length - 1,
        Math.floor((frameIndex / Math.max(1, keyframes.length - 1)) * cameraFrames.length),
      )]
    : null;

  useEffect(() => {
    const count = Number(evidence?.rendered_frames?.count || 0);
    if (!runId || count <= 0) {
      setCameraFrames([]);
      return undefined;
    }
    let disposed = false;
    const objectUrls: string[] = [];
    void Promise.all(Array.from({ length: count }, async (_, index) => {
      const response = await fetch(
        buildApiUrl(`/simulation/runs/${encodeURIComponent(runId)}/frames/${index}`),
        { headers: getAuthHeaders() },
      );
      if (!response.ok) throw new Error(`物理渲染帧 ${index} 返回 ${response.status}`);
      const url = URL.createObjectURL(await response.blob());
      objectUrls[index] = url;
      return url;
    })).then((urls) => {
      if (!disposed) setCameraFrames(urls);
    }).catch((error) => {
      console.error("加载 Bullet 相机证据失败:", error);
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    });
    return () => {
      disposed = true;
      objectUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [evidence?.rendered_frames?.count, runId]);

  useEffect(() => {
    if (!playbackLength || !playing) return undefined;
    const timer = window.setInterval(() => {
      setFrameIndex((current) => (current + 1) % playbackLength);
    }, keyframes.length ? 42 : 240);
    return () => window.clearInterval(timer);
  }, [keyframes.length, playbackLength, playing]);

  useEffect(() => {
    setFrameIndex(0);
    setPlaying(true);
  }, [evidence?.playback, evidence?.navigation]);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch (error) {
      setWebglError(error instanceof Error ? error.message : "WebGL 初始化失败");
      return undefined;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.8));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.08;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x07101c);
    scene.fog = new THREE.FogExp2(0x07101c, 0.035);
    const camera = new THREE.PerspectiveCamera(46, 1, 0.05, 80);
    const isManipulator = sceneId === "manipulation-cell";
    const isRetailEvidence = evidence?.kind === "retail-digital-twin";
    camera.position.set(isManipulator ? 7.1 : 8.4, isManipulator ? 5.1 : 6.4, isManipulator ? 7.6 : 8.9);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.target.set(isManipulator ? 0.9 : 0, isManipulator ? 1.15 : 0.55, 0);
    controls.maxPolarAngle = Math.PI * 0.485;
    controls.minDistance = 3;
    controls.maxDistance = 22;

    scene.add(new THREE.HemisphereLight(0x9bd7ff, 0x172033, 2.15));
    const key = new THREE.DirectionalLight(0xffffff, 4.2);
    key.position.set(4.5, 8.5, 5.5);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.left = -8;
    key.shadow.camera.right = 8;
    key.shadow.camera.top = 8;
    key.shadow.camera.bottom = -8;
    scene.add(key);
    const rim = new THREE.PointLight(0x38bdf8, 22, 15);
    rim.position.set(-4, 3.5, -3);
    scene.add(rim);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(28, 28),
      new THREE.MeshStandardMaterial({ color: 0x0d1725, metalness: 0.2, roughness: 0.72 }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    const grid = new THREE.GridHelper(28, 56, 0x1d8db8, 0x20364a);
    grid.position.y = 0.006;
    scene.add(grid);

    let armRoot = new THREE.Group();
    let linkSegments: THREE.Mesh[] = [];
    let linkMarkers: THREE.Mesh[] = [];
    let object: THREE.Mesh;
    if (isManipulator) {
      addIndustrialCell(scene);
      armRoot = createArm(scene);
      ({ linkSegments, linkMarkers } = createTelemetryArm(scene));
      object = box(scene, [0.19, 0.19, 0.19], [2.1, 1.18, 0.05], 0x22d3ee, { metalness: 0.35 });
    } else if (!isRetailEvidence) {
      addShelf(scene, -3.1, -2.2, sceneId === "retail-store" ? 0xa855f7 : 0x2563eb);
      addShelf(scene, 0, -2.2, sceneId === "retail-store" ? 0xf97316 : 0x2563eb);
      addShelf(scene, 3.1, -2.2, sceneId === "retail-store" ? 0x22c55e : 0x2563eb);
      addShelf(scene, -3.1, 2.2, 0x2563eb);
      addShelf(scene, 0, 2.2, 0x2563eb);
      object = box(scene, [0.24, 0.24, 0.24], [0, 0.13, 0], 0x22d3ee);
      object.visible = false;
    } else {
      object = box(scene, [0.24, 0.24, 0.24], [0, 0.13, 0], 0x22d3ee);
      object.visible = false;
    }
    const mobileRobot = createMobileRobot(scene);
    mobileRobot.visible = !isManipulator;

    const pathGeometry = new THREE.BufferGeometry();
    const path = new THREE.Line(
      pathGeometry,
      new THREE.LineBasicMaterial({ color: 0x22d3ee, transparent: true, opacity: 0.9 }),
    );
    scene.add(path);

    const resizeObserver = new ResizeObserver(() => {
      const width = Math.max(1, mount.clientWidth);
      const height = Math.max(1, mount.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    });
    resizeObserver.observe(mount);

    let animationFrame = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      animationFrame = window.requestAnimationFrame(animate);
      if (handlesRef.current) handlesRef.current.animationFrame = animationFrame;
    };
    animate();
    handlesRef.current = {
      scene, renderer, camera, controls, armRoot, linkSegments, linkMarkers,
      object, mobileRobot, path, resizeObserver, animationFrame,
    };

    return () => {
      window.cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      controls.dispose();
      scene.traverse((child) => {
        if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
          child.geometry?.dispose();
          const mats = Array.isArray(child.material) ? child.material : [child.material];
          mats.forEach((item) => item?.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
      handlesRef.current = null;
    };
  }, [evidence?.kind, sceneId]);

  useEffect(() => {
    if (evidence?.kind !== "retail-digital-twin" || !runId) {
      setRetailPreview(null);
      setRetailMeshState("idle");
      return undefined;
    }
    const handles = handlesRef.current;
    if (!handles) return undefined;
    const abortController = new AbortController();
    let previewUrl: string | null = null;
    let meshGroup: THREE.Group | null = null;
    setRetailMeshState("loading");
    void Promise.all([
      fetch(buildApiUrl(`/simulation/runs/${encodeURIComponent(runId)}/scene-mesh`), {
        headers: getAuthHeaders(), signal: abortController.signal,
      }),
      fetch(buildApiUrl(`/simulation/runs/${encodeURIComponent(runId)}/preview`), {
        headers: getAuthHeaders(), signal: abortController.signal,
      }),
    ]).then(async ([meshResponse, previewResponse]) => {
      if (!meshResponse.ok) throw new Error(`场景 Mesh 返回 ${meshResponse.status}`);
      if (!previewResponse.ok) throw new Error(`占据栅格预览返回 ${previewResponse.status}`);
      const [meshText, previewBlob] = await Promise.all([
        meshResponse.text(),
        previewResponse.blob(),
      ]);
      if (abortController.signal.aborted) return;
      meshGroup = new OBJLoader().parse(meshText);
      const meshMaterial = new THREE.MeshStandardMaterial({
        color: 0x8da3b8,
        metalness: 0.18,
        roughness: 0.72,
        side: THREE.DoubleSide,
      });
      meshGroup.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          const previousMaterials = Array.isArray(child.material) ? child.material : [child.material];
          previousMaterials.forEach((item) => item?.dispose());
          child.material = meshMaterial;
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      meshGroup.position.set(-4, 0, 3);
      handles.scene.add(meshGroup);
      handles.retailMesh = meshGroup;
      previewUrl = URL.createObjectURL(previewBlob);
      setRetailPreview(previewUrl);
      setRetailMeshState("ready");
    }).catch((error) => {
      if (abortController.signal.aborted) return;
      console.error("加载便利店数字孪生证据失败:", error);
      setRetailMeshState("error");
    });
    return () => {
      abortController.abort();
      if (previewUrl) URL.revokeObjectURL(previewUrl);
      if (meshGroup) {
        handles.scene.remove(meshGroup);
        meshGroup.traverse((child) => {
          if (child instanceof THREE.Mesh) {
            child.geometry?.dispose();
            const mats = Array.isArray(child.material) ? child.material : [child.material];
            mats.forEach((item) => item?.dispose());
          }
        });
      }
      if (handles.retailMesh === meshGroup) handles.retailMesh = undefined;
    };
  }, [evidence?.kind, runId]);

  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles) return;
    const frame = activeFrame;
    if (frame) {
      const telemetryPoints = (frame.link_positions || []).map(bulletPoint);
      const hasLinkTelemetry = telemetryPoints.length >= 2;
      handles.armRoot.visible = !hasLinkTelemetry;
      handles.linkMarkers.forEach((marker, index) => {
        marker.visible = hasLinkTelemetry && index < telemetryPoints.length;
        if (marker.visible) marker.position.copy(telemetryPoints[index]);
      });
      handles.linkSegments.forEach((segment, index) => {
        const start = telemetryPoints[index];
        const end = telemetryPoints[index + 1];
        segment.visible = Boolean(start && end);
        if (!start || !end) return;
        const direction = new THREE.Vector3().subVectors(end, start);
        const length = direction.length();
        segment.position.copy(start).add(end).multiplyScalar(0.5);
        segment.scale.set(1, length, 1);
        segment.quaternion.setFromUnitVectors(
          new THREE.Vector3(0, 1, 0),
          direction.normalize(),
        );
      });
      handles.object.position.copy(bulletPoint(frame.object_position));
    } else if (handles.mobileRobot.visible && activeRetailPoint) {
      const point = retailPoint(activeRetailPoint);
      handles.mobileRobot.position.set(point.x, 0, point.z);
      const nextPoint = retailWaypoints[Math.min(frameIndex + 1, retailWaypoints.length - 1)];
      if (nextPoint) {
        handles.mobileRobot.rotation.y = -Math.atan2(
          Number(nextPoint[1]) - Number(activeRetailPoint[1]),
          Number(nextPoint[0]) - Number(activeRetailPoint[0]),
        );
      }
    } else if (handles.mobileRobot.visible && pose?.trustworthy === true) {
      handles.mobileRobot.position.set(Number(pose.x) - 2.4, 0, Number(pose.y));
      handles.mobileRobot.rotation.y = -Number(pose.heading || 0);
    }
  }, [activeFrame, activeRetailPoint, frameIndex, pose, retailWaypoints]);

  useEffect(() => {
    const handles = handlesRef.current;
    if (!handles) return;
    const points = keyframes.length
      ? keyframes.map((item) => bulletPoint(item.end_effector))
      : retailWaypoints.map(retailPoint);
    handles.path.geometry.dispose();
    handles.path.geometry = new THREE.BufferGeometry().setFromPoints(points);
    handles.path.visible = points.length > 1;
  }, [keyframes, retailWaypoints]);

  const resetCamera = () => {
    const handles = handlesRef.current;
    if (!handles) return;
    const isManipulator = sceneId === "manipulation-cell";
    handles.camera.position.set(isManipulator ? 7.1 : 8.4, isManipulator ? 5.1 : 6.4, isManipulator ? 7.6 : 8.9);
    handles.controls.target.set(isManipulator ? 0.9 : 0, isManipulator ? 1.15 : 0.55, 0);
    handles.controls.update();
  };

  const toggleFullscreen = () => {
    const element = mountRef.current?.parentElement;
    if (!element) return;
    if (document.fullscreenElement) void document.exitFullscreen();
    else void element.requestFullscreen();
  };

  const isRetailReplay = evidence?.kind === "retail-digital-twin" && retailWaypoints.length > 0;
  const engineLabel = isRetailReplay
    ? "PCD voxel mesh / inflated costmap / A*"
    : evidence?.engine?.name || "Telemetry viewer (no runtime data)";
  const isPhysicsReplay = evidence?.kind === "physics-simulation" && keyframes.length > 0;

  return (
    <div className="physics-viewport-shell">
      <div ref={mountRef} className="physics-viewport" aria-label="交互式三维仿真视口">
        {webglError && <div className="physics-webgl-error">无法创建 WebGL 视口：{webglError}</div>}
      </div>
      <div className="physics-viewport-topbar">
        <div className="physics-live-indicator">
          <span className={status === "running" ? "is-live" : ""} />
          {isRetailReplay
            ? `RETAIL DIGITAL TWIN · MESH ${retailMeshState.toUpperCase()}`
            : isPhysicsReplay
              ? "PHYSICS TELEMETRY REPLAY"
              : status === "running" ? "WAITING FOR CONTAINER EVIDENCE" : "NO RUNTIME TELEMETRY"}
        </div>
        <div className="physics-view-actions">
          <button onClick={resetCamera} title="重置相机"><Camera /></button>
          <button onClick={toggleFullscreen} title="全屏"><Maximize2 /></button>
        </div>
      </div>
      <div className="physics-engine-panel">
        <span>ENGINE</span><strong>{engineLabel}</strong>
        <small>{isRetailReplay ? `${evidence?.input?.point_count?.toLocaleString() || 0} points · ${evidence?.scene?.mesh?.faces?.toLocaleString() || 0} faces` : evidence?.engine?.version ? `v${evidence.engine.version}` : "interactive 3D"} · {robotModel || "ROBOT"}</small>
      </div>
      {cameraFrame && (
        <div className="physics-camera-evidence">
          <div><span /> BULLET CAMERA · {evidence?.rendered_frames?.renderer || "RENDERER"}</div>
          <img src={cameraFrame} alt="Bullet 容器实际渲染帧" />
        </div>
      )}
      {retailPreview && (
        <div className="physics-camera-evidence">
          <div><span /> POINT CLOUD → OCCUPANCY · A* EVIDENCE</div>
          <img src={retailPreview} alt="容器生成的便利店占据栅格与 A* 路径证据" />
        </div>
      )}
      <div className="physics-coordinate-panel">
        <span>X {activeRetailPoint?.[0]?.toFixed(2) ?? activeFrame?.end_effector?.[0]?.toFixed(3) ?? Number(pose?.x || 0).toFixed(2)}</span>
        <span>Y {activeRetailPoint?.[1]?.toFixed(2) ?? activeFrame?.end_effector?.[1]?.toFixed(3) ?? Number(pose?.y || 0).toFixed(2)}</span>
        <span>Z {activeFrame?.end_effector?.[2]?.toFixed(3) ?? "0.000"}</span>
      </div>
      {playbackLength > 0 && (
        <div className="physics-timeline">
          <button onClick={() => setPlaying((value) => !value)} aria-label={playing ? "暂停回放" : "播放回放"}>
            {playing ? <Pause /> : <Play />}
          </button>
          <button onClick={() => setFrameIndex(0)} aria-label="回到起点"><RotateCcw /></button>
          <span className="physics-phase">{isRetailReplay ? "A* 路径证据" : phaseLabel[activeFrame?.phase || ""] || activeFrame?.phase}</span>
          <input
            aria-label="物理轨迹时间轴"
            type="range"
            min={0}
            max={Math.max(0, playbackLength - 1)}
            value={frameIndex}
            onChange={(event) => { setPlaying(false); setFrameIndex(Number(event.target.value)); }}
          />
          <code>{isRetailReplay ? `${evidence?.navigation?.path_length_m?.toFixed(3) || "0.000"} m` : `${activeFrame?.time?.toFixed(3)} s`}</code>
          <span>{frameIndex + 1}/{playbackLength}</span>
        </div>
      )}
    </div>
  );
}
