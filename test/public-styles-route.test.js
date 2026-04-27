const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('path');
const request = require('supertest');
const { registerPublicTailwindCss, publicStylesExists } = require('../src/publicStaticRoutes');

test('GET /styles.css returns text/css when public/styles.css exists', async () => {
  const publicRoot = path.join(__dirname, '../public');
  assert.ok(publicStylesExists(publicRoot), 'public/styles.css must exist (npm run build:css)');

  const app = express();
  registerPublicTailwindCss(app, publicRoot, null);

  const res = await request(app).get('/styles.css').expect(200);
  assert.match(String(res.headers['content-type'] || ''), /text\/css/i);
  assert.ok(res.text.length > 100, 'expected non-trivial CSS bundle');
});
