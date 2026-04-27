/**
 * @param {import('pg').Pool} pool
 * @param {{ robotId: string, payload?: object|null }} input
 * @returns {Promise<{ row: object, duplicate: boolean }>}
 */
async function createHelpRequest(pool, { robotId, payload }) {
  try {
    const r = await pool.query(
      `INSERT INTO help_requests (robot_id, status, payload)
       VALUES ($1, 'open', $2)
       RETURNING id, robot_id, status, payload, created_at, claimed_by, claimed_at, peaq_claim`,
      [robotId, payload ?? null],
    );
    return { row: r.rows[0], duplicate: false };
  } catch (error) {
    if (error.code === '23505') {
      const existing = await pool.query(
        `SELECT id, robot_id, status, payload, created_at, claimed_by, claimed_at, peaq_claim
         FROM help_requests WHERE robot_id = $1 AND status = 'open' LIMIT 1`,
        [robotId],
      );
      if (existing.rows[0]) {
        return { row: existing.rows[0], duplicate: true };
      }
    }
    throw error;
  }
}

/**
 * @param {import('pg').Pool} pool
 */
async function listOpenHelpRequests(pool) {
  const r = await pool.query(
    `SELECT id, robot_id, status, payload, created_at, claimed_by, claimed_at
     FROM help_requests WHERE status = 'open' ORDER BY created_at ASC`,
  );
  return r.rows;
}

/**
 * Open help requests visible to this teleoperator: all robots without any active grant,
 * plus robots where this teleoperator has an active grant.
 * @param {import('pg').Pool} pool
 * @param {string} teleoperatorId
 */
async function listOpenHelpRequestsForTeleoperator(pool, teleoperatorId) {
  const r = await pool.query(
    `SELECT hr.id, hr.robot_id, hr.status, hr.payload, hr.created_at, hr.claimed_by, hr.claimed_at
     FROM help_requests hr
     WHERE hr.status = 'open'
       AND (
         NOT EXISTS (
           SELECT 1 FROM teleoperator_robot_grants g
           WHERE g.robot_id = hr.robot_id::uuid AND g.revoked_at IS NULL
         )
         OR EXISTS (
           SELECT 1 FROM teleoperator_robot_grants g
           WHERE g.robot_id = hr.robot_id::uuid
             AND g.teleoperator_id = $1::uuid
             AND g.revoked_at IS NULL
         )
       )
     ORDER BY hr.created_at ASC`,
    [teleoperatorId],
  );
  return r.rows;
}

/**
 * @param {import('pg').Pool} pool
 * @param {string} requestId
 * @returns {Promise<{ id: string, robot_id: string } | null>}
 */
async function getOpenHelpRequestMeta(pool, requestId) {
  const r = await pool.query(
    `SELECT id, robot_id FROM help_requests WHERE id = $1 AND status = 'open'`,
    [requestId],
  );
  return r.rows[0] || null;
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ requestId: string, teleoperatorId: string }} input
 * @returns {Promise<{ helpRequest: object, session: object } | null>}
 */
async function acceptHelpRequest(pool, { requestId, teleoperatorId }) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const u = await client.query(
      `UPDATE help_requests
       SET status = 'claimed', claimed_by = $1, claimed_at = NOW()
       WHERE id = $2 AND status = 'open'
       RETURNING id, robot_id, status, payload, created_at, claimed_by, claimed_at`,
      [teleoperatorId, requestId],
    );
    if (u.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }
    const hr = u.rows[0];
    const s = await client.query(
      `INSERT INTO teleop_sessions (help_request_id, teleoperator_id, robot_id)
       VALUES ($1, $2, $3)
       RETURNING id, help_request_id, teleoperator_id, robot_id, created_at, ended_at`,
      [hr.id, teleoperatorId, hr.robot_id],
    );
    await client.query('COMMIT');
    return { helpRequest: hr, session: s.rows[0] };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ sessionId: string, teleoperatorId: string }} input
 */
async function getActiveSessionForOperator(pool, { sessionId, teleoperatorId }) {
  const r = await pool.query(
    `SELECT ts.id, ts.help_request_id, ts.teleoperator_id, ts.robot_id, ts.created_at, ts.ended_at
     FROM teleop_sessions ts
     WHERE ts.id = $1 AND ts.teleoperator_id = $2 AND ts.ended_at IS NULL`,
    [sessionId, teleoperatorId],
  );
  return r.rows[0] || null;
}

/**
 * Ends proxy session and marks help request closed.
 * @param {import('pg').Pool} pool
 * @param {string} sessionId
 */
async function endTeleopSession(pool, sessionId) {
  const r = await pool.query(
    `UPDATE teleop_sessions SET ended_at = NOW()
     WHERE id = $1 AND ended_at IS NULL
     RETURNING help_request_id`,
    [sessionId],
  );
  if (r.rowCount === 0) {
    return false;
  }
  const helpRequestId = r.rows[0].help_request_id;
  await pool.query(
    `UPDATE help_requests SET status = 'closed' WHERE id = $1 AND status IN ('claimed', 'open')`,
    [helpRequestId],
  );
  return true;
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ helpRequestId: string, claim: object }} input
 */
async function updateHelpRequestPeaqClaim(pool, { helpRequestId, claim }) {
  await pool.query(`UPDATE help_requests SET peaq_claim = $2 WHERE id = $1::uuid`, [
    helpRequestId,
    claim,
  ]);
}

/**
 * Help request row for robot claim fetch (any status; must match robot_id).
 * @param {import('pg').Pool} pool
 * @param {{ helpRequestId: string, robotId: string }} input
 * @returns {Promise<{ peaq_claim: object | null } | null>}
 */
async function getHelpRequestForRobotClaim(pool, { helpRequestId, robotId }) {
  const r = await pool.query(
    `SELECT peaq_claim FROM help_requests WHERE id = $1::uuid AND robot_id = $2`,
    [helpRequestId, robotId],
  );
  return r.rows[0] || null;
}

/**
 * @param {import('pg').Pool} pool
 * @param {{ helpRequestId: string, payload: string, signature: string }} input
 */
async function setHelpRequestTeleopGrant(pool, { helpRequestId, payload, signature }) {
  await pool.query(
    `UPDATE help_requests
     SET teleop_grant_payload = $2, teleop_grant_signature = $3
     WHERE id = $1::uuid`,
    [helpRequestId, payload, signature],
  );
}

/**
 * Signed SessionGrant for robot (KYR), after an operator has claimed the request.
 * @param {import('pg').Pool} pool
 * @param {{ helpRequestId: string, robotId: string }} input
 * @returns {Promise<{ status: string, teleop_grant_payload: string | null, teleop_grant_signature: string | null } | null>}
 */
async function getTeleopSessionGrantForRobot(pool, { helpRequestId, robotId }) {
  const r = await pool.query(
    `SELECT status, teleop_grant_payload, teleop_grant_signature
     FROM help_requests WHERE id = $1::uuid AND robot_id = $2`,
    [helpRequestId, robotId],
  );
  return r.rows[0] || null;
}

/**
 * Operator Solana pubkey at claim time (for signing grant in route).
 * @param {import('pg').Pool} pool
 * @param {string} teleoperatorId
 */
async function getTeleoperatorWalletPublicKey(pool, teleoperatorId) {
  const r = await pool.query(
    `SELECT wallet_public_key FROM teleoperators WHERE id = $1::uuid`,
    [teleoperatorId],
  );
  return r.rows[0]?.wallet_public_key || null;
}

module.exports = {
  createHelpRequest,
  listOpenHelpRequests,
  listOpenHelpRequestsForTeleoperator,
  getOpenHelpRequestMeta,
  acceptHelpRequest,
  getActiveSessionForOperator,
  endTeleopSession,
  updateHelpRequestPeaqClaim,
  getHelpRequestForRobotClaim,
  setHelpRequestTeleopGrant,
  getTeleopSessionGrantForRobot,
  getTeleoperatorWalletPublicKey,
};
