const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { buildRosbridgeWebSocketTarget } = require('../src/ws/teleopServer');

describe('buildRosbridgeWebSocketTarget', () => {
  const user = { id: 'abc-123', login: 'alice' };

  it('adds operator id in headers and query by default', () => {
    const { url, wsOptions } = buildRosbridgeWebSocketTarget({
      rosHost: '192.168.1.5',
      rosPort: 9090,
      user,
      teleopCfg: { forwardOperatorHeaders: true, forwardOperatorQuery: true },
    });
    assert.ok(url.includes('teleoperator_id=abc-123'));
    assert.ok(url.includes('teleoperator_login=alice'));
    assert.equal(wsOptions.headers['X-Teleoperator-Id'], 'abc-123');
    assert.equal(wsOptions.headers['X-Teleoperator-Login'], 'alice');
  });

  it('omits login header and query param when login missing', () => {
    const { url, wsOptions } = buildRosbridgeWebSocketTarget({
      rosHost: 'h',
      rosPort: 1,
      user: { id: 'x' },
      teleopCfg: { forwardOperatorHeaders: true, forwardOperatorQuery: true },
    });
    assert.ok(url.includes('teleoperator_id=x'));
    assert.ok(!url.includes('teleoperator_login'));
    assert.equal(wsOptions.headers['X-Teleoperator-Id'], 'x');
    assert.ok(!('X-Teleoperator-Login' in wsOptions.headers));
  });

  it('disables both → plain url and no ws options', () => {
    const { url, wsOptions } = buildRosbridgeWebSocketTarget({
      rosHost: 'h',
      rosPort: 9090,
      user,
      teleopCfg: { forwardOperatorHeaders: false, forwardOperatorQuery: false },
    });
    assert.equal(url, 'ws://h:9090');
    assert.equal(wsOptions, null);
  });

  it('query only when headers off', () => {
    const { url, wsOptions } = buildRosbridgeWebSocketTarget({
      rosHost: 'h',
      rosPort: 9090,
      user,
      teleopCfg: { forwardOperatorHeaders: false, forwardOperatorQuery: true },
    });
    assert.ok(url.includes('?'));
    assert.equal(wsOptions, null);
  });

  it('headers only when query off', () => {
    const { url, wsOptions } = buildRosbridgeWebSocketTarget({
      rosHost: 'h',
      rosPort: 9090,
      user,
      teleopCfg: { forwardOperatorHeaders: true, forwardOperatorQuery: false },
    });
    assert.equal(url, 'ws://h:9090');
    assert.equal(wsOptions.headers['X-Teleoperator-Id'], 'abc-123');
  });
});
