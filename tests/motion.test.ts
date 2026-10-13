import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../src/sample';
import { compileMotion, interpolatePose } from '../src/lib/motion';

describe('motion compiler', () => {
  it('builds a deterministic 60 Hz track and releases the moving limb mid-flight', () => {
    const project = createSampleProject(); const track = compileMotion(project, 60);
    expect(track.duration).toBeGreaterThan(3); expect(track.sampleRate).toBe(60);
    const transition = track.frames.filter(f => f.stepIndex === 1); const middle = transition[Math.floor(transition.length * .35)];
    expect(middle.pose.contacts.rightHand).toBeUndefined();
    expect(track.frames.every((f, i) => i === 0 || f.time >= track.frames[i - 1].time)).toBe(true);
  });

  it('checks intermediate frames rather than only key poses', () => {
    const project = createSampleProject(); const track = compileMotion(project, 60);
    const movingFrames = track.frames.filter(f => f.stepIndex === 1 && !f.pose.contacts.rightHand);
    expect(movingFrames.length).toBeGreaterThan(20); expect(movingFrames.every(f => Number.isFinite(f.physics.residual))).toBe(true);
  });

  it('adds a small gravity sag while a limb is released', () => {
    const project = createSampleProject(); const a = structuredClone(project.steps[0].pose); const b = structuredClone(a);
    b.endpoints.rightHand = { x: b.endpoints.rightHand.x + .08, y: b.endpoints.rightHand.y - .04 };
    b.contacts.rightHand = project.holds[2].id;
    const middle = interpolatePose(a, b, .5, 'rightHand');
    expect(middle.contacts.rightHand).toBeUndefined();
    expect(middle.hip.y).toBeGreaterThan(a.hip.y);
    expect(middle.shoulder.y).toBeGreaterThan(a.shoulder.y);
  });

  it('shows a gravity drop after a sustained failed pose', () => {
    const project = createSampleProject(); const failed = structuredClone(project.steps[0]);
    failed.id = 'failed-step'; failed.pose.contacts = {}; failed.moveSeconds = .2; failed.holdSeconds = 1.2;
    project.steps = [project.steps[0], failed];
    const track = compileMotion(project, 60); const last = track.frames.at(-1)!;
    expect(last.pose.hip.y).toBeGreaterThan(failed.pose.hip.y + .08);
    expect(last.pose.contacts).toEqual({});
  });
});
