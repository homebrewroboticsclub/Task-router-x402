const { constantTimeCompare, readFleetCredential } = require('../utils/secretCompare');
const { hasValidSessionCookie, hasValidBasicAuth } = require('./adminAuth');

/**
 * Admin session (cookie/Basic) or matching fleet enrollment secret.
 * @param {{ fleetEnrollmentSecret: string|null, adminConfig: object }} opts
 */
function createRequireFleetOrAdmin(opts) {
  const { fleetEnrollmentSecret, adminConfig } = opts;
  return (req, res, next) => {
    if (
      adminConfig
      && (hasValidSessionCookie(req, adminConfig) || hasValidBasicAuth(req, adminConfig))
    ) {
      return next();
    }
    if (fleetEnrollmentSecret) {
      const got = readFleetCredential(req);
      if (constantTimeCompare(got, fleetEnrollmentSecret)) {
        return next();
      }
    }
    return res.status(401).json({
      error: 'Unauthorized: admin session or robot fleet credential required',
    });
  };
}

/**
 * Only fleet enrollment secret (no admin bypass). Used for self-enroll.
 * @param {{ fleetEnrollmentSecret: string|null }} opts
 */
function createRequireFleetEnrollment(opts) {
  const { fleetEnrollmentSecret } = opts;
  return (req, res, next) => {
    if (!fleetEnrollmentSecret) {
      return res.status(503).json({
        error: 'Robot fleet enrollment is not configured (set ROBOT_FLEET_ENROLLMENT_SECRET)',
      });
    }
    const got = readFleetCredential(req);
    if (!constantTimeCompare(got, fleetEnrollmentSecret)) {
      return res.status(401).json({ error: 'Invalid or missing fleet credential' });
    }
    return next();
  };
}

module.exports = {
  createRequireFleetOrAdmin,
  createRequireFleetEnrollment,
  readFleetCredential,
};
