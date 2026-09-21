import { describe, expect, it } from 'vitest';
import { statement, TYPES, uuid, validateStatement, VERBS } from '../src/xapi.js';

describe('xAPI statements', () => {
  it('builds a valid 1.0.3 statement with ADL verb and activity IRIs', () => {
    const st = statement({ actor: { homePage: 'https://example.org', name: 'learner-1' }, verb: 'passed', objectId: 'https://example.org/course/m1-quiz', name: 'Check: service models', type: TYPES.assessment, result: { success: true, score: { scaled: 0.75, raw: 3, max: 4 } }, timestamp: '2026-09-01T10:20:00Z', random: () => 0.5 });
    expect(validateStatement(st)).toEqual([]);
    expect(st.verb.id).toBe(VERBS.passed);
    expect(st.object.definition.type).toBe('http://adlnet.gov/expapi/activities/assessment');
    expect(st.version).toBe('1.0.3');
    expect(st.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
  it('rejects unknown verbs and missing fields', () => {
    expect(() => statement({ actor: {}, verb: 'liked', objectId: 'x', name: 'x', type: 'x' })).toThrow(/unknown verb/);
    expect(() => statement({ actor: {}, verb: 'passed', objectId: '', name: 'x', type: 'x' })).toThrow(/needs objectId/);
  });
  it('validateStatement names each defect', () => {
    const p = validateStatement({ id: 'nope', actor: { objectType: 'Group' }, verb: { id: 'passed' }, object: {}, timestamp: 'yesterday', version: '1.0.0', result: { score: { scaled: 2 } } });
    expect(p).toEqual(['id must be a UUID', 'actor must be an Agent with an account', 'verb.id must be an IRI', 'object.id is required', 'timestamp must be ISO 8601', 'version must be 1.0.3', 'result.score.scaled must be -1..1']);
  });
  it('uuid is v4-shaped and distinct', () => {
    const a = uuid();
    const b = uuid();
    expect(a).not.toBe(b);
    expect(a[14]).toBe('4');
    expect('89ab').toContain(a[19]);
  });
});
