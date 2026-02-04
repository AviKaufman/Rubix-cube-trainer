import './style.css';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import Cube from 'cubejs';

type Axis = 'x' | 'y' | 'z';
type Face = 'U' | 'R' | 'F' | 'D' | 'L' | 'B';

type Move = {
  axis: Axis;
  layer: number;
  angle: number;
};

type Cubie = {
  mesh: THREE.Mesh;
  coords: THREE.Vector3;
};

type TurnState = {
  axis: Axis;
  axisVec: THREE.Vector3;
  layer: number;
  angle: number;
  turned: number;
  group: THREE.Group;
  cubies: Cubie[];
};

type Step = {
  title: string;
  goal: string;
  algorithm: string;
};

const canvasWrap = document.getElementById('canvas-wrap') as HTMLDivElement;
const queueStatus = document.getElementById('queue-status') as HTMLDivElement;
const stepIndexEl = document.getElementById('step-index') as HTMLSpanElement;
const stepTotalEl = document.getElementById('step-total') as HTMLSpanElement;
const stepTitleEl = document.getElementById('step-title') as HTMLHeadingElement;
const stepGoalEl = document.getElementById('step-goal') as HTMLParagraphElement;
const stepAlgorithmEl = document.getElementById('step-algorithm') as HTMLDivElement;
const applyAlgorithmButton = document.getElementById('apply-algorithm') as HTMLButtonElement;
const copyAlgorithmButton = document.getElementById('copy-algorithm') as HTMLButtonElement;
const prevStepButton = document.getElementById('prev-step') as HTMLButtonElement;
const nextStepButton = document.getElementById('next-step') as HTMLButtonElement;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
const controls = new OrbitControls(camera, renderer.domElement);

renderer.setPixelRatio(window.devicePixelRatio);
canvasWrap.appendChild(renderer.domElement);
renderer.domElement.style.display = 'block';

camera.position.set(6.2, 6.4, 8.2);
controls.enableDamping = true;
controls.minDistance = 5;
controls.maxDistance = 14;
controls.maxPolarAngle = Math.PI * 0.9;

const ambientLight = new THREE.AmbientLight(0xffffff, 0.85);
const keyLight = new THREE.DirectionalLight(0xffffff, 0.6);
keyLight.position.set(6, 10, 4);
scene.add(ambientLight, keyLight);

const spacing = 1.06;
const cubies: Cubie[] = [];
const moveQueue: Move[] = [];

let activeTurn: TurnState | null = null;
let pendingReset = false;
let pendingSolve = false;
let solving = false;
let solverReady = false;
let pendingStepSolve: number | null = null;
let stepSolveInProgress = false;
let pendingStepAdvance: number | null = null;
let pendingOversolveNotice: string | null = null;
let queueStatusOverride: string | null = null;
let solvedFacelets: string | null = null;

const axisVectors: Record<Axis, THREE.Vector3> = {
  x: new THREE.Vector3(1, 0, 0),
  y: new THREE.Vector3(0, 1, 0),
  z: new THREE.Vector3(0, 0, 1)
};

const moveMap: Record<string, Move> = {
  U: { axis: 'y', layer: 1, angle: -Math.PI / 2 },
  D: { axis: 'y', layer: -1, angle: Math.PI / 2 },
  L: { axis: 'x', layer: -1, angle: Math.PI / 2 },
  R: { axis: 'x', layer: 1, angle: -Math.PI / 2 },
  F: { axis: 'z', layer: 1, angle: -Math.PI / 2 },
  B: { axis: 'z', layer: -1, angle: Math.PI / 2 }
};

const faceOrder: Face[] = ['U', 'R', 'F', 'D', 'L', 'B'];
const faceBase: Record<Face, number> = {
  U: 0,
  R: 9,
  F: 18,
  D: 27,
  L: 36,
  B: 45
};

const cornerPositions = [
  { name: 'URF', indices: [8, 9, 20] },
  { name: 'UFL', indices: [6, 18, 38] },
  { name: 'ULB', indices: [0, 36, 47] },
  { name: 'UBR', indices: [2, 45, 11] },
  { name: 'DFR', indices: [29, 26, 15] },
  { name: 'DLF', indices: [27, 44, 24] },
  { name: 'DBL', indices: [33, 53, 42] },
  { name: 'DRB', indices: [35, 17, 51] }
];

const cornerInsertFace = ['R', 'F', 'L', 'B', 'R', 'F', 'L', 'B'];

const uLayerEdges = [
  { name: 'UF', u: faceIndex('U', 7), side: faceIndex('F', 1), sideFace: 'F' },
  { name: 'UR', u: faceIndex('U', 5), side: faceIndex('R', 1), sideFace: 'R' },
  { name: 'UB', u: faceIndex('U', 1), side: faceIndex('B', 1), sideFace: 'B' },
  { name: 'UL', u: faceIndex('U', 3), side: faceIndex('L', 1), sideFace: 'L' }
];

const middleEdges = [
  { name: 'FR', indices: [faceIndex('F', 5), faceIndex('R', 3)], front: 'F', right: 'R' },
  { name: 'FL', indices: [faceIndex('F', 3), faceIndex('L', 5)], front: 'F', left: 'L' },
  { name: 'BR', indices: [faceIndex('B', 3), faceIndex('R', 5)], front: 'B', left: 'R' },
  { name: 'BL', indices: [faceIndex('B', 5), faceIndex('L', 3)], front: 'B', right: 'L' }
];
const uOrder: Face[] = ['F', 'R', 'B', 'L'];

const materialPalette = {
  white: new THREE.MeshStandardMaterial({ color: 0xf5f5f7, roughness: 0.3 }),
  yellow: new THREE.MeshStandardMaterial({ color: 0xffd54f, roughness: 0.3 }),
  red: new THREE.MeshStandardMaterial({ color: 0xff5f5f, roughness: 0.3 }),
  orange: new THREE.MeshStandardMaterial({ color: 0xff9f43, roughness: 0.3 }),
  blue: new THREE.MeshStandardMaterial({ color: 0x4aa3ff, roughness: 0.3 }),
  green: new THREE.MeshStandardMaterial({ color: 0x45d483, roughness: 0.3 }),
  inner: new THREE.MeshStandardMaterial({ color: 0x10131a, roughness: 0.8 })
};

const faceNormals = [
  new THREE.Vector3(1, 0, 0),
  new THREE.Vector3(-1, 0, 0),
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(0, -1, 0),
  new THREE.Vector3(0, 0, 1),
  new THREE.Vector3(0, 0, -1)
];

const materialToFace = new Map<THREE.Material, Face>([
  [materialPalette.white, 'U'],
  [materialPalette.yellow, 'D'],
  [materialPalette.red, 'R'],
  [materialPalette.orange, 'L'],
  [materialPalette.green, 'F'],
  [materialPalette.blue, 'B']
]);

const steps: Step[] = [
  {
    title: 'White Cross',
    goal: 'Make a white cross on top, matching the side colors with the center pieces.',
    algorithm: "F R U R' U' F'"
  },
  {
    title: 'White Corners',
    goal: 'Insert the white corners to finish the first layer. Repeat until the corner is placed.',
    algorithm: "R' D' R D"
  },
  {
    title: 'Middle Layer Edges',
    goal: "Insert middle edges. Right insert: U R U' R' U' F' U F. Left insert: U' L' U L U F U' F'.",
    algorithm: "U R U' R' U' F' U F"
  },
  {
    title: 'Yellow Cross',
    goal: 'Form a yellow cross on top. You may need to repeat this from different angles.',
    algorithm: "F R U R' U' F'"
  },
  {
    title: 'Yellow Face',
    goal: 'Orient the yellow corners so the entire top face is yellow.',
    algorithm: "R U R' U R U2 R'"
  },
  {
    title: 'Position Yellow Corners',
    goal: 'Move the yellow corners into the correct spots without changing their orientation.',
    algorithm: "U R U' L' U R' U' L"
  },
  {
    title: 'Position Yellow Edges',
    goal: 'Cycle the remaining top edges until the cube is solved.',
    algorithm: "R U' R U R U R U' R' U' R2"
  }
];

const algorithmOverrides = Array.from({ length: steps.length }, () => '');
const moveTokens = [
  'U',
  "U'",
  'U2',
  'D',
  "D'",
  'D2',
  'L',
  "L'",
  'L2',
  'R',
  "R'",
  'R2',
  'F',
  "F'",
  'F2',
  'B',
  "B'",
  'B2'
];
const stepMacros: string[][][] = [
  [],
  [
    ['U'],
    ["U'"],
    ['U2'],
    ['R', 'U', "R'", "U'"],
    ["L'", "U'", 'L', 'U']
  ],
  [
    ['U'],
    ["U'"],
    ['U2'],
    ['U', 'R', "U'", "R'", "U'", "F'", 'U', 'F'],
    ["U'", "L'", 'U', 'L', 'U', 'F', "U'", "F'"]
  ],
  [
    ['U'],
    ["U'"],
    ['U2'],
    ['F', 'R', 'U', "R'", "U'", "F'"]
  ],
  [
    ['U'],
    ["U'"],
    ['U2'],
    ['R', 'U', "R'", 'U', 'R', 'U2', "R'"]
  ],
  [
    ['U'],
    ["U'"],
    ['U2'],
    ['U', 'R', "U'", "L'", 'U', "R'", "U'", 'L']
  ],
  [
    ['U'],
    ["U'"],
    ['U2'],
    ['R', "U'", 'R', 'U', 'R', 'U', 'R', "U'", "R'", "U'", 'R2']
  ]
];
const stepDepths = [8, 10, 10, 6, 7, 7, 7];

const geometry = new THREE.BoxGeometry(0.98, 0.98, 0.98);

function buildCubie(x: number, y: number, z: number): Cubie {
  const materials = [
    x === 1 ? materialPalette.red : materialPalette.inner,
    x === -1 ? materialPalette.orange : materialPalette.inner,
    y === 1 ? materialPalette.white : materialPalette.inner,
    y === -1 ? materialPalette.yellow : materialPalette.inner,
    z === 1 ? materialPalette.green : materialPalette.inner,
    z === -1 ? materialPalette.blue : materialPalette.inner
  ];

  const mesh = new THREE.Mesh(geometry, materials);
  mesh.position.set(x * spacing, y * spacing, z * spacing);

  const cubie: Cubie = {
    mesh,
    coords: new THREE.Vector3(x, y, z)
  };

  scene.add(mesh);
  cubies.push(cubie);
  return cubie;
}

function createCube() {
  cubies.length = 0;
  for (let x = -1; x <= 1; x += 1) {
    for (let y = -1; y <= 1; y += 1) {
      for (let z = -1; z <= 1; z += 1) {
        if (x === 0 && y === 0 && z === 0) {
          continue;
        }
        buildCubie(x, y, z);
      }
    }
  }
}

function clearCube() {
  while (cubies.length) {
    const cubie = cubies.pop();
    if (cubie) {
      scene.remove(cubie.mesh);
    }
  }
}

function resetCube() {
  clearCube();
  createCube();
  if (!solvedFacelets) {
    solvedFacelets = getFacelets();
  }
  moveQueue.length = 0;
  activeTurn = null;
  pendingReset = false;
  pendingSolve = false;
  solving = false;
  pendingOversolveNotice = null;
  queueStatusOverride = null;
  updateQueueStatus();
}

function parseAlgorithm(sequence: string): string[] {
  return sequence
    .replace(/[()]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map((token) => token.trim())
    .filter((token) => /^[UDFBLR][2']?$/.test(token));
}

function enqueueMove(token: string) {
  const cleanToken = token.trim();
  const base = moveMap[cleanToken[0]];
  if (!base) {
    return;
  }

  let angle = base.angle;
  if (cleanToken.includes("'")) {
    angle *= -1;
  }
  if (cleanToken.includes('2')) {
    angle *= 2;
  }

  moveQueue.push({ axis: base.axis, layer: base.layer, angle });
  updateQueueStatus();
}

function enqueueAlgorithm(sequence: string) {
  parseAlgorithm(sequence).forEach((token) => enqueueMove(token));
}

function invertMove(token: string): string {
  if (token.endsWith('2')) {
    return token;
  }
  if (token.endsWith("'")) {
    return token.slice(0, -1);
  }
  return `${token}'`;
}

function faceIndex(face: Face, index: number): number {
  return faceBase[face] + index;
}

function allMatch(facelets: string, solved: string, indices: number[]): boolean {
  return indices.every((index) => facelets[index] === solved[index]);
}

function isStepSolved(stepIndex: number, facelets: string, solved: string): boolean {
  switch (stepIndex) {
    case 0: {
      const indices = [
        faceIndex('U', 1),
        faceIndex('U', 3),
        faceIndex('U', 5),
        faceIndex('U', 7),
        faceIndex('F', 1),
        faceIndex('R', 1),
        faceIndex('B', 1),
        faceIndex('L', 1)
      ];
      return allMatch(facelets, solved, indices);
    }
    case 1: {
      const indices = [
        ...Array.from({ length: 9 }, (_, i) => faceIndex('U', i)),
        ...[0, 1, 2].flatMap((i) => [
          faceIndex('F', i),
          faceIndex('R', i),
          faceIndex('B', i),
          faceIndex('L', i)
        ])
      ];
      return allMatch(facelets, solved, indices);
    }
    case 2: {
      const indices = [
        ...Array.from({ length: 9 }, (_, i) => faceIndex('U', i)),
        ...[0, 1, 2, 3, 4, 5].flatMap((i) => [
          faceIndex('F', i),
          faceIndex('R', i),
          faceIndex('B', i),
          faceIndex('L', i)
        ])
      ];
      return allMatch(facelets, solved, indices);
    }
    case 3: {
      const indices = [
        faceIndex('D', 1),
        faceIndex('D', 3),
        faceIndex('D', 5),
        faceIndex('D', 7)
      ];
      return allMatch(facelets, solved, indices);
    }
    case 4: {
      const indices = Array.from({ length: 9 }, (_, i) => faceIndex('D', i));
      return allMatch(facelets, solved, indices);
    }
    case 5: {
      const exclude = new Set([
        faceIndex('F', 7),
        faceIndex('R', 7),
        faceIndex('B', 7),
        faceIndex('L', 7)
      ]);
      for (let i = 0; i < 54; i += 1) {
        if (exclude.has(i)) {
          continue;
        }
        if (facelets[i] !== solved[i]) {
          return false;
        }
      }
      return true;
    }
    case 6:
    default:
      return facelets === solved;
  }
}

function crossCorrectCount(facelets: string, solved: string): number {
  const pairs = [
    [faceIndex('U', 1), faceIndex('B', 1)],
    [faceIndex('U', 3), faceIndex('L', 1)],
    [faceIndex('U', 5), faceIndex('R', 1)],
    [faceIndex('U', 7), faceIndex('F', 1)]
  ];
  let count = 0;
  pairs.forEach(([a, b]) => {
    if (facelets[a] === solved[a] && facelets[b] === solved[b]) {
      count += 1;
    }
  });
  return count;
}

function cornerColorsAt(state: string, position: number): string[] {
  return cornerPositions[position].indices.map((index) => state[index]);
}

function cornerSolvedAt(position: number, state: string, solved: string): boolean {
  return cornerPositions[position].indices.every((index) => state[index] === solved[index]);
}

function findCornerPosition(state: string, targetColors: Set<string>): number | null {
  for (let i = 0; i < cornerPositions.length; i += 1) {
    const colors = cornerColorsAt(state, i);
    if (colors.every((color) => targetColors.has(color))) {
      return i;
    }
  }
  return null;
}

function applyMoves(cube: any, moves: string[], output: string[]) {
  moves.forEach((move) => {
    cube.move(move);
    output.push(move);
  });
}

function edgeSolvedAt(indices: number[], state: string, solved: string): boolean {
  return indices.every((index) => state[index] === solved[index]);
}

function edgeMatchesPosition(indices: number[], state: string, solved: string): boolean {
  const target = new Set(indices.map((index) => solved[index]));
  const colors = indices.map((index) => state[index]);
  return colors.every((color) => target.has(color));
}

function cornerMatchesPosition(position: number, state: string, solved: string): boolean {
  const target = new Set(cornerColorsAt(solved, position));
  const colors = cornerColorsAt(state, position);
  return colors.every((color) => target.has(color));
}

function rightInsert(front: Face, right: Face): string[] {
  return ['U', right, "U'", `${right}'`, "U'", `${front}'`, 'U', front];
}

function leftInsert(front: Face, left: Face): string[] {
  return ["U'", `${left}'`, 'U', left, 'U', front, "U'", `${front}'`];
}

const moveX2Map: Record<string, string> = {
  U: 'D',
  "U'": "D'",
  U2: 'D2',
  D: 'U',
  "D'": "U'",
  D2: 'U2',
  L: 'L',
  "L'": "L'",
  L2: 'L2',
  R: 'R',
  "R'": "R'",
  R2: 'R2',
  F: 'B',
  "F'": "B'",
  F2: 'B2',
  B: 'F',
  "B'": "F'",
  B2: 'F2'
};

function mapMovesX2(tokens: string[]): string[] {
  return tokens.map((token) => moveX2Map[token] ?? token);
}

function rotateX2State(state: string): string {
  if (!rotateX2Map.length) {
    return state;
  }
  const input = state.split('');
  const output = Array(54).fill('');
  rotateX2Map.forEach((mappedIndex, index) => {
    output[mappedIndex] = input[index];
  });
  return output.join('');
}

function solveYellowCross(state: string): string[] | null {
  if (!solvedFacelets) {
    return null;
  }
  const rotatedState = rotateX2State(state);
  const rotatedSolved = rotateX2State(solvedFacelets);
  const cube = Cube.fromString(rotatedState);
  const output: string[] = [];
  const uColor = rotatedSolved[faceIndex('U', 4)];
  const edgeIndices = [
    faceIndex('U', 1),
    faceIndex('U', 3),
    faceIndex('U', 5),
    faceIndex('U', 7)
  ];
  const algorithm = ['F', 'R', 'U', "R'", "U'", "F'"];

  const crossSolved = () => {
    const facelets = cubeStateString(cube);
    return edgeIndices.every((index) => facelets[index] === uColor);
  };

  let guard = 0;
  while (!crossSolved()) {
    guard += 1;
    if (guard > 6) {
      return null;
    }
    const facelets = cubeStateString(cube);
    const oriented = edgeIndices.filter((index) => facelets[index] === uColor);

    if (oriented.length === 0) {
      applyMoves(cube, algorithm, output);
      continue;
    }

    if (oriented.length === 2) {
      const hasHorizontal =
        facelets[edgeIndices[1]] === uColor && facelets[edgeIndices[2]] === uColor;
      const hasVertical =
        facelets[edgeIndices[0]] === uColor && facelets[edgeIndices[3]] === uColor;
      if (hasHorizontal) {
        applyMoves(cube, algorithm, output);
        continue;
      }
      if (hasVertical) {
        applyMoves(cube, ['U'], output);
        applyMoves(cube, algorithm, output);
        continue;
      }
      if (
        !(
          facelets[edgeIndices[0]] === uColor &&
          facelets[edgeIndices[1]] === uColor
        )
      ) {
        applyMoves(cube, ['U'], output);
        continue;
      }
      applyMoves(cube, algorithm, output);
      continue;
    }

    applyMoves(cube, algorithm, output);
  }

  return mapMovesX2(output);
}

function solveYellowFace(state: string): string[] | null {
  if (!solvedFacelets) {
    return null;
  }
  const rotatedState = rotateX2State(state);
  const rotatedSolved = rotateX2State(solvedFacelets);
  const cube = Cube.fromString(rotatedState);
  const output: string[] = [];
  const uColor = rotatedSolved[faceIndex('U', 4)];
  const cornerIndices = [
    faceIndex('U', 0),
    faceIndex('U', 2),
    faceIndex('U', 6),
    faceIndex('U', 8)
  ];
  const algorithm = ['R', 'U', "R'", 'U', 'R', 'U2', "R'"];

  const faceSolved = () => {
    const facelets = cubeStateString(cube);
    return cornerIndices.every((index) => facelets[index] === uColor);
  };

  let guard = 0;
  while (!faceSolved()) {
    guard += 1;
    if (guard > 8) {
      return null;
    }
    const facelets = cubeStateString(cube);
    if (facelets[faceIndex('U', 8)] === uColor) {
      applyMoves(cube, algorithm, output);
      continue;
    }
    if (cornerIndices.some((index) => facelets[index] === uColor)) {
      applyMoves(cube, ['U'], output);
      continue;
    }
    applyMoves(cube, algorithm, output);
  }

  return mapMovesX2(output);
}

function solvePositionYellowCorners(state: string): string[] | null {
  if (!solvedFacelets) {
    return null;
  }
  const rotatedState = rotateX2State(state);
  const rotatedSolved = rotateX2State(solvedFacelets);
  const cube = Cube.fromString(rotatedState);
  const output: string[] = [];
  const algorithm = ['U', 'R', "U'", "L'", 'U', "R'", "U'", 'L'];

  let guard = 0;
  while (true) {
    const facelets = cubeStateString(cube);
    const correctCorners = [0, 1, 2, 3].filter((pos) =>
      cornerMatchesPosition(pos, facelets, rotatedSolved)
    );
    if (correctCorners.length === 4) {
      break;
    }
    guard += 1;
    if (guard > 8) {
      return null;
    }
    if (!cornerMatchesPosition(0, facelets, rotatedSolved)) {
      applyMoves(cube, ['U'], output);
      continue;
    }
    applyMoves(cube, algorithm, output);
  }

  return mapMovesX2(output);
}

function solvePositionYellowEdges(state: string): string[] | null {
  if (!solvedFacelets) {
    return null;
  }
  const rotatedState = rotateX2State(state);
  const rotatedSolved = rotateX2State(solvedFacelets);
  const cube = Cube.fromString(rotatedState);
  const output: string[] = [];
  const algorithm = [
    'R',
    "U'",
    'R',
    'U',
    'R',
    'U',
    'R',
    "U'",
    "R'",
    "U'",
    'R2'
  ];

  let guard = 0;
  while (true) {
    const facelets = cubeStateString(cube);
    const correctEdges = uLayerEdges.filter((edge) =>
      edgeMatchesPosition([edge.u, edge.side], facelets, rotatedSolved)
    );
    if (correctEdges.length === 4) {
      break;
    }
    guard += 1;
    if (guard > 8) {
      return null;
    }
    const ubEdge = uLayerEdges.find((edge) => edge.name === 'UB');
    if (ubEdge && !edgeMatchesPosition([ubEdge.u, ubEdge.side], facelets, rotatedSolved)) {
      applyMoves(cube, ['U'], output);
      continue;
    }
    applyMoves(cube, algorithm, output);
  }

  return mapMovesX2(output);
}

function solveMiddleLayer(state: string): string[] | null {
  if (!solvedFacelets) {
    return null;
  }

  const cube = Cube.fromString(state);
  const output: string[] = [];
  const centers = {
    U: solvedFacelets[faceIndex('U', 4)],
    D: solvedFacelets[faceIndex('D', 4)],
    F: solvedFacelets[faceIndex('F', 4)],
    R: solvedFacelets[faceIndex('R', 4)],
    B: solvedFacelets[faceIndex('B', 4)],
    L: solvedFacelets[faceIndex('L', 4)]
  };
  const rightOf: Record<Face, Face> = { F: 'R', R: 'B', B: 'L', L: 'F', U: 'R', D: 'R' };
  const leftOf: Record<Face, Face> = { F: 'L', L: 'B', B: 'R', R: 'F', U: 'L', D: 'L' };
  const colorToFace: Record<string, Face> = {
    [centers.F]: 'F',
    [centers.R]: 'R',
    [centers.B]: 'B',
    [centers.L]: 'L'
  };
  const uEdgeByFace: Record<Face, typeof uLayerEdges[number]> = {
    F: uLayerEdges[0],
    R: uLayerEdges[1],
    B: uLayerEdges[2],
    L: uLayerEdges[3],
    U: uLayerEdges[0],
    D: uLayerEdges[0]
  };

  const uMovesForDiff = (diff: number): string[] => {
    if (diff === 1) {
      return ['U'];
    }
    if (diff === 2) {
      return ['U2'];
    }
    if (diff === 3) {
      return ["U'"];
    }
    return [];
  };
  const invertDiff = (diff: number) => (4 - diff) % 4;

  let guard = 0;
  while (!isStepSolved(2, cubeStateString(cube), solvedFacelets)) {
    guard += 1;
    if (guard > 60) {
      return null;
    }

    let inserted = false;
    const current = cubeStateString(cube);

    for (const edge of uLayerEdges) {
      const uColor = current[edge.u];
      const sideColor = current[edge.side];
      if (
        uColor === centers.U ||
        uColor === centers.D ||
        sideColor === centers.U ||
        sideColor === centers.D
      ) {
        continue;
      }
      const frontFace = colorToFace[sideColor];
      if (!frontFace) {
        continue;
      }
      const posIndex = uOrder.indexOf(edge.sideFace);
      const targetIndex = uOrder.indexOf(frontFace);
      const diff = (targetIndex - posIndex + 4) % 4;
      const alignMoves = uMovesForDiff(diff);
      applyMoves(cube, alignMoves, output);

      const alignedState = cubeStateString(cube);
      const alignedEdge = uEdgeByFace[frontFace];
      const alignedUColor = alignedState[alignedEdge.u];
      const rightFace = rightOf[frontFace];
      const leftFace = leftOf[frontFace];

      if (alignedUColor === centers[rightFace]) {
        applyMoves(cube, rightInsert(frontFace, rightFace), output);
        applyMoves(cube, uMovesForDiff(invertDiff(diff)), output);
        inserted = true;
        break;
      }
      if (alignedUColor === centers[leftFace]) {
        applyMoves(cube, leftInsert(frontFace, leftFace), output);
        applyMoves(cube, uMovesForDiff(invertDiff(diff)), output);
        inserted = true;
        break;
      }

      applyMoves(cube, uMovesForDiff(invertDiff(diff)), output);
    }

    if (inserted) {
      continue;
    }

    let ejected = false;
    for (const edge of middleEdges) {
      if (!edgeSolvedAt(edge.indices, current, solvedFacelets)) {
        if (edge.right) {
          applyMoves(cube, rightInsert(edge.front, edge.right), output);
        } else if (edge.left) {
          applyMoves(cube, leftInsert(edge.front, edge.left), output);
        }
        ejected = true;
        break;
      }
    }

    if (!ejected) {
      return null;
    }
  }

  return output;
}
function solveWhiteCorners(state: string): string[] | null {
  if (!solvedFacelets) {
    return null;
  }
  const cube = Cube.fromString(state);
  const output: string[] = [];
  const solved = solvedFacelets;

  const targetPositions = [0, 1, 2, 3];
  for (const targetPos of targetPositions) {
    const targetColors = new Set(cornerColorsAt(solved, targetPos));
    let guard = 0;

    while (!cornerSolvedAt(targetPos, cubeStateString(cube), solved)) {
      guard += 1;
      if (guard > 60) {
        return null;
      }
      const currentState = cubeStateString(cube);
      const pos = findCornerPosition(currentState, targetColors);
      if (pos === null) {
        return null;
      }

      if (pos < 4) {
        // Corner is on the U layer but not solved: pop it down.
        const face = cornerInsertFace[pos];
        applyMoves(cube, [`${face}'`, "D'", face, 'D'], output);
        continue;
      }

      // Corner is in D layer: rotate D to align under target slot.
      const posCycle = pos - 4;
      const targetCycle = targetPos;
      const diff = (targetCycle - posCycle + 4) % 4;
      if (diff === 1) {
        applyMoves(cube, ['D'], output);
      } else if (diff === 2) {
        applyMoves(cube, ['D2'], output);
      } else if (diff === 3) {
        applyMoves(cube, ["D'"], output);
      }

      // Insert using the target slot's face.
      const insertFace = cornerInsertFace[targetPos];
      let repeats = 0;
      while (
        !cornerSolvedAt(targetPos, cubeStateString(cube), solved) &&
        repeats < 4
      ) {
        applyMoves(cube, [`${insertFace}'`, "D'", insertFace, 'D'], output);
        repeats += 1;
      }
    }
  }

  return output;
}

function cubeStateString(cube: any): string {
  return typeof cube.asString === 'function' ? cube.asString() : cube.toString();
}

function isUpToStepSolved(stepIndex: number, facelets: string, solved: string): boolean {
  for (let i = 0; i <= stepIndex; i += 1) {
    if (!isStepSolved(i, facelets, solved)) {
      return false;
    }
  }
  return true;
}

function findWhiteCrossSolution(state: string, maxDepth: number): string[] | null {
  if (!solvedFacelets) {
    return null;
  }
  const cube = Cube.fromString(state);
  const path: string[] = [];

  const dfs = (depth: number, lastFace: string): boolean => {
    const current = cubeStateString(cube);
    if (isStepSolved(0, current, solvedFacelets)) {
      return true;
    }
    if (depth === 0) {
      return false;
    }
    const correct = crossCorrectCount(current, solvedFacelets);
    if (4 - correct > depth) {
      return false;
    }
    for (const token of moveTokens) {
      if (token[0] === lastFace) {
        continue;
      }
      cube.move(token);
      path.push(token);
      if (dfs(depth - 1, token[0])) {
        return true;
      }
      path.pop();
      cube.move(invertMove(token));
    }
    return false;
  };

  for (let depth = 0; depth <= maxDepth; depth += 1) {
    if (dfs(depth, '')) {
      return [...path];
    }
  }
  return null;
}

function applyMacroToState(state: string, macro: string[]): string {
  const cube = Cube.fromString(state);
  macro.forEach((token) => cube.move(token));
  return cubeStateString(cube);
}

function searchStepWithMacros(stepIndex: number, state: string): string[] | null {
  if (!solvedFacelets) {
    return null;
  }
  const goal = (facelets: string) => {
    if (!isUpToStepSolved(stepIndex, facelets, solvedFacelets)) {
      return false;
    }
    if (stepIndex < steps.length - 1) {
      return !isStepSolved(stepIndex + 1, facelets, solvedFacelets);
    }
    return true;
  };

  if (goal(state)) {
    return [];
  }

  const macros = stepMacros[stepIndex];
  const maxDepth = stepDepths[stepIndex];
  const queue: { state: string; path: string[] }[] = [{ state, path: [] }];
  const visited = new Map<string, number>([[state, 0]]);

  while (queue.length) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    const depth = current.path.length;
    if (depth >= maxDepth) {
      continue;
    }
    for (const macro of macros) {
      const nextState = applyMacroToState(current.state, macro);
      const nextDepth = depth + 1;
      const prevDepth = visited.get(nextState);
      if (prevDepth !== undefined && prevDepth <= nextDepth) {
        continue;
      }
      const nextPath = current.path.concat(macro);
      if (goal(nextState)) {
        return nextPath;
      }
      visited.set(nextState, nextDepth);
      queue.push({ state: nextState, path: nextPath });
    }
  }
  return null;
}

function searchStepByMoves(stepIndex: number, state: string): string[] | null {
  if (!solvedFacelets) {
    return null;
  }
  const maxDepth = stepDepths[stepIndex];
  const queue: { state: string; path: string[]; lastFace: string }[] = [
    { state, path: [], lastFace: '' }
  ];
  const visited = new Map<string, number>([[state, 0]]);

  while (queue.length) {
    const current = queue.shift();
    if (!current) {
      break;
    }
    const depth = current.path.length;
    if (depth >= maxDepth) {
      continue;
    }
    for (const token of moveTokens) {
      if (token[0] === current.lastFace) {
        continue;
      }
      const cube = Cube.fromString(current.state);
      cube.move(token);
      const nextState = cubeStateString(cube);
      const nextDepth = depth + 1;
      const prevDepth = visited.get(nextState);
      if (prevDepth !== undefined && prevDepth <= nextDepth) {
        continue;
      }
      const nextPath = current.path.concat(token);
      if (isUpToStepSolved(stepIndex, nextState, solvedFacelets)) {
        if (stepIndex === steps.length - 1 || !isStepSolved(stepIndex + 1, nextState, solvedFacelets)) {
          return nextPath;
        }
      }
      visited.set(nextState, nextDepth);
      queue.push({ state: nextState, path: nextPath, lastFace: token[0] });
    }
  }
  return null;
}

function findSolverPrefixForStep(
  stepIndex: number,
  state: string,
  allowNextSolved = false
): string[] | null {
  if (!solvedFacelets) {
    return null;
  }
  if (!solverReady) {
    Cube.initSolver();
    solverReady = true;
  }
  let solution = '';
  try {
    solution = Cube.fromString(state).solve();
  } catch (error) {
    console.error(error);
    return null;
  }
  const tokens = parseAlgorithm(solution);
  if (!tokens.length) {
    return null;
  }
  const cube = Cube.fromString(state);
  for (let i = 0; i < tokens.length; i += 1) {
    cube.move(tokens[i]);
    const facelets = cubeStateString(cube);
    if (!isUpToStepSolved(stepIndex, facelets, solvedFacelets)) {
      continue;
    }
    if (
      !allowNextSolved &&
      stepIndex < steps.length - 1 &&
      isStepSolved(stepIndex + 1, facelets, solvedFacelets)
    ) {
      continue;
    }
    return tokens.slice(0, i + 1);
  }
  return null;
}

function getOversolveNotice(
  stepIndex: number,
  startState: string,
  tokens: string[]
): string | null {
  if (!solvedFacelets || tokens.length === 0) {
    return null;
  }
  const cube = Cube.fromString(startState);
  tokens.forEach((token) => cube.move(token));
  const finalState = cubeStateString(cube);
  if (isStepSolved(steps.length - 1, finalState, solvedFacelets)) {
    return 'This sequence completes the cube. The remaining steps are already solved for this shuffle. Shuffle for a full walkthrough.';
  }
  if (stepIndex < steps.length - 1 && isStepSolved(stepIndex + 1, finalState, solvedFacelets)) {
    return 'This sequence also completes the next step because the last layer is already aligned in this shuffle.';
  }
  return null;
}

function getStepSolutionTokens(stepIndex: number): string[] | null {
  if (!solvedFacelets) {
    return null;
  }
  const current = getFacelets();
  if (!current) {
    return null;
  }
  if (isStepSolved(stepIndex, current, solvedFacelets)) {
    return [];
  }
  if (stepIndex === 0) {
    return findWhiteCrossSolution(current, stepDepths[0]);
  }
  if (stepIndex === 1) {
    const result = solveWhiteCorners(current);
    if (result) {
      return result;
    }
    return searchStepByMoves(stepIndex, current);
  }
  if (stepIndex === 2) {
    const result = solveMiddleLayer(current);
    if (result) {
      return result;
    }
    const strictPrefix = findSolverPrefixForStep(stepIndex, current);
    if (strictPrefix) {
      return strictPrefix;
    }
    return findSolverPrefixForStep(stepIndex, current, true);
  }
  if (stepIndex === 3) {
    return solveYellowCross(current);
  }
  if (stepIndex === 4) {
    return solveYellowFace(current);
  }
  if (stepIndex === 5) {
    return solvePositionYellowCorners(current);
  }
  if (stepIndex === 6) {
    return solvePositionYellowEdges(current);
  }
  return null;
}

function finalizeStepSolve() {
  if (pendingStepAdvance === null || !solvedFacelets) {
    stepSolveInProgress = false;
    pendingStepAdvance = null;
    pendingOversolveNotice = null;
    return;
  }
  const facelets = getFacelets();
  if (!facelets) {
    stepSolveInProgress = false;
    pendingStepAdvance = null;
    pendingOversolveNotice = null;
    return;
  }
  if (isStepSolved(pendingStepAdvance, facelets, solvedFacelets)) {
    if (pendingStepAdvance < steps.length - 1) {
      currentStep = pendingStepAdvance + 1;
      updateStep(currentStep);
    }
  }
  if (pendingOversolveNotice) {
    queueStatusOverride = pendingOversolveNotice;
    pendingOversolveNotice = null;
  }
  stepSolveInProgress = false;
  pendingStepAdvance = null;
}

function applyStepSolution(stepIndex: number) {
  if (solving || stepSolveInProgress) {
    return;
  }
  pendingReset = false;
  pendingSolve = false;
  moveQueue.length = 0;
  pendingOversolveNotice = null;
  queueStatusOverride = null;
  updateQueueStatus();

  if (activeTurn) {
    pendingStepSolve = stepIndex;
    return;
  }

  queueStatus.textContent = 'Searching...';
  const tokens = getStepSolutionTokens(stepIndex);
  if (!tokens) {
    queueStatus.textContent = 'Could not isolate this step. Try again.';
    return;
  }
  if (!tokens.length) {
    queueStatus.textContent = 'Step already solved. Use Next to continue.';
    return;
  }

  const current = getFacelets();
  if (current) {
    pendingOversolveNotice = getOversolveNotice(stepIndex, current, tokens);
  }

  algorithmOverrides[stepIndex] = tokens.join(' ');
  updateStep(stepIndex);
  pendingStepAdvance = stepIndex;
  stepSolveInProgress = true;
  tokens.forEach((token) => enqueueMove(token));
}

function normalToFace(normal: THREE.Vector3): Face {
  const ax = Math.abs(normal.x);
  const ay = Math.abs(normal.y);
  const az = Math.abs(normal.z);

  if (ax >= ay && ax >= az) {
    return normal.x >= 0 ? 'R' : 'L';
  }
  if (ay >= ax && ay >= az) {
    return normal.y >= 0 ? 'U' : 'D';
  }
  return normal.z >= 0 ? 'F' : 'B';
}

function faceletCoords(face: Face, coords: THREE.Vector3): { row: number; col: number } {
  const x = Math.round(coords.x);
  const y = Math.round(coords.y);
  const z = Math.round(coords.z);

  switch (face) {
    case 'U':
      return { row: z + 1, col: x + 1 };
    case 'D':
      return { row: 1 - z, col: x + 1 };
    case 'F':
      return { row: 1 - y, col: x + 1 };
    case 'B':
      return { row: 1 - y, col: 1 - x };
    case 'R':
      return { row: 1 - y, col: 1 - z };
    case 'L':
      return { row: 1 - y, col: z + 1 };
  }
}

function coordsFromFacelet(face: Face, row: number, col: number): THREE.Vector3 {
  switch (face) {
    case 'U':
      return new THREE.Vector3(col - 1, 1, row - 1);
    case 'D':
      return new THREE.Vector3(col - 1, -1, 1 - row);
    case 'F':
      return new THREE.Vector3(col - 1, 1 - row, 1);
    case 'B':
      return new THREE.Vector3(1 - col, 1 - row, -1);
    case 'R':
      return new THREE.Vector3(1, 1 - row, 1 - col);
    case 'L':
      return new THREE.Vector3(-1, 1 - row, col - 1);
  }
}

function normalForFace(face: Face): THREE.Vector3 {
  switch (face) {
    case 'U':
      return new THREE.Vector3(0, 1, 0);
    case 'D':
      return new THREE.Vector3(0, -1, 0);
    case 'F':
      return new THREE.Vector3(0, 0, 1);
    case 'B':
      return new THREE.Vector3(0, 0, -1);
    case 'R':
      return new THREE.Vector3(1, 0, 0);
    case 'L':
      return new THREE.Vector3(-1, 0, 0);
  }
}

function buildRotateX2Map(): number[] {
  const map = Array(54).fill(0);
  const rotatedPosition = new THREE.Vector3();
  const rotatedNormal = new THREE.Vector3();

  for (const face of faceOrder) {
    const normal = normalForFace(face);
    for (let i = 0; i < 9; i += 1) {
      const row = Math.floor(i / 3);
      const col = i % 3;
      const coords = coordsFromFacelet(face, row, col);
      rotatedPosition.copy(coords).set(coords.x, -coords.y, -coords.z);
      rotatedNormal.copy(normal).set(normal.x, -normal.y, -normal.z);
      const newFace = normalToFace(rotatedNormal);
      const { row: newRow, col: newCol } = faceletCoords(newFace, rotatedPosition);
      const oldIndex = faceIndex(face, i);
      const newIndex = faceIndex(newFace, newRow * 3 + newCol);
      map[oldIndex] = newIndex;
    }
  }

  return map;
}

const rotateX2Map = buildRotateX2Map();

function getFacelets(): string | null {
  const faces: Record<Face, string[]> = {
    U: Array(9).fill(''),
    R: Array(9).fill(''),
    F: Array(9).fill(''),
    D: Array(9).fill(''),
    L: Array(9).fill(''),
    B: Array(9).fill('')
  };

  scene.updateMatrixWorld(true);

  const normal = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();

  cubies.forEach((cubie) => {
    const materials = cubie.mesh.material as THREE.Material[];
    cubie.mesh.getWorldQuaternion(quaternion);

    faceNormals.forEach((localNormal, index) => {
      const faceLetter = materialToFace.get(materials[index]);
      if (!faceLetter) {
        return;
      }
      normal.copy(localNormal).applyQuaternion(quaternion).normalize();
      const targetFace = normalToFace(normal);
      const { row, col } = faceletCoords(targetFace, cubie.coords);
      faces[targetFace][row * 3 + col] = faceLetter;
    });
  });

  for (const face of faceOrder) {
    if (faces[face].some((value) => value === '')) {
      return null;
    }
  }

  return faceOrder.map((face) => faces[face].join('')).join('');
}

function solveCurrentState() {
  if (solving) {
    return;
  }
  const facelets = getFacelets();
  if (!facelets) {
    queueStatus.textContent = 'Solver failed';
    return;
  }
  if (!solverReady) {
    Cube.initSolver();
    solverReady = true;
  }
  let solution = '';
  try {
    solution = Cube.fromString(facelets).solve();
  } catch (error) {
    queueStatus.textContent = 'Solver failed';
    console.error(error);
    return;
  }
  if (!solution || solution.trim() === '' || solution.trim() === '0') {
    queueStatus.textContent = 'Already solved';
    return;
  }
  solving = true;
  enqueueAlgorithm(solution);
  if (moveQueue.length === 0) {
    solving = false;
    queueStatus.textContent = 'Solver failed';
    return;
  }
  updateQueueStatus();
}

function shuffleCube(turns = 25) {
  pendingOversolveNotice = null;
  queueStatusOverride = null;
  const faces = ['U', 'D', 'L', 'R', 'F', 'B'];
  let lastFace = '';
  for (let i = 0; i < turns; i += 1) {
    let face = faces[Math.floor(Math.random() * faces.length)];
    while (face === lastFace) {
      face = faces[Math.floor(Math.random() * faces.length)];
    }
    lastFace = face;
    const modifier = Math.random() > 0.7 ? "'" : '';
    enqueueMove(face + modifier);
  }
}

function startTurn(move: Move) {
  const axisVec = axisVectors[move.axis].clone();
  const group = new THREE.Group();
  scene.add(group);

  const selected: Cubie[] = [];
  cubies.forEach((cubie) => {
    const value = cubie.coords[move.axis];
    if (Math.round(value) === move.layer) {
      selected.push(cubie);
      group.add(cubie.mesh);
    }
  });

  activeTurn = {
    axis: move.axis,
    axisVec,
    layer: move.layer,
    angle: move.angle,
    turned: 0,
    group,
    cubies: selected
  };
}

function finishTurn(turn: TurnState) {
  const { axisVec, angle, group, cubies: turnCubies } = turn;
  group.updateMatrixWorld();

  turnCubies.forEach((cubie) => {
    cubie.mesh.applyMatrix4(group.matrix);
    const newCoords = cubie.coords.clone().applyAxisAngle(axisVec, angle);
    cubie.coords.set(
      Math.round(newCoords.x),
      Math.round(newCoords.y),
      Math.round(newCoords.z)
    );
    cubie.mesh.position.set(
      cubie.coords.x * spacing,
      cubie.coords.y * spacing,
      cubie.coords.z * spacing
    );
    scene.add(cubie.mesh);
  });

  scene.remove(group);
  activeTurn = null;
  if (pendingSolve && moveQueue.length === 0) {
    pendingSolve = false;
    solveCurrentState();
  }
  if (pendingStepSolve !== null && moveQueue.length === 0) {
    const stepIndex = pendingStepSolve;
    pendingStepSolve = null;
    applyStepSolution(stepIndex);
  }
  if (solving && moveQueue.length === 0) {
    solving = false;
  }
  if (stepSolveInProgress && moveQueue.length === 0) {
    finalizeStepSolve();
  }
  updateQueueStatus();
}

function updateQueueStatus() {
  if (pendingReset) {
    queueStatus.textContent = 'Resetting...';
    return;
  }
  if (pendingSolve || solving) {
    queueStatus.textContent = moveQueue.length
      ? `Solving (${moveQueue.length} queued)`
      : 'Solving...';
    return;
  }
  if (pendingStepSolve !== null || stepSolveInProgress) {
    queueStatus.textContent = moveQueue.length
      ? `Guided step (${moveQueue.length} queued)`
      : 'Guided step...';
    return;
  }
  if (activeTurn) {
    queueStatus.textContent = `Turning (${moveQueue.length} queued)`;
    return;
  }
  if (moveQueue.length) {
    queueStatus.textContent = `Queued ${moveQueue.length}`;
    return;
  }
  if (queueStatusOverride) {
    queueStatus.textContent = queueStatusOverride;
    return;
  }
  queueStatus.textContent = 'Ready';
}

function updateStep(index: number) {
  const step = steps[index];
  stepIndexEl.textContent = String(index + 1);
  stepTotalEl.textContent = String(steps.length);
  stepTitleEl.textContent = step.title;
  stepGoalEl.textContent = step.goal;
  const override = algorithmOverrides[index];
  stepAlgorithmEl.textContent = override || step.algorithm || 'No fixed algorithm.';
}

let currentStep = 0;
updateStep(currentStep);

applyAlgorithmButton.addEventListener('click', () => {
  applyStepSolution(currentStep);
});

copyAlgorithmButton.addEventListener('click', async () => {
  const algorithm = algorithmOverrides[currentStep] || steps[currentStep].algorithm;
  if (navigator.clipboard && algorithm) {
    await navigator.clipboard.writeText(algorithm);
  }
});

prevStepButton.addEventListener('click', () => {
  currentStep = (currentStep - 1 + steps.length) % steps.length;
  updateStep(currentStep);
});

nextStepButton.addEventListener('click', () => {
  currentStep = (currentStep + 1) % steps.length;
  updateStep(currentStep);
});

document.querySelectorAll<HTMLButtonElement>('[data-move]').forEach((button) => {
  button.addEventListener('click', () => {
    const move = button.dataset.move;
    if (move) {
      enqueueMove(move);
    }
  });
});

const shuffleButton = document.getElementById('shuffle') as HTMLButtonElement;
const solveButton = document.getElementById('solve') as HTMLButtonElement;
const resetButton = document.getElementById('reset') as HTMLButtonElement;
const clearQueueButton = document.getElementById('clear-queue') as HTMLButtonElement;

shuffleButton.addEventListener('click', () => shuffleCube());
solveButton.addEventListener('click', () => {
  if (solving || pendingSolve) {
    return;
  }
  pendingReset = false;
  pendingStepSolve = null;
  stepSolveInProgress = false;
  pendingStepAdvance = null;
  moveQueue.length = 0;
  updateQueueStatus();
  if (activeTurn) {
    pendingSolve = true;
    return;
  }
  solveCurrentState();
});

resetButton.addEventListener('click', () => {
  pendingReset = true;
  pendingSolve = false;
  solving = false;
  pendingStepSolve = null;
  stepSolveInProgress = false;
  pendingStepAdvance = null;
  moveQueue.length = 0;
  updateQueueStatus();
  if (!activeTurn) {
    resetCube();
  }
});

clearQueueButton.addEventListener('click', () => {
  moveQueue.length = 0;
  pendingReset = false;
  pendingSolve = false;
  solving = false;
  pendingStepSolve = null;
  stepSolveInProgress = false;
  pendingStepAdvance = null;
  updateQueueStatus();
});

window.addEventListener('keydown', (event) => {
  const key = event.key.toUpperCase();
  if (!['U', 'D', 'L', 'R', 'F', 'B'].includes(key)) {
    return;
  }
  const token = event.shiftKey ? `${key}'` : key;
  enqueueMove(token);
});

createCube();
solvedFacelets = getFacelets();

function setRendererSize() {
  const { clientWidth, clientHeight } = canvasWrap;
  const width = Math.max(1, clientWidth);
  const height = Math.max(1, clientHeight);
  renderer.setSize(width, height, true);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

setRendererSize();

if ('ResizeObserver' in window) {
  const resizeObserver = new ResizeObserver(() => setRendererSize());
  resizeObserver.observe(canvasWrap);
} else {
  window.addEventListener('resize', () => setRendererSize());
}

const clock = new THREE.Clock();
const turnSpeed = Math.PI * 2.5;

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (!activeTurn && moveQueue.length) {
    const nextMove = moveQueue.shift();
    if (nextMove) {
      startTurn(nextMove);
    }
  }

  if (activeTurn) {
    const { angle, axisVec, group } = activeTurn;
    const remaining = angle - activeTurn.turned;
    const step = Math.sign(remaining) * Math.min(Math.abs(remaining), turnSpeed * delta);
    group.rotateOnAxis(axisVec, step);
    activeTurn.turned += step;

    if (Math.abs(angle - activeTurn.turned) < 0.0001) {
      finishTurn(activeTurn);
      if (pendingReset && moveQueue.length === 0) {
        resetCube();
      }
    }
  }

  controls.update();
  renderer.render(scene, camera);
}

animate();
