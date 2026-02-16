const axios = require('axios');
const logger = require('../utils/logger');

const LAMPORTS_PER_SOL = 1_000_000_000;
const DANCE_METHOD_IDENTIFIERS = ['/api/v1/robot/move_demo', '/commands/dance', 'move_demo'];

/**
 * Parse HTTP 402 body into a normalised invoice for settlement.
 * Supports x402 V2 (accepts[0]: payTo, amount, asset, extra.reference) and legacy flat shape.
 * @param {object} data - Response body of a 402 Payment Required
 * @returns {{ reference: string, receiver: string, amount: string|number, asset: string } | null}
 */
const parse402PaymentRequest = (data) => {
  if (!data || typeof data !== 'object') {
    return null;
  }
  // x402 V2: accepts[] with scheme, network, amount, payTo, maxTimeoutSeconds, asset, extra
  if (data.x402Version === 2 && Array.isArray(data.accepts) && data.accepts.length > 0) {
    const accept = data.accepts[0];
    const reference = accept?.extra?.reference;
    const payTo = accept?.payTo;
    const amount = accept?.amount;
    const asset = accept?.asset;
    if (reference && payTo && (amount !== undefined && amount !== null) && asset) {
      return {
        reference,
        receiver: payTo,
        amount,
        asset,
      };
    }
  }
  // Legacy: top-level reference, receiver, amount, asset
  const { reference, receiver, payTo, amount, asset } = data;
  const to = receiver || payTo;
  if (reference && to && (amount !== undefined && amount !== null) && asset) {
    return { reference, receiver: to, amount, asset };
  }
  return null;
};
const BUY_COLA_METHOD_IDENTIFIERS = [
  '/commands/buy-cola',
  '/api/v1/robot/buy-cola',
  'buy-cola',
  'x402_buy_service',
];

const createHttpError = (statusCode, message) => {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
};

const parseAmountValue = (value) => {
  if (value === undefined || value === null) {
    return null;
  }
  const numeric = Number(value);
  return Number.isNaN(numeric) ? null : numeric;
};

const matchIdentifier = (content, identifier) => {
  if (!content || !identifier) {
    return false;
  }
  return content.toLowerCase().includes(identifier.toLowerCase());
};

const methodMatches = (method, identifiers) => {
  if (!method) {
    return false;
  }
  const tokens = Array.isArray(identifiers) ? identifiers : [identifiers];
  if (typeof method === 'string') {
    return tokens.some((identifier) => matchIdentifier(method, identifier));
  }

  const path = method.path || '';
  const description = method.description || '';
  const callable = method.rosAction?.callable || '';

  return tokens.some(
    (identifier) => matchIdentifier(path, identifier)
      || matchIdentifier(description, identifier)
      || matchIdentifier(callable, identifier),
  );
};

const findMethodEntry = (robot, identifiers) => {
  const methods = robot.status?.availableMethods || [];
  return methods.find((method) => methodMatches(method, identifiers)) || null;
};

const getPricingAmount = (method) => {
  if (!method || typeof method === 'string') {
    return null;
  }
  return parseAmountValue(method.pricing?.amount);
};

const deriveBaseAmount = (settlement, invoice, methodAmountFallback) => {
  let amount = parseAmountValue(settlement?.amount);
  if (amount === null && settlement?.lamports !== undefined) {
    amount = settlement.lamports / LAMPORTS_PER_SOL;
  }
  if (amount === null) {
    amount = parseAmountValue(invoice?.amount);
  }
  if (amount === null) {
    amount = methodAmountFallback !== undefined ? parseAmountValue(methodAmountFallback) : null;
  }
  return amount;
};

const summarisePricing = (baseAmount, markupPercent) => {
  const parsed = parseAmountValue(baseAmount);
  if (parsed === null) {
    return null;
  }
  const multiplier = 1 + (Number(markupPercent) || 0) / 100;
  const suggested = parseFloat((parsed * multiplier).toFixed(6));
  return {
    baseAmount: parsed,
    markupPercent,
    suggestedPrice: suggested,
  };
};

const sortRobotsByPrice = (robots, identifiers, order = 'asc') => {
  const direction = order === 'desc' ? -1 : 1;
  return [...robots].sort((left, right) => {
    const leftPrice = getPricingAmount(findMethodEntry(left, identifiers));
    const rightPrice = getPricingAmount(findMethodEntry(right, identifiers));

    if (leftPrice === null && rightPrice === null) {
      return 0;
    }
    if (leftPrice === null) {
      return 1;
    }
    if (rightPrice === null) {
      return -1;
    }
    if (leftPrice === rightPrice) {
      return 0;
    }
    return leftPrice > rightPrice ? direction : -direction;
  });
};

const shuffleArray = (items) => {
  const clone = [...items];
  for (let index = clone.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [clone[index], clone[swapIndex]] = [clone[swapIndex], clone[index]];
  }
  return clone;
};

const calculateDistance = (a, b) => {
  if (!a || !b) {
    return Number.POSITIVE_INFINITY;
  }
  const dx = a.lat - b.lat;
  const dy = a.lng - b.lng;
  return Math.sqrt(dx * dx + dy * dy);
};

const delay = (ms) => new Promise((resolve) => {
  setTimeout(resolve, ms);
});

const createCommandRouter = ({ config, registry, x402Service }) => {
  const confirmationConfig = config.x402?.confirmation || {};
  const confirmMaxAttempts = Number.isInteger(confirmationConfig.maxAttempts)
    ? Math.max(1, confirmationConfig.maxAttempts)
    : 5;
  const confirmDelayMs = Number.isFinite(confirmationConfig.delayMs)
    ? Math.max(200, confirmationConfig.delayMs)
    : 2000;
  const commandConfig = config.commands || {};
  const pricingConfig = config.pricing || {};
  const danceConfig = commandConfig.dance || {};
  const buyColaConfig = commandConfig.buyCola || {};
  const markupPercentRaw = parseAmountValue(pricingConfig.markupPercent);
  const markupPercent = Number.isFinite(markupPercentRaw) ? markupPercentRaw : 10;
  const danceSelectionStrategy = (danceConfig.selectionStrategy || 'lowest_price').toLowerCase();
  const buyColaSelectionStrategy = (buyColaConfig.selectionStrategy || 'closest').toLowerCase();

  const robotSupportsMoveDemo = (robot) => {
    const methods = robot.status?.availableMethods || [];
    return methods.some((method) => {
      if (!method) {
        return false;
      }
      if (typeof method === 'string') {
        return method.toLowerCase().includes('move_demo');
      }

      const path = method.path || '';
      const description = method.description || '';
      const callable = method.rosAction?.callable || '';

      return (
        path.toLowerCase().includes('move_demo')
        || description.toLowerCase().includes('move demo')
        || callable.toLowerCase().includes('move_demo')
      );
    });
  };

  const driveCommand = async ({ robot, endpoint, payload, headers = {} }) => {
    const baseUrl = `http://${robot.host}:${robot.port}`;
    const url = `${baseUrl}${endpoint}`;
    const requestOptions = {
      url,
      method: 'POST',
      data: payload,
      timeout: config.robots.commandTimeoutMs,
      headers,
    };

    logger.info('Dispatching command to robot', {
      robotId: robot.id,
      endpoint,
      payload,
      headers,
    });

    const executor = robot.requiresX402
      ? () => x402Service.sendSecuredRequest(requestOptions)
      : () => axios(requestOptions);

    try {
      const response = await executor();
      logger.info('Robot response received', {
        robotId: robot.id,
        endpoint,
        status: response.status,
        data: response.data,
      });
      return response;
    } catch (error) {
      if (error.response) {
        logger.warn('Robot responded with error status', {
          robotId: robot.id,
          endpoint,
          status: error.response.status,
          data: error.response.data,
        });
        return error.response;
      }
      logger.error('Robot command request failed', {
        robotId: robot.id,
        endpoint,
        error: error.message,
      });
      throw error;
    }
  };

  const selectRobotsForDance = (requestedCount) => {
    let readyRobots = registry.getRobotsByState('ready').filter(robotSupportsMoveDemo);
    if (readyRobots.length === 0) {
      throw createHttpError(409, 'No ready robots with move_demo capability available');
    }

    switch (danceSelectionStrategy) {
      case 'lowest_price':
        readyRobots = sortRobotsByPrice(readyRobots, DANCE_METHOD_IDENTIFIERS, 'asc');
        break;
      case 'highest_price':
        readyRobots = sortRobotsByPrice(readyRobots, DANCE_METHOD_IDENTIFIERS, 'desc');
        break;
      case 'random':
        readyRobots = shuffleArray(readyRobots);
        break;
      default:
        break;
    }

    if (requestedCount === 'all') {
      return readyRobots;
    }

    const quantity = Number(requestedCount);
    if (![1, 2].includes(quantity)) {
      throw createHttpError(400, 'Dance quantity must be 1, 2, or "all"');
    }

    if (readyRobots.length < quantity) {
      throw createHttpError(
        409,
        `Not enough ready robots with move_demo capability (requested ${quantity}, available ${readyRobots.length})`,
      );
    }

    return readyRobots.slice(0, quantity);
  };

  const executeMoveDemo = async (robot) => {
    const endpoint = '/api/v1/robot/move_demo';
    const payload = {};
    const methodInfo = findMethodEntry(robot, DANCE_METHOD_IDENTIFIERS);
    const methodBaseAmount = getPricingAmount(methodInfo);
    const selectionMeta = {
      strategy: danceSelectionStrategy,
      price: methodBaseAmount,
    };

    const initialResponse = await driveCommand({
      robot,
      endpoint,
      payload,
    });

    if (initialResponse.status === 200) {
      return {
        status: 'success',
        stage: 'completed',
        response: initialResponse.data,
        invoice: null,
        payment: null,
        attempts: 0,
        pricing: summarisePricing(methodBaseAmount, markupPercent),
        selection: selectionMeta,
      };
    }

    if (!initialResponse) {
      return {
        status: 'failed',
        stage: 'initial',
        error: 'Robot did not respond to move demo command',
        invoice: null,
        payment: null,
        attempts: 0,
        pricing: summarisePricing(methodBaseAmount, markupPercent),
        selection: selectionMeta,
      };
    }

    if (initialResponse.status !== 402) {
      return {
        status: 'failed',
        stage: 'initial',
        error: initialResponse.data?.error || initialResponse.data?.message || 'Unexpected robot response',
        httpStatus: initialResponse.status,
        response: initialResponse.data,
        invoice: initialResponse.data || null,
        payment: null,
        attempts: 0,
        pricing: summarisePricing(methodBaseAmount, markupPercent),
        selection: selectionMeta,
      };
    }

    // x402 V2: payment details are in accepts[0] (reference in extra.reference, payTo, amount, asset)
    const invoice = parse402PaymentRequest(initialResponse.data);

    const reference = invoice?.reference;
    const receiver = invoice?.receiver;
    const amount = invoice?.amount;
    const asset = invoice?.asset;

    if (!reference || !receiver || asset === undefined || amount === undefined) {
      return {
        status: 'failed',
        stage: 'payment_initiation',
        error: 'Missing payment fields in robot 402 response (expected x402 V2 accepts[0] or legacy reference/receiver/amount/asset)',
        httpStatus: initialResponse.status,
        response: initialResponse.data,
        invoice: initialResponse.data || null,
        payment: null,
        attempts: 0,
        pricing: summarisePricing(methodBaseAmount, markupPercent),
        selection: selectionMeta,
      };
    }

    const normalisedInvoice = { reference, receiver, amount, asset };

    let settlement;
    try {
      settlement = await x402Service.settleInvoice(normalisedInvoice);
      logger.info('Payment settlement result', settlement);
    } catch (error) {
      return {
        status: 'failed',
        stage: 'payment_settlement',
        error: error.response?.data?.error || error.message || 'Payment settlement failed',
        httpStatus: error.response?.status,
        response: error.response?.data,
        invoice: normalisedInvoice,
        payment: null,
        attempts: 0,
        pricing: summarisePricing(deriveBaseAmount(null, normalisedInvoice, methodBaseAmount), markupPercent),
        selection: selectionMeta,
      };
    }

    let attempt = 0;
    let finalResponse = null;

    while (attempt < confirmMaxAttempts) {
      attempt += 1;
      const paymentResponse = await driveCommand({
        robot,
        endpoint,
        payload,
        headers: {
          'X-X402-Reference': reference,
        },
      });

      finalResponse = paymentResponse;

      if (paymentResponse) {
        logger.info('Payment confirmation attempt result', {
          attempt,
          status: paymentResponse.status,
          data: paymentResponse.data,
        });
      }

      if (!paymentResponse || paymentResponse.status === 200) {
        break;
      }

      if (paymentResponse.status !== 402) {
        break;
      }

      if (attempt < confirmMaxAttempts) {
        await delay(confirmDelayMs);
      }
    }

    const baseAmount = deriveBaseAmount(settlement, normalisedInvoice, methodBaseAmount);
    const pricing = summarisePricing(baseAmount, markupPercent);

    if (!finalResponse) {
      return {
        status: 'failed',
        stage: 'payment_confirmation',
        error: 'Robot did not respond to payment confirmation',
        invoice: normalisedInvoice,
        payment: settlement,
        attempts: attempt,
        pricing,
        selection: selectionMeta,
      };
    }

    if (finalResponse.status === 200) {
      return {
        status: 'success',
        stage: 'payment_confirmed',
        response: finalResponse.data,
        payment: settlement,
        invoice: normalisedInvoice,
        attempts: attempt,
        pricing,
        selection: selectionMeta,
      };
    }

    return {
      status: 'failed',
      stage: 'payment_confirmation',
      error: finalResponse.data?.error || finalResponse.data?.message || 'Robot rejected payment confirmation',
      httpStatus: finalResponse.status,
      response: finalResponse.data,
      invoice: normalisedInvoice,
      payment: settlement,
      attempts: attempt,
      pricing,
      selection: selectionMeta,
    };
  };

  const dance = async ({ quantity, mode }) => {
    const selectionInput = quantity ?? mode;
    if (!selectionInput) {
      throw createHttpError(400, 'Dance quantity is required');
    }

    const selectedRobots = selectRobotsForDance(selectionInput);
    const responses = [];

    for (const robot of selectedRobots) {
      try {
        const result = await executeMoveDemo(robot);
        responses.push({
          robotId: robot.id,
          ...result,
        });
      } catch (error) {
        logger.error('Dance command failed for robot', { robotId: robot.id, error: error.message });
        responses.push({
          robotId: robot.id,
          status: 'failed',
          error: error.message,
          stage: error.stage || 'transport',
          invoice: null,
          payment: null,
          attempts: 0,
          pricing: summarisePricing(null, markupPercent),
          selection: {
            strategy: danceSelectionStrategy,
            price: null,
          },
        });
      }
    }

    const totalRobotCost = responses.reduce((sum, entry) => {
      if (entry.pricing?.baseAmount != null && entry.status === 'success') {
        return sum + entry.pricing.baseAmount;
      }
      return sum;
    }, 0);

    const suggestedPrice = totalRobotCost > 0
      ? parseFloat((totalRobotCost * (1 + markupPercent / 100)).toFixed(6))
      : null;

    return {
      results: responses,
      summary: {
        selectionStrategy: danceSelectionStrategy,
        markupPercent,
        totalRobotCost: totalRobotCost > 0 ? parseFloat(totalRobotCost.toFixed(6)) : 0,
        suggestedPrice,
        robotsSelected: selectedRobots.map((robot) => robot.id),
      },
    };
  };

  const selectRobotForBuyCola = (location) => {
    const available = registry.list().filter((robot) => robot.status.state === 'ready');

    if (available.length === 0) {
      throw createHttpError(409, 'No robots ready for dispatch');
    }

    if (buyColaSelectionStrategy === 'lowest_price') {
      const sorted = sortRobotsByPrice(available, BUY_COLA_METHOD_IDENTIFIERS, 'asc');
      const selected = sorted[0];
      if (!selected) {
        throw createHttpError(409, 'No robots ready for dispatch');
      }
      const methodInfo = findMethodEntry(selected, BUY_COLA_METHOD_IDENTIFIERS);
      return {
        robot: selected,
        selection: {
          strategy: buyColaSelectionStrategy,
          price: getPricingAmount(methodInfo),
        },
        methodInfo,
      };
    }

    const candidates = available
      .map((robot) => ({
        robot,
        distance: calculateDistance(robot.location, location),
      }))
      .sort((left, right) => left.distance - right.distance);

    const [closest] = candidates;

    if (!closest || !Number.isFinite(closest.distance)) {
      throw createHttpError(422, 'Unable to determine closest robot. Ensure robots report their location.');
    }

    return {
      robot: closest.robot,
      selection: {
        strategy: buyColaSelectionStrategy,
        distance: closest.distance,
      },
      methodInfo: findMethodEntry(closest.robot, BUY_COLA_METHOD_IDENTIFIERS),
    };
  };

  const buyCola = async ({ location, quantity }) => {
    if (!location || typeof location.lat !== 'number' || typeof location.lng !== 'number') {
      throw createHttpError(400, 'Location with numeric lat and lng is required');
    }

    if (!Number.isInteger(quantity) || quantity <= 0) {
      throw createHttpError(400, 'Quantity must be a positive integer');
    }

    const { robot, selection, methodInfo } = selectRobotForBuyCola(location);
    const baseAmount = getPricingAmount(methodInfo);
    const pricing = summarisePricing(baseAmount, markupPercent);

    try {
      const response = await driveCommand({
        robot,
        endpoint: '/commands/buy-cola',
        payload: { location, quantity },
      });

      return {
        result: {
          robotId: robot.id,
          status: 'success',
          response: response.data,
          pricing,
          selection,
        },
        summary: {
          selectionStrategy: selection.strategy,
          markupPercent,
          robotId: robot.id,
          baseAmount: pricing?.baseAmount ?? null,
          suggestedPrice: pricing?.suggestedPrice ?? null,
        },
      };
    } catch (error) {
      return {
        result: {
          robotId: robot.id,
          status: 'failed',
          error: error.message,
          pricing,
          selection,
        },
        summary: {
          selectionStrategy: selection.strategy,
          markupPercent,
          robotId: robot.id,
          baseAmount: pricing?.baseAmount ?? null,
          suggestedPrice: pricing?.suggestedPrice ?? null,
        },
      };
    }
  };

  return {
    dance,
    buyCola,
  };
};

module.exports = createCommandRouter;

