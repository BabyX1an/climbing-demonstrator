import { describe, expect, it } from 'vitest';
import { createSampleProject } from '../src/sample';
import { evaluatePose, validateReach } from '../src/lib/physics';

describe('quasi-static physics', () => {
  it('marks an uncalibrated project as unknown instead of a fall', () => {
    const project = createSampleProject(); project.calibration.calibrated = false;
    expect(evaluatePose(project, project.steps[0].pose).status).toBe('unknown');
  });

  it('increases core load when the body moves farther from the wall', () => {
    const project = createSampleProject(); const near = structuredClone(project.steps[1].pose); const far = structuredClone(near);
    near.wallDepthM = .08; far.wallDepthM = .46;
    expect(evaluatePose(project, far).coreLoadPercent).toBeGreaterThan(evaluatePose(project, near).coreLoadPercent + 80);
  });

  it('reports an unsupported pose as a fall', () => {
    const project = createSampleProject(); const pose = structuredClone(project.steps[0].pose); pose.contacts = {};
    const result = evaluatePose(project, pose);
    expect(result.status).toBe('fall'); expect(result.reasons.join(' ')).toContain('没有有效接触点');
  });

  it('detects a target beyond the fixed limb length', () => {
    const project = createSampleProject(); const pose = structuredClone(project.steps[0].pose); pose.endpoints.leftHand = { x: .99, y: .05 };
    expect(validateReach(project, pose, 'leftHand').ok).toBe(false);
  });
});
