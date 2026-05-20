import * as THREE from 'https://unpkg.com/three@0.126.1/build/three.module.js';
import { OrbitControls } from 'https://unpkg.com/three@0.126.1/examples/jsm/controls/OrbitControls.js';
import { LineSegments2 } from 'https://unpkg.com/three@0.126.1/examples/jsm/lines/LineSegments2.js';
import { LineSegmentsGeometry } from 'https://unpkg.com/three@0.126.1/examples/jsm/lines/LineSegmentsGeometry.js';
import { LineMaterial } from 'https://unpkg.com/three@0.126.1/examples/jsm/lines/LineMaterial.js';

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x050505);
const mainAmbientLight = new THREE.AmbientLight(0xffffff, 1.05);
scene.add(mainAmbientLight);
const mainDirectionalLight = new THREE.DirectionalLight(0xffffff, 1.25);
mainDirectionalLight.position.set(60, 120, 80);
scene.add(mainDirectionalLight);

const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 20000);
camera.position.set(33.99486841881377, 94.14073978004035, 122.01132962984578);

const FIXED_VIEW = {
    enabled: true,
    camera: { x: 33.99486841881377, y: 94.14073978004035, z: 122.01132962984578 },
    target: { x: 0.8854043308959644, y: -19.413457958080834, z: 29.871459892240747 },
    fov: 60,
    near: 1.0,
    far: 50000.0
};

const LON_MIN = 110.0;
const LON_MAX = 160.0;
const LAT_MIN = 15.04;
const LAT_MAX = 60.0;

const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
document.getElementById('three-container').appendChild(renderer.domElement);

const raycaster = new THREE.Raycaster();
const pointer = new THREE.Vector2();
const sourceLonCenter = (LON_MIN + LON_MAX) * 0.5;
const sourceLatCenter = (LAT_MIN + LAT_MAX) * 0.5;
const sourceScale = 1.6;
const MAX_DISPLAY_DEPTH_M = 200.0;
const DEPTH_VIEW_SCALE = 0.18;
let pinnedProbe = null;
let pickPoints = null;
let pickPointRecords = [];

const probeOverlayEl = document.createElement('div');
probeOverlayEl.style.position = 'fixed';
probeOverlayEl.style.right = '16px';
probeOverlayEl.style.bottom = '16px';
probeOverlayEl.style.zIndex = '9999';
probeOverlayEl.style.minWidth = '270px';
probeOverlayEl.style.maxWidth = '380px';
probeOverlayEl.style.padding = '10px 12px';
probeOverlayEl.style.border = '1px solid rgba(255,255,255,0.25)';
probeOverlayEl.style.background = 'rgba(8,12,16,0.86)';
probeOverlayEl.style.color = '#eef4ff';
probeOverlayEl.style.font = '12px/1.45 monospace';
probeOverlayEl.style.whiteSpace = 'pre-line';
probeOverlayEl.style.pointerEvents = 'none';
probeOverlayEl.style.display = 'none';
document.body.appendChild(probeOverlayEl);

const miniMapContainer = document.getElementById('miniMapContainer');
const miniMapRenderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
miniMapRenderer.setPixelRatio(window.devicePixelRatio || 1);
miniMapRenderer.outputEncoding = THREE.sRGBEncoding;
miniMapRenderer.setSize(miniMapContainer.clientWidth, miniMapContainer.clientHeight);
miniMapContainer.appendChild(miniMapRenderer.domElement);
const miniMapScene = new THREE.Scene();
const miniMapCamera = new THREE.PerspectiveCamera(45, miniMapContainer.clientWidth / miniMapContainer.clientHeight, 0.1, 500);
miniMapCamera.position.set(0, -2, 70);
miniMapCamera.lookAt(0, 0, 0);
const miniMapRoot = new THREE.Group();
miniMapScene.add(miniMapRoot);
let miniMapRegionOutline = null;
const miniMapRadius = 22;
const miniMapLonCenter = (LON_MIN + LON_MAX) * 0.5;
const miniMapLatCenter = (LAT_MIN + LAT_MAX) * 0.5;
const miniMapAmbient = new THREE.AmbientLight(0xffffff, 0.9);
miniMapScene.add(miniMapAmbient);
const miniMapDirLight = new THREE.DirectionalLight(0xffffff, 0.9);
miniMapDirLight.position.set(30, 10, 40);
miniMapScene.add(miniMapDirLight);
const globe = new THREE.Mesh(
    new THREE.SphereGeometry(miniMapRadius, 48, 48),
    new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 1.0 })
);
miniMapRoot.add(globe);
const miniMapControls = new OrbitControls(miniMapCamera, miniMapRenderer.domElement);
miniMapControls.enableDamping = true;
miniMapControls.enablePan = false;
miniMapControls.minDistance = 36;
miniMapControls.maxDistance = 110;
miniMapControls.target.set(0, 0, 0);
miniMapControls.update();
const globeTextureLoader = new THREE.TextureLoader();
globeTextureLoader.setCrossOrigin('anonymous');

function buildBrightEarthTexture(sourceTexture) {
    sourceTexture.encoding = THREE.sRGBEncoding;
    sourceTexture.anisotropy = Math.min(8, miniMapRenderer.capabilities.getMaxAnisotropy());
    return sourceTexture;
}

globeTextureLoader.load(
    '/textures/earth.jpg',
    (texture) => {
        globe.material.map = buildBrightEarthTexture(texture);
        globe.material.needsUpdate = true;
    }
);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
window.camera = camera;
window.controls = controls;
window.dumpView = () => {};
const pointGroup = new THREE.Group();
scene.add(pointGroup);
const detailGroup = new THREE.Group();
scene.add(detailGroup);
const coastlineGroup = new THREE.Group();
scene.add(coastlineGroup);
const currentVectorGroup = new THREE.Group();
scene.add(currentVectorGroup);
const currentCubeGroup = new THREE.Group();
scene.add(currentCubeGroup);
let coastlineLoaded = false;
const tempLegendEl = document.getElementById('tempLegend');
const tempLegendStepsEl = document.getElementById('tempLegendSteps');
const legendResetBtn = document.getElementById('legendResetBtn');
const currentLegendEl = document.getElementById('currentLegend');
const currentLegendStepsEl = document.getElementById('currentLegendSteps');
const currentLegendResetBtn = document.getElementById('currentLegendResetBtn');
const currentDepthControlsEl = document.getElementById('currentDepthControls');
const currentDepthLabelEl = document.getElementById('currentDepthLabel');
const depthSliderEl = document.getElementById('depthSlider');
const LEGEND_STEP_COUNT = 10;
const FIXED_LEGEND_COLORS = [
    '#0d47ff',
    '#1578ff',
    '#1fa8f5',
    '#4dc7e8',
    '#a7dee8',
    '#f1e9c9',
    '#ffe15a',
    '#ffc21a',
    '#ff8a0a',
    '#ff3b0a'
];
let legendBins = [];
let lastLegendMin = 0;
let lastLegendMax = 1;
let selectedBinIndexes = new Set();
let currentType = 'temp';
let currentMode = 'temp';
let depthValues = [];
let currentDepthIdx = 0;
let currentTimeIdx = 0;
let fixedAxisBounds = null;
let selectedCurrentStepIndexes = new Set();
let currentClipX = 99999.0;
let currentVectorStride = 5;
let isCurrentVectorLoading = false;
let queuedCurrentVectorStride = null;
let currentCubeStride = 5;
let isCubeLoading = false;
let queuedCubeStride = null;
let detailPoints = null;
let detailPickPoints = null;
let detailPickPointRecords = [];
let detailRequestToken = 0;
let detailDebounceTimer = null;
let currentDataType = 'temp';
const BASE_CUBE_STRIDE = 3;
const CUBE_DEPTH_UNIT_M = 2.0;
const CUBE_STRIDE_LEVELS = [
    { maxDistance: 55, stride: 1 },
    { maxDistance: 85, stride: 2 }
];
const DETAIL_Z_OFFSET = 0.015;

const CURRENT_VECTOR_STRIDE_LEVELS = [
    { maxDistance: 50, stride: 2 },
    { maxDistance: 70, stride: 3 },
    { maxDistance: 90, stride: 4 }
];

const DETAIL_STRIDE_LEVELS = [
    { maxDistance: 110, stride: 5 },
    { maxDistance: 90, stride: 3 },
    { maxDistance: 70, stride: 2 },
    { maxDistance: 50, stride: 1 }
];

const axisGroup = new THREE.Group();
let lonAxisLine = null;
let depthAxisLine = null;
let latAxisLine = null;
scene.add(axisGroup);
let axisVisible = true;

function createAxisLine(start, end, color) {
    const geometry = new THREE.BufferGeometry().setFromPoints([start, end]);
    const material = new THREE.LineBasicMaterial({
        color,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.95
    });
    const line = new THREE.Line(geometry, material);
    line.renderOrder = 40;
    return line;
}

function createAxisBeam(start, end, color, thickness = 1.6) {
    const dx = end.x - start.x;
    const dy = end.y - start.y;
    const dz = end.z - start.z;

    let geometry;
    if (Math.abs(dx) > 0) {
        geometry = new THREE.BoxGeometry(Math.abs(dx), thickness, thickness);
    } else if (Math.abs(dy) > 0) {
        geometry = new THREE.BoxGeometry(thickness, Math.abs(dy), thickness);
    } else {
        geometry = new THREE.BoxGeometry(thickness, thickness, Math.abs(dz));
    }

    const material = new THREE.MeshBasicMaterial({
        color,
        depthTest: false,
        depthWrite: false,
        transparent: true,
        opacity: 0.98
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.renderOrder = 41;
    mesh.position.set(
        (start.x + end.x) * 0.5,
        (start.y + end.y) * 0.5,
        (start.z + end.z) * 0.5
    );
    return mesh;
}

function makeTextSprite(text, subText = '') {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    canvas.width = 148;
    canvas.height = subText ? 52 : 36;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#e9f1f8';
    ctx.font = '14px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    const mainY = subText ? 8 : 10;
    ctx.fillText(text, canvas.width / 2, mainY);
    if (subText) {
        ctx.fillStyle = '#b9c8d5';
        ctx.font = '10px sans-serif';
        ctx.fillText(subText, canvas.width / 2, 30);
    }

    const texture = new THREE.CanvasTexture(canvas);
    texture.needsUpdate = true;
    const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(material);
    sprite.renderOrder = 42;
    sprite.scale.set(subText ? 23 : 20, subText ? 8 : 6, 1);
    return sprite;
}

function fitCameraToPointGroup() {
    if (FIXED_VIEW.enabled) {
        camera.position.set(FIXED_VIEW.camera.x, FIXED_VIEW.camera.y, FIXED_VIEW.camera.z);
        controls.target.set(FIXED_VIEW.target.x, FIXED_VIEW.target.y, FIXED_VIEW.target.z);
        camera.fov = FIXED_VIEW.fov;
        camera.near = FIXED_VIEW.near;
        camera.far = FIXED_VIEW.far;
        camera.updateProjectionMatrix();
        controls.update();
        return;
    }

    const box = new THREE.Box3().setFromObject(pointGroup);
    if (box.isEmpty()) return;

    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());

    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    const fitHeightDistance = maxDim / (2 * Math.tan(fov / 2));
    const fitWidthDistance = fitHeightDistance / camera.aspect;
    const distance = 1.25 * Math.max(fitHeightDistance, fitWidthDistance);

    const dir = new THREE.Vector3(1, 0.75, 1).normalize();
    camera.position.copy(center).add(dir.multiplyScalar(distance));
    camera.near = Math.max(distance / 60, 0.8);
    camera.far = distance * 45;
    camera.updateProjectionMatrix();

    controls.target.copy(center);
    controls.maxDistance = distance * 4;
    controls.update();
}

function resetToInitialTempView() {
    camera.position.set(FIXED_VIEW.camera.x, FIXED_VIEW.camera.y, FIXED_VIEW.camera.z);
    controls.target.set(FIXED_VIEW.target.x, FIXED_VIEW.target.y, FIXED_VIEW.target.z);
    camera.fov = FIXED_VIEW.fov;
    camera.updateProjectionMatrix();
    controls.update();
}

function addTicks(axisStart, axisEnd, count, color, labels, subLabel = '') {
    const tickSize = 8;
    const dir = new THREE.Vector3().subVectors(axisEnd, axisStart);
    for (let i = 0; i <= count; i++) {
        const t = i / count;
        const p = new THREE.Vector3().copy(axisStart).addScaledVector(dir, t);

        let tickStart = p.clone();
        let tickEnd = p.clone();
        if (Math.abs(dir.x) > 0) {
            tickStart.z -= tickSize;
            tickEnd.z += tickSize;
        } else if (Math.abs(dir.z) > 0) {
            tickStart.x -= tickSize;
            tickEnd.x += tickSize;
        } else {
            tickStart.x -= tickSize;
            tickEnd.x += tickSize;
        }

        axisGroup.add(createAxisLine(tickStart, tickEnd, color));

        const label = makeTextSprite(labels[i], subLabel);
        label.position.copy(p);
        if (Math.abs(dir.x) > 0) {
            label.position.z += 10;
        } else if (Math.abs(dir.z) > 0) {
            label.position.x += 10;
        } else {
            label.position.x += 10;
        }
        axisGroup.add(label);
    }
}

function addDepthTicks(depthLen, color) {
    const tickSize = 6;
    const depthMarks = [];
    for (let d = 10; d <= MAX_DISPLAY_DEPTH_M; d += 10) depthMarks.push(d);
    const yMax = depthToY(MAX_DISPLAY_DEPTH_M);
    for (const depth of depthMarks) {
        const y = -depthLen * (depthToY(depth) / Math.max(yMax, 1e-6));

        const tickStart = new THREE.Vector3(-tickSize, y, 0);
        const tickEnd = new THREE.Vector3(tickSize, y, 0);
        axisGroup.add(createAxisLine(tickStart, tickEnd, color));

        const label = makeTextSprite(`${depth}m`);
        label.position.set(12, y, 0);
        axisGroup.add(label);
    }
}

function depthToY(depthM) {
    const d = Math.max(0, Number(depthM) || 0);
    return d * DEPTH_VIEW_SCALE;
}

function yToApproxDepth(yValue) {
    const yAbs = Math.max(0, -Number(yValue));
    return yAbs / DEPTH_VIEW_SCALE;
}

function snapYToDepthUnit(yValue, unitM = CUBE_DEPTH_UNIT_M) {
    const approxDepth = yToApproxDepth(yValue);
    const snappedDepth = Math.round(approxDepth / unitM) * unitM;
    return -depthToY(snappedDepth);
}

async function loadCoastlineOverlay() {
    if (coastlineLoaded) return;

    const res = await fetch('/api/coastline_3d');
    if (!res.ok) {
        const message = await res.text();
        throw new Error(message || `Coastline request failed: ${res.status}`);
    }

    const buffer = await res.arrayBuffer();
    const raw = new Float32Array(buffer);
    if (raw.length < 6) return;

    const geometry = new LineSegmentsGeometry();
    geometry.setPositions(raw);

    const material = new LineMaterial({
        color: 0x39ff14,
        transparent: true,
        opacity: 0.98,
        depthTest: false,
        linewidth: 2
    });
    material.resolution.set(window.innerWidth, window.innerHeight);

    const lines = new LineSegments2(geometry, material);
    lines.renderOrder = 20;
    coastlineGroup.add(lines);
    coastlineLoaded = true;
}

function updateCornerAxes(minX, maxX, minY, maxY, minZ, maxZ) {
    while (axisGroup.children.length > 0) {
        axisGroup.remove(axisGroup.children[0]);
    }

    axisGroup.position.set(maxX, 0, maxZ);

    const axisExtend = 1.08;
    const lonLen = Math.max(1, (maxX - minX) * axisExtend);
    const depthLen = Math.max(1, (-minY) * axisExtend);
    const latLen = Math.max(1, (maxZ - minZ) * axisExtend);

    const origin = new THREE.Vector3(0, 0, 0);
    lonAxisLine = createAxisBeam(
        origin,
        new THREE.Vector3(-lonLen, 0, 0),
        0xff4d4d,
        1.1
    );
    depthAxisLine = createAxisBeam(
        origin,
        new THREE.Vector3(0, -depthLen, 0),
        0x66ff66,
        1.1
    );
    latAxisLine = createAxisBeam(
        origin,
        new THREE.Vector3(0, 0, -latLen),
        0x4da6ff,
        1.1
    );

    axisGroup.add(lonAxisLine, depthAxisLine, latAxisLine);

    const tickCount = 5;
    const lonLabels = Array.from({ length: tickCount + 1 }, (_, i) => `${(LON_MAX - (LON_MAX - LON_MIN) * (i / tickCount)).toFixed(1)}E`);
    const latLabels = Array.from({ length: tickCount + 1 }, (_, i) => `${(LAT_MAX - (LAT_MAX - LAT_MIN) * (i / tickCount)).toFixed(1)}N`);
    addTicks(new THREE.Vector3(0, 0, 0), new THREE.Vector3(-lonLen, 0, 0), tickCount, 0xff4d4d, lonLabels);
    addTicks(new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, -latLen), tickCount, 0x4da6ff, latLabels);
    addDepthTicks(depthLen, 0x66ff66);

    const lonTitle = makeTextSprite('경도');
    lonTitle.position.set(-lonLen - 16, 0, 12);
    const latTitle = makeTextSprite('위도');
    latTitle.position.set(12, 0, -latLen - 16);
    axisGroup.add(lonTitle, latTitle);

    axisGroup.visible = axisVisible;
}

function applyFixedOrCurrentAxes(minX, maxX, minY, maxY, minZ, maxZ) {
    if (!fixedAxisBounds) {
        fixedAxisBounds = { minX, maxX, minY, maxY, minZ, maxZ };
    }
    const b = fixedAxisBounds || { minX, maxX, minY, maxY, minZ, maxZ };
    updateCornerAxes(b.minX, b.maxX, b.minY, b.maxY, b.minZ, b.maxZ);
}

const CHUNK_COUNT = 8;
const DATA_CUBE_SIZE = { x: 0.92, y: 0.78, z: 0.92 };
const paletteColors = FIXED_LEGEND_COLORS.map((hex) => new THREE.Color(hex));
const MAX_RENDER_POINTS = 6_000_000;

function computeMinPositiveStep(values, eps = 1e-6) {
    const uniq = Array.from(new Set(values.map((v) => Number(v.toFixed(5))))).sort((a, b) => a - b);
    let minStep = Number.POSITIVE_INFINITY;
    for (let i = 1; i < uniq.length; i++) {
        const d = uniq[i] - uniq[i - 1];
        if (d > eps && d < minStep) minStep = d;
    }
    return Number.isFinite(minStep) ? minStep : null;
}

function buildScaleLookup(values, fillRatio = 1.0, fallback = 1.0) {
    const uniq = Array.from(new Set(values.map((v) => Number(v.toFixed(5))))).sort((a, b) => a - b);
    const scaleMap = new Map();
    if (uniq.length === 0) return scaleMap;
    if (uniq.length === 1) {
        scaleMap.set(uniq[0], Math.max(0.12, fallback * fillRatio));
        return scaleMap;
    }
    for (let i = 0; i < uniq.length; i++) {
        const cur = uniq[i];
        const prev = i > 0 ? uniq[i - 1] : null;
        const next = i < uniq.length - 1 ? uniq[i + 1] : null;
        const left = prev == null ? null : (cur - prev);
        const right = next == null ? null : (next - cur);
        let step = fallback;
        if (left != null && right != null) step = (left + right) * 0.5;
        else if (left != null) step = left;
        else if (right != null) step = right;
        scaleMap.set(cur, Math.max(0.12, step * fillRatio));
    }
    return scaleMap;
}

function buildCoordScaleArray(coordValues, fillRatio = 1.02, fallback = 1.0) {
    const fallbackStep = Math.max(0.12, Number(fallback) || 1.0);
    if (!coordValues || coordValues.length === 0) return new Float32Array(0);
    const sortedUnique = Array.from(new Set(Array.from(coordValues).map((v) => Number(v.toFixed(5))))).sort((a, b) => a - b);
    if (sortedUnique.length === 0) return new Float32Array(coordValues.length).fill(fallbackStep);
    const localStepByCoord = new Map();
    for (let i = 0; i < sortedUnique.length; i++) {
        const cur = sortedUnique[i];
        const prev = i > 0 ? sortedUnique[i - 1] : null;
        const next = i < sortedUnique.length - 1 ? sortedUnique[i + 1] : null;
        let step = fallbackStep;
        if (prev != null && next != null) step = (next - prev) * 0.5;
        else if (next != null) step = next - cur;
        else if (prev != null) step = cur - prev;
        localStepByCoord.set(cur, Math.max(0.12, step * fillRatio));
    }
    const scales = new Float32Array(coordValues.length);
    for (let i = 0; i < coordValues.length; i++) {
        const key = Number(Number(coordValues[i]).toFixed(5));
        scales[i] = localStepByCoord.get(key) ?? fallbackStep;
    }
    return scales;
}

function detectRecordStride(rawData, candidateStrides = [7, 4]) {
    for (const stride of candidateStrides) {
        if (rawData.length % stride === 0) return stride;
    }
    return 4;
}

const cubeVertexShader = `
    attribute vec3 instanceOffset;
    attribute vec3 instanceScale;
    attribute float instanceValue;
    attribute float instanceVisible;
    uniform float minVal;
    uniform float maxVal;
    uniform vec3 palette[10];
    varying vec3 vColor;
    varying float vVisible;

    void main() {
        float range = max(maxVal - minVal, 0.000001);
        float t = clamp((instanceValue - minVal) / range, 0.0, 1.0);
        int binIdx = int(floor(t * 10.0));
        if (binIdx > 9) binIdx = 9;

        vec3 color = palette[0];
        for (int i = 0; i < 10; i++) {
            if (i == binIdx) color = palette[i];
        }
        vColor = color;
        vVisible = instanceVisible;

        vec3 worldPos = position * instanceScale + instanceOffset;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
    }
`;

const cubeFragmentShader = `
    varying vec3 vColor;
    varying float vVisible;
    void main() {
        if (vVisible < 0.5) discard;
        gl_FragColor = vec4(vColor, 1.0);
    }
`;

const cubeEdgeVertexShader = `
    attribute vec3 instanceOffset;
    attribute vec3 instanceScale;
    attribute float instanceVisible;
    varying float vVisible;

    void main() {
        vVisible = instanceVisible;
        vec3 worldPos = position * instanceScale + instanceOffset;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(worldPos, 1.0);
    }
`;

const cubeEdgeFragmentShader = `
    uniform vec3 edgeColor;
    varying float vVisible;
    void main() {
        if (vVisible < 0.5) discard;
        gl_FragColor = vec4(edgeColor, 0.55);
    }
`;

const cubeBaseGeometry = new THREE.BoxGeometry(1, 1, 1);
const cubeEdgeBaseGeometry = new THREE.EdgesGeometry(cubeBaseGeometry);
const cubeChunkPool = [];

function createCubeChunkSlot() {
    const geometry = new THREE.InstancedBufferGeometry();
    geometry.index = cubeBaseGeometry.index;
    geometry.attributes.position = cubeBaseGeometry.attributes.position;
    geometry.attributes.normal = cubeBaseGeometry.attributes.normal;
    geometry.attributes.uv = cubeBaseGeometry.attributes.uv;
    geometry.instanceCount = 0;

    const material = new THREE.ShaderMaterial({
        uniforms: {
            minVal: { value: 0.0 },
            maxVal: { value: 0.0 },
            palette: { value: paletteColors }
        },
        vertexShader: cubeVertexShader,
        fragmentShader: cubeFragmentShader,
        transparent: false,
        depthTest: true,
        depthWrite: true,
        polygonOffset: true,
        polygonOffsetFactor: 1,
        polygonOffsetUnits: 1,
        side: THREE.DoubleSide
    });

    const cubes = new THREE.Mesh(geometry, material);
    cubes.renderOrder = 1;
    cubes.frustumCulled = false;

    const edgeGeometry = new THREE.InstancedBufferGeometry();
    edgeGeometry.attributes.position = cubeEdgeBaseGeometry.attributes.position;
    edgeGeometry.instanceCount = 0;
    const edgeMaterial = new THREE.ShaderMaterial({
        uniforms: {
            edgeColor: { value: new THREE.Color(0xb0b0b0) }
        },
        vertexShader: cubeEdgeVertexShader,
        fragmentShader: cubeEdgeFragmentShader,
        transparent: true,
        depthTest: true,
        depthWrite: false,
        polygonOffset: true,
        polygonOffsetFactor: -1,
        polygonOffsetUnits: -1,
        side: THREE.DoubleSide
    });
    const cubeEdges = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    cubeEdges.renderOrder = 6;
    cubeEdges.frustumCulled = false;

    pointGroup.add(cubes);
    pointGroup.add(cubeEdges);

    const slot = {
        cubes,
        cubeEdges,
        geometry,
        edgeGeometry,
        capacity: 0,
        offsetsArray: new Float32Array(0),
        scalesArray: new Float32Array(0),
        valuesArray: new Float32Array(0),
        visibleArray: new Float32Array(0),
        offsetsAttr: null,
        scalesAttr: null,
        valuesAttr: null,
        visibleAttr: null
    };
    cubeChunkPool.push(slot);
    return slot;
}

function ensureCubeChunkSlot(index) {
    while (cubeChunkPool.length <= index) createCubeChunkSlot();
    return cubeChunkPool[index];
}

function ensureCubeSlotCapacity(slot, requiredCount) {
    if (requiredCount <= slot.capacity) return;
    slot.capacity = requiredCount;
    slot.offsetsArray = new Float32Array(slot.capacity * 3);
    slot.scalesArray = new Float32Array(slot.capacity * 3);
    slot.valuesArray = new Float32Array(slot.capacity);
    slot.visibleArray = new Float32Array(slot.capacity);
    slot.offsetsAttr = new THREE.InstancedBufferAttribute(slot.offsetsArray, 3);
    slot.scalesAttr = new THREE.InstancedBufferAttribute(slot.scalesArray, 3);
    slot.valuesAttr = new THREE.InstancedBufferAttribute(slot.valuesArray, 1);
    slot.visibleAttr = new THREE.InstancedBufferAttribute(slot.visibleArray, 1);
    slot.visibleAttr.setUsage(THREE.DynamicDrawUsage);
    slot.geometry.setAttribute('instanceOffset', slot.offsetsAttr);
    slot.geometry.setAttribute('instanceScale', slot.scalesAttr);
    slot.geometry.setAttribute('instanceValue', slot.valuesAttr);
    slot.geometry.setAttribute('instanceVisible', slot.visibleAttr);
    slot.edgeGeometry.setAttribute('instanceOffset', slot.offsetsAttr);
    slot.edgeGeometry.setAttribute('instanceScale', slot.scalesAttr);
    slot.edgeGeometry.setAttribute('instanceVisible', slot.visibleAttr);
}

function resolveLegendBin(value, minV, maxV) {
    const range = Math.max(maxV - minV, 0.000001);
    const t = Math.max(0.0, Math.min((value - minV) / range, 1.0));
    const scaled = Math.floor(t * LEGEND_STEP_COUNT);
    return Math.min(LEGEND_STEP_COUNT - 1, Math.max(0, scaled));
}

function updateCubeInstancesVisibility(mesh) {
    const positions = mesh.userData.instancePositions;
    const binIndexes = mesh.userData.binIndexes;
    const visibleAttr = mesh.userData.instanceVisibleAttr;
    const hasSelection = selectedBinIndexes.size > 0;
    let visibleCount = 0;

    for (let i = 0; i < binIndexes.length; i++) {
        const x = positions[i * 3];
        const selected = !hasSelection || selectedBinIndexes.has(binIndexes[i]);
        const unclipped = x <= currentClipX;
        const visible = selected && unclipped;
        if (visible) visibleCount += 1;
        visibleAttr.setX(i, visible ? 1.0 : 0.0);
    }
    visibleAttr.needsUpdate = true;
}

function applyLegendSelectionToPoints() {
    pointGroup.children.forEach((mesh) => {
        if (mesh.isMesh && mesh.userData.instanceVisibleAttr) {
            updateCubeInstancesVisibility(mesh);
        }
    });
}

function refreshLegendSelectionStyles() {
    const chips = tempLegendStepsEl.querySelectorAll('.temp-legend-chip');
    chips.forEach((chip) => {
        const idx = Number(chip.dataset.binIndex);
        chip.classList.toggle('selected', selectedBinIndexes.has(idx));
    });
}

function toggleLegendBin(binIndex) {
    if (selectedBinIndexes.has(binIndex)) {
        selectedBinIndexes.delete(binIndex);
    } else {
        selectedBinIndexes.add(binIndex);
    }
    refreshLegendSelectionStyles();
    applyLegendSelectionToPoints();
}

function clearLegendSelection() {
    selectedBinIndexes.clear();
    refreshLegendSelectionStyles();
    applyLegendSelectionToPoints();
}

function updateLegend(type, minV, maxV) {
    if (type !== 'temp' && type !== 'salt') {
        tempLegendEl.classList.add('hidden');
        return;
    }

    currentType = type;
    lastLegendMin = minV;
    lastLegendMax = maxV;
    selectedBinIndexes = new Set();
    legendBins = [];

    const titleEl = document.getElementById('tempLegendTitle');
    titleEl.textContent = type === 'temp' ? '수온 범례 (°C)' : '염분 범례 (psu)';

    tempLegendStepsEl.innerHTML = '';
    const stepSize = (maxV - minV) / LEGEND_STEP_COUNT;

    const startIdx = LEGEND_STEP_COUNT - 1;
    const endIdx = -1;
    const stepDir = -1;

    for (let i = startIdx; i !== endIdx; i += stepDir) {
        const start = minV + stepSize * i;
        const end = minV + stepSize * (i + 1);
        legendBins[i] = { start, end };

        const row = document.createElement('div');
        row.className = 'temp-legend-row';

        const chip = document.createElement('div');
        chip.className = 'temp-legend-chip';
        chip.dataset.binIndex = String(i);
        chip.style.backgroundColor = FIXED_LEGEND_COLORS[i];
        chip.addEventListener('click', () => toggleLegendBin(i));

        const label = document.createElement('span');
        label.className = 'temp-legend-chip-label';
        const unit = type === 'temp' ? '°C' : ' psu';
        label.textContent = `${start.toFixed(1)}~${end.toFixed(1)}${unit}`;

        chip.appendChild(label);
        row.appendChild(chip);
        tempLegendStepsEl.appendChild(row);
    }

    tempLegendEl.classList.remove('hidden');
    refreshLegendSelectionStyles();
}

function lonLatToSphere(lonDeg, latDeg, radius) {
    const lon = lonDeg * Math.PI / 180.0;
    const lat = latDeg * Math.PI / 180.0;
    const c = Math.cos(lat);
    return new THREE.Vector3(
        radius * c * Math.cos(lon),
        radius * Math.sin(lat),
        -radius * c * Math.sin(lon)
    );
}

function updateMiniMapRegionOutline() {
    if (miniMapRegionOutline) {
        miniMapRoot.remove(miniMapRegionOutline);
        miniMapRegionOutline.geometry.dispose();
        miniMapRegionOutline.material.dispose();
        miniMapRegionOutline = null;
    }

    const samplesPerEdge = 48;
    const edgeRadius = miniMapRadius + 0.9;
    const positions = [];
    const pushEdge = (lonA, latA, lonB, latB) => {
        let prev = lonLatToSphere(lonA, latA, edgeRadius);
        for (let i = 1; i <= samplesPerEdge; i++) {
            const t = i / samplesPerEdge;
            const lon = lonA + (lonB - lonA) * t;
            const lat = latA + (latB - latA) * t;
            const next = lonLatToSphere(lon, lat, edgeRadius);
            positions.push(prev.x, prev.y, prev.z, next.x, next.y, next.z);
            prev = next;
        }
    };

    pushEdge(LON_MIN, LAT_MIN, LON_MAX, LAT_MIN);
    pushEdge(LON_MAX, LAT_MIN, LON_MAX, LAT_MAX);
    pushEdge(LON_MAX, LAT_MAX, LON_MIN, LAT_MAX);
    pushEdge(LON_MIN, LAT_MAX, LON_MIN, LAT_MIN);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const material = new THREE.LineBasicMaterial({
        color: 0xff3b30,
        transparent: true,
        opacity: 1.0,
        depthTest: true,
        depthWrite: true
    });
    miniMapRegionOutline = new THREE.LineSegments(geometry, material);
    miniMapRoot.add(miniMapRegionOutline);

    const centerDir = lonLatToSphere(miniMapLonCenter, miniMapLatCenter, 1).normalize();
    miniMapRoot.quaternion.setFromUnitVectors(centerDir, new THREE.Vector3(0, 0, 1));
    const northAfterAlign = new THREE.Vector3(0, 1, 0).applyQuaternion(miniMapRoot.quaternion);
    const roll = Math.atan2(northAfterAlign.x, northAfterAlign.y);
    miniMapRoot.rotateZ(-roll);
}

function clearCurrentVectorScene() {
    while (currentVectorGroup.children.length > 0) {
        const child = currentVectorGroup.children[0];
        currentVectorGroup.remove(child);
        child.traverse?.((obj) => {
            if (obj.geometry) obj.geometry.dispose();
            if (obj.material) {
                if (Array.isArray(obj.material)) obj.material.forEach((m) => m.dispose?.());
                else obj.material.dispose?.();
            }
        });
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose?.();
    }
    while (currentCubeGroup.children.length > 0) {
        const child = currentCubeGroup.children[0];
        currentCubeGroup.remove(child);
        if (child.geometry) child.geometry.dispose();
        if (child.material) child.material.dispose();
    }
}

function hideCurrentControls() {
    currentDepthControlsEl.classList.add('hidden');
    currentLegendEl.classList.add('hidden');
}

function showCurrentControls() {
    currentDepthControlsEl.classList.remove('hidden');
    currentLegendEl.classList.remove('hidden');
}

function applyCurrentLegendSelectionStyles() {
    const chips = currentLegendStepsEl.querySelectorAll('.temp-legend-chip');
    chips.forEach((chip) => {
        const idx = Number(chip.dataset.stepIndex);
        chip.classList.toggle('selected', selectedCurrentStepIndexes.has(idx));
    });
}

function applyCurrentStepVisibility() {
    const hasSelection = selectedCurrentStepIndexes.size > 0;
    currentVectorGroup.children.forEach((obj) => {
        const stepIndex = obj.userData?.stepIndex;
        if (typeof stepIndex !== 'number') return;
        obj.visible = !hasSelection || selectedCurrentStepIndexes.has(stepIndex);
    });
}

function toggleCurrentLegendStep(stepIndex) {
    if (selectedCurrentStepIndexes.has(stepIndex)) selectedCurrentStepIndexes.delete(stepIndex);
    else selectedCurrentStepIndexes.add(stepIndex);
    applyCurrentLegendSelectionStyles();
    applyCurrentStepVisibility();
}

function clearCurrentLegendSelection() {
    selectedCurrentStepIndexes.clear();
    applyCurrentLegendSelectionStyles();
    applyCurrentStepVisibility();
}

function buildCurrentLegend(speedMin, speedMax) {
    currentLegendStepsEl.innerHTML = '';
    const stepCount = 10;
    const range = Math.max(speedMax - speedMin, 1e-6);
    const slowColor = new THREE.Color(0x2f2f2f);
    const fastColor = new THREE.Color(0xffffff);
    selectedCurrentStepIndexes = new Set();
    for (let i = stepCount - 1; i >= 0; i--) {
        const row = document.createElement('div');
        row.className = 'temp-legend-row';

        const chip = document.createElement('div');
        chip.className = 'temp-legend-chip';
        chip.dataset.stepIndex = String(i);
        const t = i / 9.0;
        const color = slowColor.clone().lerp(fastColor, t);
        chip.style.backgroundColor = `rgb(${Math.round(color.r * 255)}, ${Math.round(color.g * 255)}, ${Math.round(color.b * 255)})`;
        chip.addEventListener('click', () => toggleCurrentLegendStep(i));

        const label = document.createElement('span');
        label.className = 'temp-legend-chip-label';
        const low = speedMin + (range * i / stepCount);
        const high = speedMin + (range * (i + 1) / stepCount);
        label.textContent = `${low.toFixed(2)}~${high.toFixed(2)}`;

        chip.appendChild(label);
        row.appendChild(chip);
        currentLegendStepsEl.appendChild(row);
    }
    applyCurrentLegendSelectionStyles();
}

function getSpeedStepIndex(speed, minV, maxV) {
    const t = Math.max(0, Math.min(1, (speed - minV) / Math.max(maxV - minV, 1e-6)));
    const stretched = Math.log1p(9.0 * t) / Math.log(10.0);
    return Math.min(9, Math.floor(stretched * 10.0));
}

function currentSpeedColor(speed, minV, maxV) {
    const stepIndex = getSpeedStepIndex(speed, minV, maxV);
    const t = stepIndex / 9.0;
    const slow = new THREE.Color(0x2f2f2f);
    const fast = new THREE.Color(0xffffff);
    return slow.clone().lerp(fast, t);
}

function drawCurrentBoundingCube(minX, maxX, minY, maxY, minZ, maxZ) {
    const sx = Math.max(1, maxX - minX);
    const sy = Math.max(1, maxY - minY);
    const sz = Math.max(1, maxZ - minZ);
    const center = new THREE.Vector3((minX + maxX) * 0.5, (minY + maxY) * 0.5, (minZ + maxZ) * 0.5);

    const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(sx, sy, sz),
        new THREE.MeshBasicMaterial({
            color: 0x8ec9ff,
            transparent: true,
            opacity: 0.08,
            depthWrite: false
        })
    );
    mesh.position.copy(center);
    currentCubeGroup.add(mesh);

    const edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(sx, sy, sz)),
        new THREE.LineBasicMaterial({ color: 0xb7dbff, transparent: true, opacity: 0.55 })
    );
    edges.position.copy(center);
    currentCubeGroup.add(edges);
}

function isInsideBounds(x, y, z, b) {
    return (
        x >= b.minX && x <= b.maxX &&
        y >= b.minY && y <= b.maxY &&
        z >= b.minZ && z <= b.maxZ
    );
}

async function ensureOceanMeta() {
    if (depthValues.length > 0) return;
    const res = await fetch('/api/ocean_meta');
    if (!res.ok) throw new Error(`meta request failed: ${res.status}`);
    const meta = await res.json();
    depthValues = Array.isArray(meta.depth_values) ? meta.depth_values : [];
    const maxIdx = Math.max(0, depthValues.length - 1);
    depthSliderEl.min = '0';
    depthSliderEl.max = String(maxIdx);
    depthSliderEl.step = '1';
    depthSliderEl.value = String(Math.min(currentDepthIdx, maxIdx));
}

function updateDepthLabel() {
    const depthValue = depthValues[currentDepthIdx];
    if (Number.isFinite(depthValue)) {
        currentDepthLabelEl.textContent = `유속 수심: ${depthValue.toFixed(1)} m (index ${currentDepthIdx})`;
    } else {
        currentDepthLabelEl.textContent = `유속 수심 index: ${currentDepthIdx}`;
    }
}

async function loadCurrentVectors(depthIdx = currentDepthIdx, strideOverride = currentVectorStride) {
    const strideArg = Number(strideOverride);
    const stride = Number.isFinite(strideArg) ? Math.max(1, Math.round(strideArg)) : 5;

    if (isCurrentVectorLoading) {
        queuedCurrentVectorStride = stride;
        return;
    }
    isCurrentVectorLoading = true;
    try {
        await loadCoastlineOverlay();
        await ensureOceanMeta();

        currentDepthIdx = Math.max(0, Math.min(depthIdx, Math.max(0, depthValues.length - 1)));
        depthSliderEl.value = String(currentDepthIdx);
        updateDepthLabel();
        currentVectorStride = stride;

        const res = await fetch(`/api/current_vectors?time_idx=${currentTimeIdx}&depth_idx=${currentDepthIdx}&stride=${currentVectorStride}`);
        if (!res.ok) {
            const message = await res.text();
            throw new Error(message || `current_vectors request failed: ${res.status}`);
        }

        clearCurrentVectorScene();
        while (pointGroup.children.length > 0) pointGroup.remove(pointGroup.children[0]);
        pickPoints = null;
        pickPointRecords = [];
        clearDetailLayer();
        tempLegendEl.classList.add('hidden');
        showCurrentControls();
        currentMode = 'current';

        const buffer = await res.arrayBuffer();
        const header = new Float32Array(buffer, 0, 4);
        const speedMin = header[0];
        const speedMax = header[1];
        buildCurrentLegend(speedMin, speedMax);
        const recordCount = Math.max(0, Math.floor(header[2]));
        const records = new Float32Array(buffer, 16, recordCount * 6);

    const bounds = fixedAxisBounds || {
        minX: Number.NEGATIVE_INFINITY,
        maxX: Number.POSITIVE_INFINITY,
        minY: Number.NEGATIVE_INFINITY,
        maxY: Number.POSITIVE_INFINITY,
        minZ: Number.NEGATIVE_INFINITY,
        maxZ: Number.POSITIVE_INFINITY
    };

    const filtered = [];
    const fixedArrowLength = 0.75;
    for (let i = 0; i < recordCount; i++) {
        const idx = i * 6;
        const x = records[idx];
        const y = records[idx + 1];
        const z = records[idx + 2];
        const u = records[idx + 3];
        const v = records[idx + 4];
        const speed = records[idx + 5];
        const mag = Math.hypot(u, v);
        let dirX = 1.0;
        let dirZ = 0.0;
        if (mag > 1e-6) {
            dirX = u / mag;
            dirZ = -v / mag;
        }
        const stepIndex = getSpeedStepIndex(speed, speedMin, speedMax);
        const lengthScale = (1.0 / 3.0) + ((stepIndex / 9.0) * (1.0 / 3.0));
        const currentLength = fixedArrowLength * lengthScale;
        const tailBoost = 1.0 + (0.3 * (stepIndex / 9.0));
        const arrowLength = currentLength * tailBoost;
        const ex = x + (dirX * arrowLength);
        const ez = z + (dirZ * arrowLength);
        const ey = y;

        if (!isInsideBounds(x, y, z, bounds)) continue;
        if (!isInsideBounds(ex, ey, ez, bounds)) continue;
        filtered.push({ x, y, z, ex, ey, ez, speed, stepIndex });
    }

    const validCount = filtered.length;
    const bodyBinPositions = Array.from({ length: 10 }, () => []);
    const headBinPositions = Array.from({ length: 10 }, () => []);
    const headBinColors = Array.from({ length: 10 }, () => []);
    const dir = new THREE.Vector3();
    const head = new THREE.Vector3();
    const perp = new THREE.Vector3();
    const base = new THREE.Vector3();
    const left = new THREE.Vector3();
    const right = new THREE.Vector3();
    const headLength = 0.10;
    const headHalfWidth = 0.05;

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;

    for (let i = 0; i < validCount; i++) {
        const item = filtered[i];
        const x = item.x;
        const y = item.y;
        const z = item.z;
        const ex = item.ex;
        const ey = item.ey;
        const speed = item.speed;

        const stepIndex = item.stepIndex;
        bodyBinPositions[stepIndex].push(x, y, z, ex, y, ez);
        const color = currentSpeedColor(speed, speedMin, speedMax);

        dir.set(ex - x, 0, ez - z);
        if (dir.lengthSq() < 1e-6) dir.set(1, 0, 0);
        else dir.normalize();
        head.set(ex, y, ez);
        perp.set(-dir.z, 0, dir.x).normalize();
        base.copy(head).addScaledVector(dir, -headLength);
        left.copy(base).addScaledVector(perp, headHalfWidth);
        right.copy(base).addScaledVector(perp, -headHalfWidth);

        const hiPos = headBinPositions[stepIndex];
        const hiCol = headBinColors[stepIndex];
        // tip -> left
        hiPos.push(head.x, head.y, head.z, left.x, left.y, left.z);
        // tip -> right
        hiPos.push(head.x, head.y, head.z, right.x, right.y, right.z);

        hiCol.push(color.r, color.g, color.b, color.r, color.g, color.b);
        hiCol.push(color.r, color.g, color.b, color.r, color.g, color.b);

        minX = Math.min(minX, x, ex);
        maxX = Math.max(maxX, x, ex);
        minY = Math.min(minY, y);
        maxY = Math.max(maxY, y);
        minZ = Math.min(minZ, z, ez);
        maxZ = Math.max(maxZ, z, ez);
    }

    for (let i = 0; i < 10; i++) {
        const pos = bodyBinPositions[i];
        if (pos.length === 0) continue;
        const lineGeometry = new LineSegmentsGeometry();
        lineGeometry.setPositions(new Float32Array(pos));
        const t = i / 9.0;
        const slow = new THREE.Color(0x2f2f2f);
        const fast = new THREE.Color(0xffffff);
        const c = slow.clone().lerp(fast, t);
        const lineMaterial = new LineMaterial({
            color: c,
            transparent: true,
            opacity: 0.98,
            linewidth: 1.8,
            depthTest: true
        });
        lineMaterial.resolution.set(window.innerWidth, window.innerHeight);
        const lines = new LineSegments2(lineGeometry, lineMaterial);
        lines.userData.stepIndex = i;
        currentVectorGroup.add(lines);
    }

    for (let i = 0; i < 10; i++) {
        const pos = headBinPositions[i];
        if (pos.length === 0) continue;
        const col = headBinColors[i];
        const headGeometry = new LineSegmentsGeometry();
        headGeometry.setPositions(new Float32Array(pos));
        headGeometry.setColors(new Float32Array(col));
        const headMaterial = new LineMaterial({
            vertexColors: true,
            transparent: true,
            opacity: 0.98,
            linewidth: 1.8,
            depthTest: true
        });
        headMaterial.resolution.set(window.innerWidth, window.innerHeight);
        const headLines = new LineSegments2(headGeometry, headMaterial);
        headLines.userData.stepIndex = i;
        currentVectorGroup.add(headLines);
    }

    applyCurrentStepVisibility();

        if (fixedAxisBounds) {
            drawCurrentBoundingCube(
                fixedAxisBounds.minX,
                fixedAxisBounds.maxX,
                fixedAxisBounds.minY,
                fixedAxisBounds.maxY,
                fixedAxisBounds.minZ,
                fixedAxisBounds.maxZ
            );
        } else if (
            Number.isFinite(minX) && Number.isFinite(maxX) &&
            Number.isFinite(minY) && Number.isFinite(maxY) &&
            Number.isFinite(minZ) && Number.isFinite(maxZ)
        ) {
            drawCurrentBoundingCube(minX, maxX, minY, maxY, minZ, maxZ);
        }
    } finally {
        isCurrentVectorLoading = false;
        if (queuedCurrentVectorStride != null && queuedCurrentVectorStride !== currentVectorStride) {
            const nextStride = queuedCurrentVectorStride;
            queuedCurrentVectorStride = null;
            loadCurrentVectors(currentDepthIdx, nextStride).catch((err) => console.error(err));
        } else {
            queuedCurrentVectorStride = null;
        }
    }
}

function getCurrentVectorStrideByZoom() {
    const distance = camera.position.distanceTo(controls.target);
    for (const level of CURRENT_VECTOR_STRIDE_LEVELS) {
        if (distance <= level.maxDistance) return level.stride;
    }
    return 5;
}

function getCubeStrideByZoom() {
    const distance = camera.position.distanceTo(controls.target);
    const zoomBlock = distance >= 40 ? 5 : 4;
    return zoomBlock;
}

function getDetailStrideByZoom() {
    const distance = camera.position.distanceTo(controls.target);
    for (const level of DETAIL_STRIDE_LEVELS) {
        if (distance <= level.maxDistance) return level.stride;
    }
    return 0;
}

function modelToLonLat(x, y) {
    const lon = (x / sourceScale) + sourceLonCenter;
    const lat = sourceLatCenter - (y / sourceScale);
    return {
        lon,
        lat
    };
}

function clearDetailLayer() {
    if (detailPoints) {
        detailGroup.remove(detailPoints);
        detailPoints.geometry.dispose();
        detailPoints.material.dispose();
        detailPoints = null;
    }
    if (detailPickPoints) {
        detailGroup.remove(detailPickPoints);
        detailPickPoints.geometry.dispose();
        detailPickPoints.material.dispose();
        detailPickPoints = null;
    }
    detailPickPointRecords = [];
}

async function refreshDetailLayerByZoom(force = false) {
    if (currentMode !== 'temp' && currentMode !== 'salt') return;
    const stride = getDetailStrideByZoom();
    if (stride <= 0 || stride >= BASE_CUBE_STRIDE) {
        clearDetailLayer();
        return;
    }
    if (!force && currentCubeStride === stride) return;
    currentCubeStride = stride;

    if (detailDebounceTimer) clearTimeout(detailDebounceTimer);
    detailDebounceTimer = setTimeout(async () => {
        const token = ++detailRequestToken;
        const target = controls.target.clone();
        const { lon, lat } = modelToLonLat(target.x, target.z);
        const width = 8.0 * (stride + 1);
        const height = 6.0 * (stride + 1);
        const lonMin = Math.max(LON_MIN, lon - width * 0.5);
        const lonMax = Math.min(LON_MAX, lon + width * 0.5);
        const latMin = Math.max(LAT_MIN, lat - height * 0.5);
        const latMax = Math.min(LAT_MAX, lat + height * 0.5);
        const res = await fetch(
            `/api/ocean_3d_roi?type=${currentDataType}&time_idx=${currentTimeIdx}&stride=${stride}` +
            `&lon_min=${lonMin}&lon_max=${lonMax}&lat_min=${latMin}&lat_max=${latMax}`
        );
        if (!res.ok) return;
        const buffer = await res.arrayBuffer();
        if (token !== detailRequestToken) return;
        const rawData = new Float32Array(buffer, 8);
        if (rawData.length === 0) {
            clearDetailLayer();
            return;
        }

        const recordStride = detectRecordStride(rawData);
        const totalPoints = rawData.length / recordStride;
        const positions = new Float32Array(totalPoints * 3);
        const colors = new Float32Array(totalPoints * 3);
        detailPickPointRecords = new Array(totalPoints);
        for (let i = 0; i < totalPoints; i++) {
            const idx = i * recordStride;
            const x = rawData[idx];
            const y = rawData[idx + 1];
            const z = rawData[idx + 2];
            const v = rawData[idx + 3];
            positions[i * 3] = x;
            positions[i * 3 + 1] = y + DETAIL_Z_OFFSET;
            positions[i * 3 + 2] = z;
            const bin = resolveLegendBin(v, lastLegendMin, lastLegendMax);
            const color = new THREE.Color(FIXED_LEGEND_COLORS[bin]);
            colors[i * 3] = color.r;
            colors[i * 3 + 1] = color.g;
            colors[i * 3 + 2] = color.b;

            const geo = modelToLonLat(x, z);
            const approxDepthMeter = yToApproxDepth(y);
            let depthIdx = 0;
            if (depthValues.length > 0) {
                let best = Number.POSITIVE_INFINITY;
                for (let k = 0; k < depthValues.length; k++) {
                    const diff = Math.abs(depthValues[k] - approxDepthMeter);
                    if (diff < best) {
                        best = diff;
                        depthIdx = k;
                    }
                }
            }
            const depthMeter = Number.isFinite(depthValues[depthIdx]) ? depthValues[depthIdx] : approxDepthMeter;
            detailPickPointRecords[i] = { lon: geo.lon, lat: geo.lat, depthIdx, depthMeter, value: v };
        }

        clearDetailLayer();
        const geometry = new THREE.BufferGeometry();
        geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
        geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
        const material = new THREE.PointsMaterial({
            size: 0.42,
            sizeAttenuation: true,
            vertexColors: true,
            transparent: true,
            opacity: 0.95,
            depthTest: true,
            depthWrite: false
        });
        detailPoints = new THREE.Points(geometry, material);
        detailGroup.add(detailPoints);

        const pickGeometry = new THREE.BufferGeometry();
        pickGeometry.setAttribute('position', new THREE.BufferAttribute(positions.slice(), 3));
        const pickMaterial = new THREE.PointsMaterial({
            size: 0.9,
            sizeAttenuation: true,
            transparent: true,
            opacity: 0.0,
            depthTest: true,
            depthWrite: false
        });
        detailPickPoints = new THREE.Points(pickGeometry, pickMaterial);
        detailGroup.add(detailPickPoints);
    }, 120);
}

function buildProbeInfo(mesh, instanceId) {
    const positions = mesh?.userData?.instancePositions;
    const valuesAttr = mesh?.geometry?.getAttribute('instanceValue');
    if (!positions || !valuesAttr || instanceId == null || instanceId < 0) return null;
    if ((instanceId * 3 + 2) >= positions.length || instanceId >= valuesAttr.count) return null;

    const x = positions[instanceId * 3];
    const y = positions[instanceId * 3 + 1];
    const z = positions[instanceId * 3 + 2];
    const value = valuesAttr.array[instanceId];

    const geo = modelToLonLat(x, z);
    const lon = geo.lon;
    const lat = geo.lat;
    const approxDepthMeter = yToApproxDepth(y);
    let depthIdx = 0;
    if (depthValues.length > 0) {
        let best = Number.POSITIVE_INFINITY;
        for (let i = 0; i < depthValues.length; i++) {
            const diff = Math.abs(depthValues[i] - approxDepthMeter);
            if (diff < best) {
                best = diff;
                depthIdx = i;
            }
        }
    }
    const depthMeter = Number.isFinite(depthValues[depthIdx]) ? depthValues[depthIdx] : approxDepthMeter;
    const valueLabel = currentMode === 'salt' ? 'salinity(psu)' : 'temp(degC)';

    return {
        valueLabel,
        value,
        lon,
        lat,
        depthIdx,
        depthMeter
    };
}

function buildProbeInfoFromRecord(record) {
    if (!record) return null;
    const valueLabel = currentMode === 'salt' ? 'salinity(psu)' : 'temp(degC)';
    return {
        valueLabel,
        value: record.value,
        lon: record.lon,
        lat: record.lat,
        depthIdx: record.depthIdx,
        depthMeter: record.depthMeter
    };
}

function renderProbeInfo(info, pinned = false) {
    if (!info) {
        if (!pinnedProbe) probeOverlayEl.style.display = 'none';
        return;
    }
    const depthLine = info.depthMeter == null
        ? `depth_idx: ${info.depthIdx}`
        : `depth: ${info.depthMeter.toFixed(2)} m (idx ${info.depthIdx})`;
    const pinLine = pinned ? '[PINNED] click empty area to clear' : '[HOVER] click to pin';
    probeOverlayEl.textContent = [
        pinLine,
        `mode: ${currentMode}`,
        `lon: ${info.lon.toFixed(4)}`,
        `lat: ${info.lat.toFixed(4)}`,
        depthLine,
        `${info.valueLabel}: ${Number(info.value).toFixed(4)}`
    ].join('\n');
    probeOverlayEl.style.display = 'block';
}

function pickCubeInstance(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    pointer.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    pointer.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(pointer, camera);

    raycaster.params.Points.threshold = 0.9;
    const targets = [];
    if (detailPickPoints) targets.push({ points: detailPickPoints, records: detailPickPointRecords });
    if (pickPoints) targets.push({ points: pickPoints, records: pickPointRecords });
    for (const target of targets) {
        const hits = raycaster.intersectObject(target.points, false);
        if (!hits || hits.length === 0) continue;
        const hit = hits[0];
        if (!Number.isInteger(hit.index)) continue;
        const record = target.records[hit.index];
        if (!record) continue;
        return { record };
    }
    return null;
}

renderer.domElement.addEventListener('mousemove', (event) => {
    if (pinnedProbe) return;
    const picked = pickCubeInstance(event);
    if (!picked) {
        renderProbeInfo(null, false);
        return;
    }
    renderProbeInfo(buildProbeInfoFromRecord(picked.record), false);
});

renderer.domElement.addEventListener('click', (event) => {
    const picked = pickCubeInstance(event);
    if (!picked) {
        pinnedProbe = null;
        renderProbeInfo(null, false);
        return;
    }
    pinnedProbe = picked;
    renderProbeInfo(buildProbeInfoFromRecord(picked.record), true);
});

function refreshCurrentVectorsByZoomIfNeeded() {
    if (currentMode !== 'current') return;
    const nextStride = getCurrentVectorStrideByZoom();
    if (nextStride === currentVectorStride) return;
    loadCurrentVectors(currentDepthIdx, nextStride).catch((err) => console.error(err));
}

function refreshCubesByZoomIfNeeded() {
    if (currentMode !== 'temp' && currentMode !== 'salt') return;
    const nextStride = getCubeStrideByZoom();
    if (nextStride === currentCubeStride) return;
    loadPoints(currentMode, nextStride, true).catch((err) => console.error(err));
}

function logCameraDistance() {
    const distance = camera.position.distanceTo(controls.target);
    console.log(`[CameraDistance] ${distance.toFixed(3)}`);
}

async function loadPoints(type, strideOverride = BASE_CUBE_STRIDE, preserveView = false) {
    const strideArg = Number(strideOverride);
    const stride = Number.isFinite(strideArg) ? Math.max(1, Math.round(strideArg)) : BASE_CUBE_STRIDE;
    if (isCubeLoading) {
        queuedCubeStride = stride;
        return;
    }
    isCubeLoading = true;

    try {
    await ensureOceanMeta();
    await loadCoastlineOverlay();
    clearCurrentVectorScene();
    hideCurrentControls();
    currentMode = type;
    currentDataType = type;
    currentCubeStride = stride;
    // Prevent partial chunk updates from flashing while buffers are being rewritten.
    pointGroup.visible = false;

    const res = await fetch(`/api/ocean_3d?type=${type}&stride=${currentCubeStride}`);
    if (!res.ok) {
        const message = await res.text();
        throw new Error(message || `API request failed: ${res.status}`);
    }
    const buffer = await res.arrayBuffer();

    const header = new Float32Array(buffer, 0, 2);
    const [minV, maxV] = header;
    updateLegend(type, minV, maxV);
    let rawData = new Float32Array(buffer, 8);
    const recordStride = detectRecordStride(rawData);
    const totalPoints = rawData.length / recordStride;
    const pointsPerChunk = Math.ceil(totalPoints / CHUNK_COUNT);
    console.log(
        `[CubeLoad] type=${type} stride=${currentCubeStride} totalPoints=${totalPoints} pointsPerChunk=${pointsPerChunk}`
    );

    let minX = Number.POSITIVE_INFINITY;
    let maxX = Number.NEGATIVE_INFINITY;
    let minY = Number.POSITIVE_INFINITY;
    let maxY = Number.NEGATIVE_INFINITY;
    let minZ = Number.POSITIVE_INFINITY;
    let maxZ = Number.NEGATIVE_INFINITY;
    const chunkPositionArrays = [];
    const chunkScaleArrays = [];
    const pickPositions = new Float32Array(totalPoints * 3);
    pickPointRecords = new Array(totalPoints);

    for (let i = 0; i < CHUNK_COUNT; i++) {
        const start = i * pointsPerChunk;
        const end = Math.min(start + pointsPerChunk, totalPoints);
        const currentChunkSize = end - start;

        if (currentChunkSize <= 0) break;

        const positions = new Float32Array(currentChunkSize * 3);
        const scales = new Float32Array(currentChunkSize * 3);
        for (let j = 0; j < currentChunkSize; j++) {
            const rawIdx = (start + j) * recordStride;
            positions[j * 3] = rawData[rawIdx];
            positions[j * 3 + 1] = rawData[rawIdx + 1];
            positions[j * 3 + 2] = rawData[rawIdx + 2];
            if (recordStride >= 7) {
                scales[j * 3] = rawData[rawIdx + 4];
                scales[j * 3 + 1] = rawData[rawIdx + 5];
                scales[j * 3 + 2] = rawData[rawIdx + 6];
            }

            const globalIdx = start + j;
            const px = positions[j * 3];
            const py = positions[j * 3 + 1];
            const pz = positions[j * 3 + 2];
            pickPositions[globalIdx * 3] = px;
            pickPositions[globalIdx * 3 + 1] = py;
            pickPositions[globalIdx * 3 + 2] = pz;
            const geo = modelToLonLat(px, pz);
            const lon = geo.lon;
            const lat = geo.lat;
            const approxDepthMeter = yToApproxDepth(py);
            let depthIdx = 0;
            if (depthValues.length > 0) {
                let best = Number.POSITIVE_INFINITY;
                for (let k = 0; k < depthValues.length; k++) {
                    const diff = Math.abs(depthValues[k] - approxDepthMeter);
                    if (diff < best) {
                        best = diff;
                        depthIdx = k;
                    }
                }
            }
            const depthMeter = Number.isFinite(depthValues[depthIdx]) ? depthValues[depthIdx] : approxDepthMeter;
            pickPointRecords[globalIdx] = {
                lon,
                lat,
                depthIdx,
                depthMeter,
                value: rawData[rawIdx + 3]
            };

            if (positions[j * 3] < minX) minX = positions[j * 3];
            if (positions[j * 3] > maxX) maxX = positions[j * 3];
            if (positions[j * 3 + 1] < minY) minY = positions[j * 3 + 1];
            if (positions[j * 3 + 1] > maxY) maxY = positions[j * 3 + 1];
            if (positions[j * 3 + 2] < minZ) minZ = positions[j * 3 + 2];
            if (positions[j * 3 + 2] > maxZ) maxZ = positions[j * 3 + 2];
        }
        chunkPositionArrays.push(positions);
        chunkScaleArrays.push(scales);
    }

    if (pickPoints) {
        pointGroup.remove(pickPoints);
        pickPoints.geometry.dispose();
        pickPoints.material.dispose();
        pickPoints = null;
    }
    const pickGeometry = new THREE.BufferGeometry();
    pickGeometry.setAttribute('position', new THREE.BufferAttribute(pickPositions, 3));
    const pickMaterial = new THREE.PointsMaterial({
        size: 0.9,
        sizeAttenuation: true,
        transparent: true,
        opacity: 0.0,
        depthTest: true,
        depthWrite: false
    });
    pickPoints = new THREE.Points(pickGeometry, pickMaterial);
    pickPoints.renderOrder = -1;
    pointGroup.add(pickPoints);

    const allX = [];
    const allY = [];
    const allZ = [];
    for (const arr of chunkPositionArrays) {
        for (let i = 0; i < arr.length; i += 3) {
            allX.push(arr[i]);
            allY.push(arr[i + 1]);
            allZ.push(arr[i + 2]);
        }
    }
    const xFallback = computeMinPositiveStep(allX) ?? DATA_CUBE_SIZE.x;
    const yFallback = computeMinPositiveStep(allY) ?? depthToY(CUBE_DEPTH_UNIT_M);
    const zFallback = computeMinPositiveStep(allZ) ?? DATA_CUBE_SIZE.z;
    const xScalePerPoint = buildCoordScaleArray(allX, 1.02, xFallback);
    const yScalePerPoint = buildCoordScaleArray(allY, 1.0, yFallback);
    const zScalePerPoint = buildCoordScaleArray(allZ, 1.02, zFallback);
    let globalScaleIdx = 0;

    // Reset all pooled chunks first, then apply new data in one pass.
    for (const slot of cubeChunkPool) {
        slot.geometry.instanceCount = 0;
        slot.edgeGeometry.instanceCount = 0;
        slot.cubes.visible = false;
        slot.cubeEdges.visible = false;
    }

    for (let i = 0; i < chunkPositionArrays.length; i++) {
        const positions = chunkPositionArrays[i];
        const scales = chunkScaleArrays[i];
        const currentChunkSize = positions.length / 3;
        if (currentChunkSize <= 0) continue;
        const slot = ensureCubeChunkSlot(i);
        ensureCubeSlotCapacity(slot, currentChunkSize);
        const values = new Float32Array(currentChunkSize);
        const start = i * pointsPerChunk;
        for (let j = 0; j < currentChunkSize; j++) {
            const rawIdx = (start + j) * recordStride;
            values[j] = rawData[rawIdx + 3];
        }

        for (let j = 0; j < currentChunkSize; j++) {
            const px = positions[j * 3];
            const py = positions[j * 3 + 1];
            const pz = positions[j * 3 + 2];
            slot.offsetsArray[j * 3] = px;
            slot.offsetsArray[j * 3 + 1] = py;
            slot.offsetsArray[j * 3 + 2] = pz;
            if (recordStride >= 7) {
                slot.scalesArray[j * 3] = scales[j * 3] || xFallback;
                slot.scalesArray[j * 3 + 1] = scales[j * 3 + 1] || yFallback;
                slot.scalesArray[j * 3 + 2] = scales[j * 3 + 2] || zFallback;
            } else {
                slot.scalesArray[j * 3] = xScalePerPoint[globalScaleIdx] || xFallback;
                slot.scalesArray[j * 3 + 1] = yScalePerPoint[globalScaleIdx] || yFallback;
                slot.scalesArray[j * 3 + 2] = zScalePerPoint[globalScaleIdx] || zFallback;
            }
            slot.valuesArray[j] = values[j];
            slot.visibleArray[j] = 1.0;
            globalScaleIdx += 1;
        }

        slot.offsetsAttr.needsUpdate = true;
        slot.scalesAttr.needsUpdate = true;
        slot.valuesAttr.needsUpdate = true;
        slot.visibleAttr.needsUpdate = true;

        slot.geometry.instanceCount = currentChunkSize;
        slot.edgeGeometry.instanceCount = currentChunkSize;
        slot.cubes.material.uniforms.minVal.value = minV;
        slot.cubes.material.uniforms.maxVal.value = maxV;

        const binIndexes = new Uint8Array(currentChunkSize);
        for (let j = 0; j < currentChunkSize; j++) {
            const value = values[j];
            const binIndex = resolveLegendBin(value, minV, maxV);
            binIndexes[j] = binIndex;
        }
        slot.cubes.userData.instancePositions = slot.offsetsArray;
        slot.cubes.userData.binIndexes = binIndexes;
        slot.cubes.userData.instanceVisibleAttr = slot.visibleAttr;
        slot.cubes.visible = true;
        slot.cubeEdges.visible = true;
    }

    const usedChunkCount = chunkPositionArrays.length;

    const renderedInstances = cubeChunkPool.reduce((sum, slot) => sum + (slot.geometry.instanceCount || 0), 0);
    console.log(
        `[CubeRender] type=${type} stride=${currentCubeStride} usedChunks=${usedChunkCount} renderedInstances=${renderedInstances}`
    );

    applyLegendSelectionToPoints();

    if (
        Number.isFinite(minX) && Number.isFinite(maxX) &&
        Number.isFinite(minY) && Number.isFinite(maxY) &&
        Number.isFinite(minZ) && Number.isFinite(maxZ)
    ) {
        applyFixedOrCurrentAxes(minX, maxX, minY, maxY, minZ, maxZ);
    }

    if (!preserveView) {
        fitCameraToPointGroup();
    }
    pointGroup.visible = true;
    } finally {
        pointGroup.visible = true;
        isCubeLoading = false;
        if (queuedCubeStride != null && queuedCubeStride !== currentCubeStride) {
            const nextStride = queuedCubeStride;
            queuedCubeStride = null;
            loadPoints(currentMode, nextStride, true).catch((err) => console.error(err));
        } else {
            queuedCubeStride = null;
        }
    }
}

function animate() {
    requestAnimationFrame(animate);
    controls.update();
    miniMapControls.update();
    renderer.render(scene, camera);
    miniMapRenderer.render(miniMapScene, miniMapCamera);
}
animate();

document.getElementById('tempBtn').onclick = () => loadPoints('temp');
document.getElementById('salBtn').onclick = () => loadPoints('salt');
document.getElementById('currentBtn').onclick = () => loadCurrentVectors(currentDepthIdx);
document.getElementById('resetBtn').onclick = () => resetToInitialTempView();
controls.addEventListener('end', () => {
    logCameraDistance();
    refreshCurrentVectorsByZoomIfNeeded();
    refreshCubesByZoomIfNeeded();
});
document.getElementById('axisBtn').onclick = () => {
    axisVisible = !axisVisible;
    axisGroup.visible = axisVisible;
    document.getElementById('axisBtn').textContent = axisVisible ? '축 숨기기' : '축 보기';
};
legendResetBtn.onclick = () => clearLegendSelection();
currentLegendResetBtn.onclick = () => clearCurrentLegendSelection();
depthSliderEl.oninput = (event) => {
    const nextDepth = Number(event.target.value);
    loadCurrentVectors(Number.isFinite(nextDepth) ? nextDepth : 0);
};

window.setClipX = (v) => {
    currentClipX = Number.isFinite(v) ? v : 99999.0;
    applyLegendSelectionToPoints();
};

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    coastlineGroup.children.forEach((line) => line.material?.resolution?.set(window.innerWidth, window.innerHeight));
    miniMapCamera.aspect = miniMapContainer.clientWidth / miniMapContainer.clientHeight;
    miniMapCamera.updateProjectionMatrix();
    miniMapRenderer.setSize(miniMapContainer.clientWidth, miniMapContainer.clientHeight);
});

updateMiniMapRegionOutline();
loadPoints('temp');
