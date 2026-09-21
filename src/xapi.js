/** xAPI 1.0.3 statements for the learner's own activity. Kept in the browser; exportable as a JSON array an LRS would accept. */

export const VERBS = {
  launched: 'http://adlnet.gov/expapi/verbs/launched',
  experienced: 'http://adlnet.gov/expapi/verbs/experienced',
  attempted: 'http://adlnet.gov/expapi/verbs/attempted',
  answered: 'http://adlnet.gov/expapi/verbs/answered',
  passed: 'http://adlnet.gov/expapi/verbs/passed',
  failed: 'http://adlnet.gov/expapi/verbs/failed',
  completed: 'http://adlnet.gov/expapi/verbs/completed'
};
export const TYPES = {
  course: 'http://adlnet.gov/expapi/activities/course',
  module: 'http://adlnet.gov/expapi/activities/module',
  lesson: 'http://adlnet.gov/expapi/activities/lesson',
  assessment: 'http://adlnet.gov/expapi/activities/assessment',
  question: 'http://adlnet.gov/expapi/activities/question'
};

export function uuid(random = Math.random) {
  const h = '0123456789abcdef';
  let s = '';
  for (let i = 0; i < 36; i += 1) {
    if (i === 8 || i === 13 || i === 18 || i === 23) s += '-';
    else if (i === 14) s += '4';
    else if (i === 19) s += h[8 + Math.floor(random() * 4)];
    else s += h[Math.floor(random() * 16)];
  }
  return s;
}

export function statement({ actor, verb, objectId, name, type, result, timestamp, random }) {
  if (!VERBS[verb]) throw new Error(`unknown verb "${verb}"`);
  if (!objectId || !name || !type) throw new Error('statement needs objectId, name and type');
  const st = {
    id: uuid(random),
    actor: { objectType: 'Agent', account: { homePage: actor.homePage, name: actor.name } },
    verb: { id: VERBS[verb], display: { 'en-US': verb } },
    object: { objectType: 'Activity', id: objectId, definition: { name: { 'en-US': name }, type } },
    timestamp,
    version: '1.0.3'
  };
  if (result) st.result = result;
  return st;
}

/** Validates the shape an LRS checks first: id, actor, verb IRI, object id, timestamp, version. */
export function validateStatement(st) {
  const p = [];
  if (!/^[0-9a-f-]{36}$/.test(st.id ?? '')) p.push('id must be a UUID');
  if (st.actor?.objectType !== 'Agent' || !st.actor.account?.name) p.push('actor must be an Agent with an account');
  if (!/^https?:\/\//.test(st.verb?.id ?? '')) p.push('verb.id must be an IRI');
  if (!st.object?.id) p.push('object.id is required');
  if (Number.isNaN(Date.parse(st.timestamp ?? ''))) p.push('timestamp must be ISO 8601');
  if (st.version !== '1.0.3') p.push('version must be 1.0.3');
  if (st.result?.score && !(st.result.score.scaled >= -1 && st.result.score.scaled <= 1)) p.push('result.score.scaled must be -1..1');
  return p;
}
