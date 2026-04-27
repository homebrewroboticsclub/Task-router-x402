/**
 * Operator HTTP proxy to the robot dataset REST server (LAN port 9191 by default).
 * Mounted in `index.js` at **`/api/teleop`** before **`express.json()`** so large/streaming bodies are not consumed.
 * Full contract: [docs/RAID_APP_DATASET_PROXY_SPEC.md](../../../docs/RAID_APP_DATASET_PROXY_SPEC.md).
 *
 * @openapi
 * /api/teleop/robots/{robotId}/dataset/dataset_status:
 *   get:
 *     tags:
 *       - Teleop
 *     summary: Example — proxy GET to robot dataset server
 *     description: >
 *       Any path under **`/api/teleop/robots/{robotId}/dataset/`** is forwarded to the robot's dataset HTTP root
 *       (method, path after `dataset/`, and query string preserved). Other examples: `upload_dataset` (POST),
 *       `dataset_logs`, `dataset_download/{id}`, `dataset_delete`, `dataset_push`, `dataset_clear_all`.
 *       Upstream host: **`datasetHttpHost`** or robot **`host`**; port: **`datasetHttpPort`** or **9191**.
 *     security:
 *       - TeleoperatorCookie: []
 *       - TeleoperatorBearer: []
 *     parameters:
 *       - in: path
 *         name: robotId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     responses:
 *       200:
 *         description: Upstream response (pass-through).
 *       401:
 *         description: Missing or invalid teleoperator JWT.
 *       403:
 *         description: Robot has teleoperator grants and this operator has none for this robot.
 *       404:
 *         description: Robot not in registry.
 *       502:
 *         description: Cannot connect to upstream dataset HTTP server.
 *       504:
 *         description: Upstream timeout (see TELEOP_DATASET_PROXY_TIMEOUT_MS).
 *
 * @openapi
 * /api/teleop/robots/{robotId}/dataset/upload_dataset:
 *   post:
 *     tags:
 *       - Teleop
 *     summary: Example — proxy POST JSON to robot upload_dataset
 *     description: Body is streamed to the robot; do not rely on RAID validating JSON shape.
 *     security:
 *       - TeleoperatorCookie: []
 *       - TeleoperatorBearer: []
 *     parameters:
 *       - in: path
 *         name: robotId
 *         required: true
 *         schema:
 *           type: string
 *           format: uuid
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             additionalProperties: true
 *     responses:
 *       200:
 *         description: Upstream response.
 *       401:
 *         description: Unauthorized.
 *       403:
 *         description: Forbidden (grants).
 *       502:
 *         description: Bad gateway.
 *       504:
 *         description: Gateway timeout.
 */

module.exports = {};
