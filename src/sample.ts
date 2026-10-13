import type { Hold, Point, Pose, Project, Step } from './types';

export const uid = (prefix = 'id') => `${prefix}-${crypto.randomUUID?.() ?? Math.random().toString(36).slice(2)}`;

const wallSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="800" viewBox="0 0 1200 800">
<defs><linearGradient id="g" x1="0" x2="1" y1="0" y2="1"><stop stop-color="#b7b1a5"/><stop offset="1" stop-color="#77746d"/></linearGradient><filter id="s"><feDropShadow dx="5" dy="7" stdDeviation="5" flood-opacity=".35"/></filter></defs>
<rect width="1200" height="800" fill="url(#g)"/><path d="M0 560L1200 410V800H0Z" fill="#6b6964" opacity=".22"/><g stroke="#52504d" opacity=".16"><path d="M0 170H1200M0 390H1200M0 610H1200"/><path d="M240 0V800M600 0V800M960 0V800"/></g>
<g fill="#e04f86" filter="url(#s)"><path d="M205 675q-52-12-35-55t86-5q28 35-51 60"/><path d="M400 575q-50-45 14-72t81 24q-25 59-95 48"/><path d="M603 448q-54-22-23-64t84 1q12 50-61 63"/><path d="M772 315q-50-33-5-69t77 10q-3 53-72 59"/><path d="M946 164q-35-42 15-70t70 19q-13 53-85 51"/></g>
<g fill="#2d91a2" opacity=".9" filter="url(#s)"><ellipse cx="310" cy="260" rx="58" ry="30"/><ellipse cx="540" cy="184" rx="47" ry="25"/><ellipse cx="850" cy="560" rx="64" ry="33"/></g><text x="35" y="55" font-family="sans-serif" font-size="24" fill="#fff" opacity=".65">DEMO WALL · replace with your photo</text></svg>`;
export const samplePhoto = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(wallSvg)}`;

const profile = (usage: Hold['profile']['usage'] = 'pull'): Hold['profile'] => ({
  allowed: ['hand', 'foot', 'heel', 'toe'], usage, normalAngleDeg: 90,
  friction: .65, capacityN: 900, hookAllowed: true,
});

const routePoints: Array<[number, number, Hold['kind'], Hold['profile']['usage']]> = [
  [.18, .80, 'jug', 'pull'], [.37, .67, 'edge', 'sidepull-right'], [.52, .52, 'sloper', 'pull'],
  [.67, .36, 'pinch', 'sidepull-left'], [.83, .16, 'jug', 'pull'],
];

export const makeHold = (center: Point, index = 0, source: Hold['source'] = 'manual'): Hold => ({
  id: uid('hold'), center, radius: { x: .045, y: .035 }, kind: 'unknown', status: 'route', source,
  confirmed: source === 'manual', depthCm: 4, profile: profile(index % 3 === 1 ? 'sidepull-right' : 'pull'),
});

const holds: Hold[] = routePoints.map(([x, y, kind, usage], i) => ({ ...makeHold({ x, y }, i), kind, profile: profile(usage) }));

const initialPose: Pose = {
  hip: { x: .26, y: .72 }, shoulder: { x: .27, y: .59 }, wallDepthM: .16, torsoAngleDeg: 4,
  endpoints: { leftHand: { ...holds[0].center }, rightHand: { ...holds[1].center }, leftFoot: { x: .19, y: .83 }, rightFoot: { x: .34, y: .81 } },
  contacts: { leftHand: holds[0].id, rightHand: holds[1].id },
  bend: { leftHand: -1, rightHand: 1, leftFoot: -1, rightFoot: 1 },
};

const step = (name: string, pose: Pose, movingLimb?: Step['movingLimb'], note = ''): Step => ({
  id: uid('step'), name, pose: structuredClone(pose), movingLimb, moveSeconds: 1.2, holdSeconds: .6, note, pathLift: .035,
});

const pose2: Pose = structuredClone(initialPose);
pose2.endpoints.rightHand = { ...holds[2].center }; pose2.contacts.rightHand = holds[2].id; pose2.hip = { x: .38, y: .61 }; pose2.shoulder = { x: .40, y: .48 };
const pose3: Pose = structuredClone(pose2);
pose3.endpoints.leftHand = { ...holds[3].center }; pose3.contacts.leftHand = holds[3].id; pose3.hip = { x: .53, y: .48 }; pose3.shoulder = { x: .55, y: .35 };

export const createSampleProject = (): Project => ({
  version: 1, id: uid('project'), name: 'Pink Traverse Demo', updatedAt: new Date().toISOString(),
  photo: { dataUrl: samplePhoto, name: 'demo-wall.svg', width: 1200, height: 800 }, holds,
  route: { name: 'Pink route', colorSamples: ['#e04f86'], tolerance: 28, startHoldIds: [holds[0].id, holds[1].id], topHoldId: holds[4].id, topRule: 'both-hands', topHoldSeconds: 1 },
  calibration: { calibrated: true, metersPerImageHeight: 4.2, wallAngleDeg: 12, referenceMeters: 1 },
  climber: { heightM: 1.72, wingspanM: 1.75, weightKg: 65, strengthPreset: 'regular', coreCapacityNm: 115, maxHandN: 520, maxFootN: 1000 },
  thresholds: { warningPercent: 100, fallPercent: 150, fallDurationSeconds: .5 },
  steps: [step('起步姿势', initialPose, undefined, '双手建立起步位置'), step('右手到圆坡点', pose2, 'rightHand', '髋部向右靠墙'), step('左手侧拉', pose3, 'leftHand', '右脚保持旗式平衡')],
});
