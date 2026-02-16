const express = require('express');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../utils/logger');

const CONFIG_FILE = path.join(process.cwd(), 'config', 'ai-agent.json');

const createAdminRouter = ({ settingsStore } = {}) => {
  const router = express.Router();

  /**
   * Get AI agent configuration.
   */
  router.get('/ai-agent', async (req, res) => {
    try {
      const config = await fs.readFile(CONFIG_FILE, 'utf-8').catch(() => '{}');
      const parsed = JSON.parse(config);
      res.json(parsed);
    } catch (error) {
      logger.error('Failed to read AI agent config', { error: error.message });
      res.json({});
    }
  });

  /**
   * Save AI agent configuration.
   */
  router.post('/ai-agent', async (req, res) => {
    try {
      const config = req.body;
      
      // Validate
      if (config.strategy && !['smart', 'lowest_price', 'closest', 'fastest'].includes(config.strategy)) {
        return res.status(400).json({ error: 'Invalid strategy' });
      }

      // Write to file
      await fs.mkdir(path.dirname(CONFIG_FILE), { recursive: true });
      await fs.writeFile(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');

      // Update env for current session
      if (config.strategy) {
        process.env.AI_AGENT_STRATEGY = config.strategy;
      }
      if (config.n8nWebhookUrl) {
        process.env.N8N_WEBHOOK_URL = config.n8nWebhookUrl;
      }

      logger.info('AI Agent configuration saved', { strategy: config.strategy });
      res.json({ success: true, config });
    } catch (error) {
      logger.error('Failed to save AI agent config', { error: error.message });
      res.status(500).json({ error: 'Failed to save configuration' });
    }
  });

  /**
   * Get client RPC settings (Solana / Helius).
   */
  router.get('/client-settings', (req, res) => {
    try {
      const settings = settingsStore?.getSettings?.() ?? {};
      res.json({
        rpcProvider: settings.rpcProvider || 'public',
        hasHeliusKey: Boolean(settings.hasHeliusKey),
        customRpcUrl: settings.customRpcUrl || null,
      });
    } catch (error) {
      logger.error('Failed to get client settings', { error: error.message });
      res.status(500).json({ error: 'Failed to get settings' });
    }
  });

  /**
   * Save client RPC settings (Helius, custom URL).
   */
  router.post('/client-settings', (req, res) => {
    try {
      const { rpcProvider, heliusApiKey, customRpcUrl } = req.body ?? {};
      const updated = settingsStore?.saveSettings?.({
        rpcProvider,
        heliusApiKey,
        customRpcUrl,
      }) ?? {};
      logger.info('Client RPC settings saved from admin', { rpcProvider: updated.rpcProvider });
      res.json(updated);
    } catch (error) {
      logger.error('Failed to save client settings', { error: error.message });
      res.status(500).json({ error: 'Failed to save settings' });
    }
  });

  return router;
};

module.exports = createAdminRouter;
