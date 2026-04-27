const path = require('path');
const fs = require('fs');
const express = require('express');

/**
 * Public Tailwind bundle used by /client, /teleoperator, and shared admin HTML that
 * links to /styles.css (not only /ui/styles.css).
 */
function registerPublicTailwindCss(app, publicRoot, logger) {
  app.get('/styles.css', (req, res) => {
    const file = path.join(publicRoot, 'styles.css');
    res.type('text/css');
    res.sendFile(file, (err) => {
      if (err) {
        if (logger?.warn) {
          logger.warn('styles.css not sent', { error: err.message });
        }
        res.status(503).type('text/plain').send('styles.css missing; run npm run build:css');
      }
    });
  });
}

function publicStylesPath(publicRoot) {
  return path.join(publicRoot, 'styles.css');
}

function publicStylesExists(publicRoot) {
  return fs.existsSync(publicStylesPath(publicRoot));
}

function publicBrandAssetsExist(publicRoot) {
  const favicon = path.join(publicRoot, 'favicon.ico');
  const mark = path.join(publicRoot, 'brand', 'hbr-mark.png');
  return fs.existsSync(favicon) && fs.existsSync(mark);
}

/**
 * Serves GET /favicon.ico and static files under /brand/* (PNG mark, touch icon).
 */
function registerPublicBrandAssets(app, publicRoot, logger) {
  const faviconFile = path.join(publicRoot, 'favicon.ico');
  const brandDir = path.join(publicRoot, 'brand');

  app.get('/favicon.ico', (req, res) => {
    res.type('image/x-icon');
    res.sendFile(faviconFile, (err) => {
      if (err) {
        if (logger?.warn) {
          logger.warn('favicon.ico not sent', { error: err.message });
        }
        res.status(503).type('text/plain').send('favicon missing; run npm run build:brand');
      }
    });
  });

  app.use('/brand', express.static(brandDir));
}

module.exports = {
  registerPublicTailwindCss,
  registerPublicBrandAssets,
  publicStylesPath,
  publicStylesExists,
  publicBrandAssetsExist,
};
