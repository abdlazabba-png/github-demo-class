import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkOcrMismatch,
  checkPlausibility,
  checkDuplicate,
  worstSeverity,
  validateSubmission,
} from '../src/validation/validate.js';

describe('checkOcrMismatch', () => {
  it('is info-severity when there is no OCR reading to compare against', () => {
    const result = checkOcrMismatch({ APC: 100 }, {});
    assert.strictEqual(result.severity, 'info');
  });

  it('is ok when manual entry matches the OCR reading exactly', () => {
    const result = checkOcrMismatch({ APC: 100, PDP: 50 }, { APC: 100, PDP: 50 });
    assert.strictEqual(result.severity, 'ok');
  });

  it('flags a warning and names the mismatching parties', () => {
    const result = checkOcrMismatch({ APC: 100, PDP: 50 }, { APC: 90, PDP: 50 });
    assert.strictEqual(result.severity, 'warning');
    assert.deepStrictEqual(result.parties, ['APC']);
  });

  it('compares numerically, not by string/type', () => {
    const result = checkOcrMismatch({ APC: 100 }, { APC: '100' });
    assert.strictEqual(result.severity, 'ok');
  });
});

describe('checkPlausibility', () => {
  it('is unknown when registered-voter count is unavailable', () => {
    const result = checkPlausibility({ APC: 100 }, null);
    assert.strictEqual(result.severity, 'unknown');
  });

  it('errors when total votes exceed registered voters', () => {
    const result = checkPlausibility({ APC: 300, PDP: 300 }, 500);
    assert.strictEqual(result.severity, 'error');
    assert.strictEqual(result.totalVotes, 600);
  });

  it('warns on unusually high but not impossible turnout', () => {
    const result = checkPlausibility({ APC: 460 }, 500); // 92%
    assert.strictEqual(result.severity, 'warning');
  });

  it('is ok for a normal turnout', () => {
    const result = checkPlausibility({ APC: 200, PDP: 100 }, 500); // 60%
    assert.strictEqual(result.severity, 'ok');
  });

  it('treats exactly 100% turnout as plausible, not an error', () => {
    const result = checkPlausibility({ APC: 500 }, 500);
    assert.strictEqual(result.severity, 'warning'); // still flagged, just not an error
    assert.notStrictEqual(result.severity, 'error');
  });
});

describe('checkDuplicate', () => {
  it('is ok for the first submission at a polling unit', () => {
    const result = checkDuplicate('GM-A/W1/001', []);
    assert.strictEqual(result.severity, 'ok');
  });

  it('errors when a prior submission already exists for the same PU', () => {
    const result = checkDuplicate('GM-A/W1/001', ['GM-A/W1/002', 'GM-A/W1/001']);
    assert.strictEqual(result.severity, 'error');
    assert.strictEqual(result.priorCount, 1);
  });

  it('does not flag submissions from other polling units', () => {
    const result = checkDuplicate('GM-A/W1/001', ['GM-A/W1/002', 'GM-A/W1/003']);
    assert.strictEqual(result.severity, 'ok');
  });
});

describe('worstSeverity', () => {
  it('picks error over warning over unknown/info over ok', () => {
    assert.strictEqual(worstSeverity([{ severity: 'ok' }, { severity: 'warning' }]), 'warning');
    assert.strictEqual(worstSeverity([{ severity: 'error' }, { severity: 'warning' }]), 'error');
    assert.strictEqual(worstSeverity([{ severity: 'unknown' }, { severity: 'info' }]), 'unknown');
    assert.strictEqual(worstSeverity([{ severity: 'ok' }]), 'ok');
  });
});

describe('validateSubmission', () => {
  it('aggregates all three checks and surfaces the worst severity', () => {
    const { checks, overallSeverity } = validateSubmission({
      partyVotes: { APC: 100 },
      ocrVotes: { APC: 100 },
      registeredVoters: 500,
      puCode: 'GM-A/W1/001',
      priorPuCodes: ['GM-A/W1/001'], // duplicate -> error, should dominate
    });
    assert.strictEqual(checks.length, 3);
    assert.strictEqual(overallSeverity, 'error');
  });

  it('is fully ok when nothing is wrong', () => {
    const { overallSeverity } = validateSubmission({
      partyVotes: { APC: 100, PDP: 100 },
      ocrVotes: { APC: 100, PDP: 100 },
      registeredVoters: 500,
      puCode: 'GM-A/W1/001',
      priorPuCodes: [],
    });
    assert.strictEqual(overallSeverity, 'ok');
  });
});
