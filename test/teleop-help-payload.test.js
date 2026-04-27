const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  MAX_SITUATION_REPORT_BYTES,
  MAX_DATA_NODE_CORRELATION_ID_BYTES,
  MAX_KYR_PEAQ_CONTEXT_BYTES,
  normalizeRobotTeleopHelpBody,
  truncateUtf8,
  truncatePeaqClaimJson,
  KyrPeaqContextTooLargeError,
  KyrPeaqContextInvalidError,
} = require('../src/utils/teleopHelpPayload');

test('normalizeRobotTeleopHelpBody fills metadata strings and preserves extra keys', () => {
  const out = normalizeRobotTeleopHelpBody({
    message: 'Need assistance',
    metadata: { task_id: 't1', error_context: '', battery: 12 },
  });
  assert.equal(out.message, 'Need assistance');
  assert.equal(out.metadata.task_id, 't1');
  assert.equal(out.metadata.error_context, '');
  assert.equal(out.metadata.situation_report, '');
  assert.equal(out.metadata.dataset_id, '');
  assert.equal(out.metadata.kyr_session_id, '');
  assert.equal(out.metadata.kyr_robot_id, '');
  assert.equal(out.metadata.battery, 12);
});

test('normalizeRobotTeleopHelpBody omits situation_report key → empty string', () => {
  const out = normalizeRobotTeleopHelpBody({
    message: 'x',
    metadata: { task_id: 'a', error_context: 'err' },
  });
  assert.equal(out.metadata.situation_report, '');
});

test('normalizeRobotTeleopHelpBody missing metadata → empty standard fields', () => {
  const out = normalizeRobotTeleopHelpBody({ message: 'only' });
  assert.equal(out.metadata.task_id, '');
  assert.equal(out.metadata.error_context, '');
  assert.equal(out.metadata.situation_report, '');
  assert.equal(out.metadata.dataset_id, '');
  assert.equal(out.metadata.kyr_session_id, '');
  assert.equal(out.metadata.kyr_robot_id, '');
});

test('normalizeRobotTeleopHelpBody DATA_NODE correlation ids coerced to strings', () => {
  const out = normalizeRobotTeleopHelpBody({
    message: 'm',
    metadata: {
      task_id: '',
      error_context: '',
      dataset_id: 42,
      kyr_session_id: true,
      kyr_robot_id: 'bot-a',
    },
  });
  assert.equal(out.metadata.dataset_id, '42');
  assert.equal(out.metadata.kyr_session_id, 'true');
  assert.equal(out.metadata.kyr_robot_id, 'bot-a');
});

test('DATA_NODE correlation id truncated at MAX_DATA_NODE_CORRELATION_ID_BYTES', () => {
  const longId = 'x'.repeat(MAX_DATA_NODE_CORRELATION_ID_BYTES + 50);
  const out = normalizeRobotTeleopHelpBody({
    message: 'm',
    metadata: { task_id: '', error_context: '', dataset_id: longId },
  });
  assert.equal(Buffer.byteLength(out.metadata.dataset_id, 'utf8'), MAX_DATA_NODE_CORRELATION_ID_BYTES);
  assert.equal(out.metadata.kyr_session_id, '');
  assert.equal(out.metadata.kyr_robot_id, '');
});

test('truncateUtf8 does not split UTF-8 code point', () => {
  const s = 'ééé'; // U+00E9 → 2 bytes per char in UTF-8
  const t = truncateUtf8(s, 3);
  assert.equal(t, 'é');
  assert.equal(Buffer.byteLength(t, 'utf8'), 2);
});

test('situation_report truncated at MAX_SITUATION_REPORT_BYTES', () => {
  const report = 'a'.repeat(MAX_SITUATION_REPORT_BYTES + 100);
  const out = normalizeRobotTeleopHelpBody({
    message: 'm',
    metadata: { task_id: '', error_context: '', situation_report: report },
  });
  assert.equal(Buffer.byteLength(out.metadata.situation_report, 'utf8'), MAX_SITUATION_REPORT_BYTES);
});

test('kyr_peaq_context must be plain object', () => {
  assert.throws(
    () =>
      normalizeRobotTeleopHelpBody({
        message: 'm',
        metadata: { kyr_peaq_context: 'not-an-object' },
      }),
    KyrPeaqContextInvalidError,
  );
});

test('kyr_peaq_context over MAX_KYR_PEAQ_CONTEXT_BYTES throws', () => {
  const inner = 'y'.repeat(MAX_KYR_PEAQ_CONTEXT_BYTES + 2);
  assert.throws(
    () =>
      normalizeRobotTeleopHelpBody({
        message: 'm',
        metadata: { kyr_peaq_context: { inner } },
      }),
    KyrPeaqContextTooLargeError,
  );
});

test('truncatePeaqClaimJson shrinks oversized claim', () => {
  const huge = 'z'.repeat(80000);
  const claim = {
    schema_version: 1,
    network: 'peaq-agung',
    help_request_id: '550e8400-e29b-41d4-a716-446655440000',
    robot_id: '660e8400-e29b-41d4-a716-446655440000',
    issued_at_unix: 1,
    document: { id: 'did:peaq:x', controller: 'did:peaq:x', extra: huge },
    raw: { x: huge },
  };
  const out = truncatePeaqClaimJson(claim);
  assert.ok(Buffer.byteLength(JSON.stringify(out), 'utf8') <= 65536);
  assert.equal(out.schema_version, 1);
  assert.equal(out.network, 'peaq-agung');
});
