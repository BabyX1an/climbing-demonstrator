import { create } from 'zustand';
import type { EditorMode, EditorTool, Hold, Limb, Point, Pose, Project } from './types';
import { createSampleProject, makeHold, uid } from './sample';
import { validateReach } from './lib/physics';
import { poseAtRouteStart } from './lib/startPose';

type State = {
  project: Project;
  selectedHoldId?: string;
  selectedLimb?: Limb;
  selectedStep: number;
  workingPose: Pose;
  workingDirty: boolean;
  editorMode: EditorMode;
  tool: EditorTool;
  history: Project[];
  future: Project[];
  notice?: string;
  setProject: (p: Project, record?: boolean) => void;
  update: (fn: (p: Project) => void, notice?: string) => void;
  selectHold: (id?: string) => void;
  selectLimb: (limb?: Limb) => void;
  selectStep: (n: number) => void;
  updateWorkingPose: (fn: (pose: Pose) => void, notice?: string) => void;
  setTool: (t: EditorTool) => void;
  setEditorMode: (mode: EditorMode) => void;
  beginClimb: () => boolean;
  setNotice: (n?: string) => void;
  addHold: (p: Point) => void;
  toggleStartHold: (id: string) => void;
  assignLimb: (hold: Hold, limb?: Limb) => void;
  moveHandle: (kind: 'hold' | 'hip' | 'shoulder' | Limb, p: Point) => void;
  captureKeyframe: () => void;
  updateKeyframe: () => void;
  clearKeyframes: () => void;
  duplicateStep: () => void;
  deleteStep: () => void;
  undo: () => void;
  redo: () => void;
};

const clone = <T,>(x: T): T => structuredClone(x);
const initialProject = createSampleProject();

export const useStudio = create<State>((set, get) => ({
  project: initialProject, selectedStep: 0, workingPose: clone(initialProject.steps[0].pose), workingDirty: false, editorMode: 'route', tool: 'select', history: [], future: [],
  setProject: (project, record = false) => set(s => ({ project: clone(project), workingPose: clone(project.steps[0].pose), workingDirty: false, history: record ? [...s.history, clone(s.project)].slice(-40) : s.history, future: record ? [] : s.future, selectedStep: 0, selectedHoldId: undefined })),
  update: (fn, notice) => set(s => {
    const before = clone(s.project), project = clone(s.project); fn(project); project.updatedAt = new Date().toISOString();
    return { project, history: [...s.history, before].slice(-40), future: [], notice };
  }),
  selectHold: selectedHoldId => set({ selectedHoldId }), selectLimb: selectedLimb => set({ selectedLimb }),
  selectStep: selectedStep => set(s => ({ selectedStep, workingPose: clone(s.project.steps[selectedStep]?.pose ?? s.workingPose), workingDirty: false })),
  updateWorkingPose: (fn, notice) => set(s => { const workingPose = clone(s.workingPose); fn(workingPose); return { workingPose, workingDirty: true, notice }; }),
  setTool: tool => set({ tool }), setNotice: notice => set({ notice }),
  setEditorMode: editorMode => set({ editorMode, tool: 'select', selectedHoldId: undefined, selectedLimb: undefined }),
  beginClimb: () => {
    const state = get();
    const placement = poseAtRouteStart(state.project);
    if (!placement.pose) { set({ notice: placement.warning }); return false; }
    const before = clone(state.project); const project = clone(state.project);
    const first = project.steps[0]; first.pose = placement.pose; first.name = '起步姿势'; first.movingLimb = undefined; first.note = '起步姿势';
    project.steps = [first];
    project.updatedAt = new Date().toISOString();
    set({ project, workingPose: clone(placement.pose), workingDirty: false, history: [...state.history, before].slice(-40), future: [], editorMode: 'climb', tool: 'select', selectedStep: 0, selectedHoldId: undefined, selectedLimb: undefined, notice: placement.warning ?? '已进入动作编排，起步姿势已成为第一个关键帧' });
    return true;
  },
  addHold: point => {
    const hold = makeHold(point); get().update(p => p.holds.push(hold), '已添加岩点');
    set({ selectedHoldId: hold.id, tool: 'select' });
  },
  toggleStartHold: id => {
    const project = get().project; const existing = project.route.startHoldIds.includes(id); const replacing = !existing && project.route.startHoldIds.length >= 2;
    get().update(p => {
      const hold = p.holds.find(h => h.id === id); if (!hold) return;
      hold.status = 'route'; hold.confirmed = true;
      p.route.startHoldIds = existing ? p.route.startHoldIds.filter(holdId => holdId !== id) : [...p.route.startHoldIds.slice(-1), id];
    }, existing ? '已取消该起步点' : replacing ? '已替换最早的起步点' : `已设置起步点 S${project.route.startHoldIds.length + 1}`);
    set({ selectedHoldId: id });
  },
  assignLimb: (hold, requestedLimb) => {
    const { selectedLimb, project, workingPose } = get(); const limb = requestedLimb ?? selectedLimb; if (!limb) return;
    const candidate = clone(workingPose); candidate.endpoints[limb] = { ...hold.center };
    if (!validateReach(project, candidate, limb).ok) { set({ notice: `${limbLabel(limb)}无法够到该岩点，请先移动髋部或肩部` }); return; }
    get().updateWorkingPose(pose => { pose.endpoints[limb] = { ...hold.center }; pose.contacts[limb] = hold.id; }, `${limbLabel(limb)}已连接到岩点；满意后点击“截取关键帧”`);
  },
  moveHandle: (kind, point) => {
    const { selectedHoldId, project, editorMode, workingPose } = get();
    if (kind !== 'hold') {
      const candidate = clone(workingPose);
      if (kind === 'hip' || kind === 'shoulder') candidate[kind] = point; else candidate.endpoints[kind] = point;
      const affected: Limb[] = kind === 'hip' ? ['leftFoot', 'rightFoot'] : kind === 'shoulder' ? ['leftHand', 'rightHand'] : [kind];
      if (affected.some(l => !validateReach(project, candidate, l).ok)) { set({ notice: '该位置会拉长肢体，已保留原姿势' }); return; }
    }
    if (kind !== 'hold' || editorMode === 'climb') {
      get().updateWorkingPose(pose => { if (kind === 'hip' || kind === 'shoulder') pose[kind] = point; else if (kind !== 'hold') { pose.endpoints[kind] = point; delete pose.contacts[kind]; } });
      return;
    }
    get().update(p => {
      const h = p.holds.find(x => x.id === selectedHoldId); if (!h) return;
      const old = h.center; h.center = point; h.confirmed = true;
      p.steps.forEach(s => Object.entries(s.pose.contacts).forEach(([limb, id]) => { if (id === h.id) s.pose.endpoints[limb as Limb] = { ...point }; }));
      if (h.polygon) h.polygon = h.polygon.map(q => ({ x: q.x + point.x - old.x, y: q.y + point.y - old.y }));
    });
  },
  captureKeyframe: () => {
    const state = get(); const current = state.project.steps[state.selectedStep]; if (!current) return;
    const index = state.selectedStep + 1;
    const movingLimb = detectMovingLimb(current.pose, state.workingPose);
    const captured = { ...clone(current), id: uid('step'), name: movingLimb ? `${limbLabel(movingLimb)}移动` : `关键帧 ${index + 1}`, pose: clone(state.workingPose), movingLimb, note: '', moveSeconds: 1.2, holdSeconds: .6 };
    get().update(p => { p.steps.splice(index, 0, captured); }, `已在当前帧后插入关键帧 ${index + 1}`);
    set({ selectedStep: index, workingPose: clone(captured.pose), workingDirty: false });
  },
  updateKeyframe: () => {
    const state = get(); const current = state.project.steps[state.selectedStep]; if (!current) return;
    get().update(p => { const step = p.steps[state.selectedStep]; step.pose = clone(state.workingPose); step.movingLimb = state.selectedStep ? detectMovingLimb(p.steps[state.selectedStep - 1].pose, state.workingPose) : undefined; }, `已更新关键帧 ${state.selectedStep + 1}`);
    set({ workingDirty: false });
  },
  clearKeyframes: () => {
    const state = get(); const first = state.project.steps[0]; if (!first) return;
    get().update(p => { p.steps = [clone(first)]; }, '已清空后续关键帧，保留起步姿势');
    set({ selectedStep: 0, workingPose: clone(first.pose), workingDirty: false });
  },
  duplicateStep: () => {
    const { selectedStep, workingPose } = get(); const index = selectedStep + 1;
    get().update(p => { const base = p.steps[selectedStep]; if (base) p.steps.splice(index, 0, { ...clone(base), id: uid('step'), name: `${base.name} 副本`, pose: clone(workingPose) }); });
    set({ selectedStep: index, workingPose: clone(workingPose), workingDirty: false });
  },
  deleteStep: () => {
    const { selectedStep, project } = get(); if (selectedStep === 0 || project.steps.length <= 1) { set({ notice: '起步关键帧不能删除' }); return; }
    const nextIndex = selectedStep - 1; get().update(p => { p.steps.splice(selectedStep, 1); }, '已删除关键帧'); const next = project.steps[nextIndex]?.pose; set({ selectedStep: nextIndex, workingPose: next ? clone(next) : get().workingPose, workingDirty: false });
  },
  undo: () => set(s => { const project = s.history.at(-1); if (!project) return {}; const selectedStep = Math.min(s.selectedStep, project.steps.length - 1); return { project: clone(project), workingPose: clone(project.steps[selectedStep].pose), workingDirty: false, history: s.history.slice(0, -1), future: [clone(s.project), ...s.future], selectedStep }; }),
  redo: () => set(s => { const project = s.future[0]; if (!project) return {}; const selectedStep = Math.min(s.selectedStep, project.steps.length - 1); return { project: clone(project), workingPose: clone(project.steps[selectedStep].pose), workingDirty: false, future: s.future.slice(1), history: [...s.history, clone(s.project)], selectedStep }; }),
}));

export const limbLabel = (l: Limb) => ({ leftHand: '左手', rightHand: '右手', leftFoot: '左脚', rightFoot: '右脚' })[l];
function detectMovingLimb(previous: Pose, next: Pose): Limb | undefined { const changed = (Object.keys(next.endpoints) as Limb[]).filter(limb => previous.contacts[limb] !== next.contacts[limb] || Math.hypot(previous.endpoints[limb].x - next.endpoints[limb].x, previous.endpoints[limb].y - next.endpoints[limb].y) > .008); return changed.length === 1 ? changed[0] : undefined; }
