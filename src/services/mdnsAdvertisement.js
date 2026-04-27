const logger = require('../utils/logger');

/**
 * Advertise HTTP service on LAN (UDP mDNS). Requires multicast (Docker often needs host network).
 * @param {{ mdns: { enabled: boolean, hostname: string }, port: number }} opts
 * @returns {{ stop: () => void }}
 */
function startMdnsAdvertisement(opts) {
  const { mdns, port } = opts;
  const noop = () => {};
  if (!mdns?.enabled) {
    return { stop: noop };
  }
  let bonjour;
  let service;
  try {
    // CJS: package exports { Bonjour, default }; `require()` is not the class itself.
    const { Bonjour: BonjourClass } = require('bonjour-service');
    bonjour = new BonjourClass();
    const rawName = (mdns.hostname || 'raid-app').trim() || 'raid-app';
    const name = rawName.replace(/[^a-zA-Z0-9-]/g, '-').slice(0, 63) || 'raid-app';
    service = bonjour.publish({
      name,
      type: 'http',
      port: Number(port) || 3000,
    });
    logger.info('mDNS advertisement started', {
      instance: name,
      hint: `Other hosts may resolve ${name}.local (port ${port})`,
    });
  } catch (error) {
    logger.error('mDNS advertisement failed to start', { error: error.message });
    return { stop: noop };
  }

  return {
    stop: () => {
      try {
        service?.stop?.();
      } catch {
        /* ignore */
      }
      try {
        bonjour?.destroy?.();
      } catch {
        /* ignore */
      }
    },
  };
}

module.exports = { startMdnsAdvertisement };
