import { beforeEach, describe, expect, it } from 'vitest';
import { createSampleProject } from '../src/sample';
import { useStudio } from '../src/store';

describe('editor stage separation', () => {
  beforeEach(() => useStudio.setState({
    project: createSampleProject(),
    editorMode: 'route',
    tool: 'select',
    selectedStep: 0,
    selectedHoldId: undefined,
    selectedLimb: undefined,
    history: [],
    future: [],
  }));

  it('places both hands on route start holds when demonstration begins', () => {
    expect(useStudio.getState().beginClimb()).toBe(true);
    const { project, editorMode } = useStudio.getState();
    const pose = project.steps[0].pose;
    expect(editorMode).toBe('climb');
    expect(pose.contacts.leftHand).toBe(project.route.startHoldIds[0]);
    expect(pose.contacts.rightHand).toBe(project.route.startHoldIds[1]);
    expect(pose.endpoints.leftHand).toEqual(project.holds.find(h => h.id === pose.contacts.leftHand)?.center);
    expect(pose.endpoints.rightHand).toEqual(project.holds.find(h => h.id === pose.contacts.rightHand)?.center);
  });

  it('moves a connected limb without moving its hold', () => {
    useStudio.getState().beginClimb();
    const holdId = useStudio.getState().project.steps[0].pose.contacts.leftHand!;
    const before = structuredClone(useStudio.getState().project.holds.find(h => h.id === holdId)!.center);
    useStudio.getState().moveHandle('leftHand', { x: before.x + .02, y: before.y + .01 });
    const { project } = useStudio.getState();
    expect(project.holds.find(h => h.id === holdId)?.center).toEqual(before);
    expect(project.steps[0].pose.contacts.leftHand).toBeUndefined();
  });

  it('toggles up to two start holds directly from the canvas tool', () => {
    const initial = useStudio.getState().project;
    useStudio.getState().toggleStartHold(initial.route.startHoldIds[0]);
    expect(useStudio.getState().project.route.startHoldIds).toHaveLength(1);
    useStudio.getState().toggleStartHold(initial.holds[2].id);
    expect(useStudio.getState().project.route.startHoldIds).toEqual([initial.route.startHoldIds[1], initial.holds[2].id]);
  });
});
