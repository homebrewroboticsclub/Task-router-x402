const { test } = require('node:test');
const assert = require('node:assert/strict');
const { swaggerSpec } = require('../src/docs/swagger');

test('OpenAPI servers[0] is relative so Swagger Try it out uses current host', () => {
  assert.ok(Array.isArray(swaggerSpec.servers) && swaggerSpec.servers.length > 0);
  assert.equal(
    swaggerSpec.servers[0].url,
    '/',
    'fixed http://localhost:3000 breaks /docs opened via LAN IP',
  );
});

test('OpenAPI defines RobotTeleopHelpRequest with situation_report', () => {
  const schema = swaggerSpec.components.schemas.RobotTeleopHelpRequest;
  assert.ok(schema);
  assert.ok(schema.required.includes('message'));
  assert.ok(schema.properties.metadata.properties.situation_report);
  assert.ok(schema.properties.metadata.properties.kyr_peaq_context);
});

test('OpenAPI defines PeaqClaim and GET /api/robots/{robotId}/peaq/claim', () => {
  const peaqClaim = swaggerSpec.components.schemas.PeaqClaim;
  assert.ok(peaqClaim);
  assert.ok(peaqClaim.properties.raid_peaq_read_status);
  assert.ok(peaqClaim.properties.raid_peaq_error);
  assert.ok(swaggerSpec.paths['/api/robots/{robotId}/peaq/claim']);
  assert.ok(swaggerSpec.paths['/api/robots/{robotId}/peaq/claim'].get);
});

test('OpenAPI documents GET /api/robots/{robotId}/teleop/session-grant', () => {
  const p = swaggerSpec.paths['/api/robots/{robotId}/teleop/session-grant'];
  assert.ok(p && p.get, 'session-grant route must be in swagger');
});

test('OpenAPI documents teleoperator JWT lifetime and where it is required', () => {
  const teleopTag = swaggerSpec.tags.find((t) => t.name === 'Teleoperator');
  assert.ok(teleopTag);
  assert.match(teleopTag.description, /7 days/i);
  assert.match(teleopTag.description, /TELEOPERATOR_JWT_EXPIRES_IN/);
  assert.match(teleopTag.description, /\/api\/teleoperator\/me/);

  const bearer = swaggerSpec.components.securitySchemes.TeleoperatorBearer;
  assert.match(bearer.description, /help-requests/);
  assert.match(bearer.description, /7d/);

  const authSchema = swaggerSpec.components.schemas.TeleoperatorAuthResponse;
  assert.match(authSchema.properties.accessToken.description, /exp/);
});
