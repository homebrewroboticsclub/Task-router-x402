const { test } = require('node:test');
const assert = require('node:assert/strict');
const servicesRegistrationStore = require('../src/services/servicesRegistrationStore');

test('rotateFleetEnrollmentSecretInFile refuses when env fleet secret is set', () => {
  assert.throws(
    () =>
      servicesRegistrationStore.rotateFleetEnrollmentSecretInFile({
        robots: { fleetEnrollmentSecret: 'from-env' },
      }),
    /ROBOT_FLEET_ENROLLMENT_SECRET/,
  );
});

test('rotateRaidToRobotSecretInFile refuses when env raid secret is set', () => {
  assert.throws(
    () =>
      servicesRegistrationStore.rotateRaidToRobotSecretInFile({
        robots: { raidToRobotSecret: 'from-env' },
      }),
    /RAID_TO_ROBOT_SECRET/,
  );
});
