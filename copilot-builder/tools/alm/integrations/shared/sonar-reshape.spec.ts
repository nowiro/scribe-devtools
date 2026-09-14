/**
 * Unit tests — the Sonar reshapes: issues (including MQR mode) and hotspots.
 */
import { describe, expect, it } from 'vitest';

import { reshapeHotspot, reshapeSonarIssue } from './sonar-reshape.js';

describe('reshapeSonarIssue MQR fields', () => {
  it('preserves impacts[] + cleanCodeAttribute when the instance runs MQR mode', () => {
    const out = reshapeSonarIssue({
      key: 'AY-1',
      rule: 'java:S1',
      severity: 'MAJOR',
      type: 'CODE_SMELL',
      status: 'OPEN',
      cleanCodeAttribute: 'CLEAR',
      cleanCodeAttributeCategory: 'INTENTIONAL',
      impacts: [
        { softwareQuality: 'MAINTAINABILITY', severity: 'HIGH' },
        { softwareQuality: 'RELIABILITY', severity: 'LOW' },
      ],
    });
    expect(out.impacts).toEqual([
      { softwareQuality: 'MAINTAINABILITY', severity: 'HIGH' },
      { softwareQuality: 'RELIABILITY', severity: 'LOW' },
    ]);
    expect(out.cleanCodeAttribute).toBe('CLEAR');
    expect(out.cleanCodeAttributeCategory).toBe('INTENTIONAL');
  });

  it('omits impacts entirely on a legacy (Standard Experience) issue', () => {
    const out = reshapeSonarIssue({ key: 'AY-2', rule: 'java:S2', severity: 'MINOR', type: 'BUG', status: 'OPEN' });
    expect('impacts' in out).toBe(false);
    expect('cleanCodeAttribute' in out).toBe(false);
    expect(out).toMatchObject({ severity: 'MINOR', type: 'BUG' }); // legacy fallback intact
  });

  it('drops malformed impact entries missing softwareQuality or severity', () => {
    const out = reshapeSonarIssue({
      key: 'AY-3',
      impacts: [{ softwareQuality: 'SECURITY' }, { severity: 'HIGH' }] as never,
    });
    expect('impacts' in out).toBe(false);
  });
});

describe('reshapeHotspot MQR fields', () => {
  it('preserves impacts[] alongside the classic security fields', () => {
    const out = reshapeHotspot({
      key: 'HS-1',
      status: 'TO_REVIEW',
      vulnerabilityProbability: 'HIGH',
      impacts: [{ softwareQuality: 'SECURITY', severity: 'HIGH' }],
    });
    expect(out.vulnerabilityProbability).toBe('HIGH');
    expect(out.impacts).toEqual([{ softwareQuality: 'SECURITY', severity: 'HIGH' }]);
  });
});
