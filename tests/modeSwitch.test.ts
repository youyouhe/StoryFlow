import { describe, it, expect } from 'vitest';
import { checkModeSwitch, hasProFeatureData } from '../utils/modeSwitch';

describe('hasProFeatureData', () => {
  it('detects proAudio / voiceCast presence', () => {
    expect(hasProFeatureData({})).toBe(false);
    expect(hasProFeatureData({ proAudio: {}, voiceCast: {} })).toBe(false); // empty objects don't count
    expect(hasProFeatureData({ proAudio: { seg1: { tts: [] } } })).toBe(true);
    expect(hasProFeatureData({ voiceCast: { 张三: 'tongtong' } })).toBe(true);
  });
});

describe('checkModeSwitch — rule 1: Pro → Express forbidden', () => {
  it('blocks the downgrade with the pro-features reason', () => {
    const r = checkModeSwitch('simple', 'cinematic', false);
    expect(r.allowed).toBe(false);
    expect(r.reasonCode).toBe('pro-features');
    expect(r.needsConfirm).toBe(false);
  });
});

describe('checkModeSwitch — rule 2: Express → Pro needs confirmation', () => {
  it('allows the upgrade but requires the AskDialog', () => {
    const r = checkModeSwitch('cinematic', 'simple', false);
    expect(r.allowed).toBe(true);
    expect(r.needsConfirm).toBe(true);
    expect(r.reasonCode).toBeUndefined();
  });

  it('setting Pro while already Pro is a no-op', () => {
    const r = checkModeSwitch('cinematic', 'cinematic', false);
    expect(r.allowed).toBe(true);
    expect(r.needsConfirm).toBe(false);
  });
});

describe('checkModeSwitch — rule 3: carried Pro data locks the door', () => {
  it('blocks set-to-Express even when the current mode is already Express', () => {
    const r = checkModeSwitch('simple', 'simple', true);
    expect(r.allowed).toBe(false);
    expect(r.reasonCode).toBe('pro-data');
  });

  it('the pro-data reason wins over the generic one', () => {
    const r = checkModeSwitch('simple', 'cinematic', true);
    expect(r.allowed).toBe(false);
    expect(r.reasonCode).toBe('pro-data');
  });
});
