const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const path = require('path');
const request = require('supertest');
const {
  registerPublicBrandAssets,
  publicBrandAssetsExist,
} = require('../src/publicStaticRoutes');

test('GET /favicon.ico and GET /brand/hbr-mark.png when assets exist', async () => {
  const publicRoot = path.join(__dirname, '../public');
  assert.ok(
    publicBrandAssetsExist(publicRoot),
    'public/favicon.ico and public/brand/hbr-mark.png must exist (npm run build:brand)',
  );

  const app = express();
  registerPublicBrandAssets(app, publicRoot, null);

  const fav = await request(app).get('/favicon.ico').expect(200);
  assert.match(String(fav.headers['content-type'] || ''), /icon|octet-stream/i);
  assert.ok(Buffer.isBuffer(fav.body) || fav.body instanceof Uint8Array || typeof fav.body === 'object');
  assert.ok(
    (fav.body?.length ?? fav.text?.length ?? 0) > 8,
    'expected non-trivial favicon payload',
  );

  const mark = await request(app).get('/brand/hbr-mark.png').expect(200);
  assert.match(String(mark.headers['content-type'] || ''), /image\/png/i);
  assert.ok((mark.body?.length ?? 0) > 32, 'expected PNG payload');
});
