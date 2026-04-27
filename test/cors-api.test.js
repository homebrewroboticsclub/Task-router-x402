const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cors = require('cors');
const request = require('supertest');

test('CORS preflight reflects Origin and allows Authorization', async () => {
  const app = express();
  app.use(
    cors({
      origin: true,
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: [
        'Content-Type',
        'Authorization',
        'X-Requested-With',
        'X-Robot-Teleop-Secret',
        'X-Robot-Fleet-Secret',
      ],
    }),
  );
  app.post('/api/teleoperator/login', (req, res) => {
    res.json({ ok: true });
  });

  const res = await request(app)
    .options('/api/teleoperator/login')
    .set('Origin', 'https://app.example')
    .set('Access-Control-Request-Method', 'POST')
    .set('Access-Control-Request-Headers', 'content-type,authorization');

  assert.ok([200, 204].includes(res.status), `unexpected status ${res.status}`);
  assert.equal(res.headers['access-control-allow-origin'], 'https://app.example');
  assert.match(String(res.headers['access-control-allow-headers'] || ''), /authorization/i);
});
