const express = require('express');

const createCommandsRouter = ({ commandRouter }) => {
  const router = express.Router();

  /**
   * @openapi
   * /api/commands/dance:
   *   post:
   *     tags:
   *       - Commands
   *     summary: Dispatch move_demo routine
   *     description: Selects the requested number of ready robots with move_demo capability and executes the routine, handling x402 payment handshake if required.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/DanceCommandRequest'
   *     responses:
   *       200:
   *         description: Command dispatch results with payment metadata when applicable.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
   *                 results:
   *                   type: array
   *                   items:
   *                     type: object
   *                     properties:
   *                       robotId:
   *                         type: string
   *                       status:
   *                         type: string
   *                         enum: [success, failed]
   *                       response:
   *                         type: object
   *                         nullable: true
   *                       payment:
   *                         type: object
   *                         nullable: true
   *                       error:
   *                         type: string
   *                         nullable: true
    *                 summary:
    *                   type: object
    *                   properties:
    *                     selectionStrategy:
    *                       type: string
    *                     markupPercent:
    *                       type: number
    *                     totalRobotCost:
    *                       type: number
    *                     suggestedPrice:
    *                       type: number
   *       400:
   *         description: Invalid quantity provided.
   *       409:
   *         description: Not enough robots with the required capability.
   */
  router.post('/dance', async (req, res, next) => {
    try {
      const { quantity, mode } = req.body;
      const result = await commandRouter.dance({ quantity, mode });
      return res.json(result);
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      return next(error);
    }
  });

  /**
   * @openapi
   * /api/commands/buy-cola:
   *   post:
   *     tags:
   *       - Commands
   *     summary: Dispatch buy cola task
   *     description: Finds the closest ready robot to the requested coordinates and sends the buy-cola command.
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/BuyColaCommandRequest'
   *     responses:
   *       200:
   *         description: Command dispatch outcome.
   *         content:
   *           application/json:
   *             schema:
   *               type: object
   *               properties:
    *                 result:
    *                   type: object
    *                   properties:
    *                     robotId:
    *                       type: string
    *                     status:
    *                       type: string
    *                       enum: [success, failed]
    *                     response:
    *                       type: object
    *                       nullable: true
    *                     error:
    *                       type: string
    *                       nullable: true
    *                     pricing:
    *                       type: object
    *                       nullable: true
    *                 summary:
    *                   type: object
    *                   properties:
    *                     selectionStrategy:
    *                       type: string
    *                     markupPercent:
    *                       type: number
    *                     baseAmount:
    *                       type: number
    *                       nullable: true
    *                     suggestedPrice:
    *                       type: number
    *                       nullable: true
   *       400:
   *         description: Invalid location or quantity.
   *       409:
   *         description: No ready robots to fulfil the request.
   *       422:
   *         description: Unable to determine closest robot.
   */
  router.post('/buy-cola', async (req, res, next) => {
    try {
      const { location, quantity } = req.body;
      const result = await commandRouter.buyCola({ location, quantity });
      return res.json(result);
    } catch (error) {
      if (error.statusCode) {
        return res.status(error.statusCode).json({ error: error.message });
      }
      return next(error);
    }
  });

  return router;
};

module.exports = createCommandsRouter;

