const { Connection, PublicKey } = require('@solana/web3.js');
const logger = require('../utils/logger');

class ClientPaymentService {
  constructor({ solanaRpcUrl, getRpcUrl, commitment = 'confirmed' }) {
    this.commitment = commitment;
    this._getRpcUrl = getRpcUrl || (() => solanaRpcUrl);
  }

  get connection() {
    const url = this._getRpcUrl();
    return url ? new Connection(url, this.commitment) : null;
  }

  isReady() {
    return Boolean(this._getRpcUrl());
  }

  /**
   * Verify transaction on-chain.
   * Retries with delay when "Transaction not found" (RPC may lag).
   */
  async verifyTransaction(signature, expectedReceiver, expectedAmount) {
    if (!this.connection) {
      throw new Error('Solana connection is not configured');
    }

    const maxAttempts = 5;
    const delayMs = 2000;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        const transaction = await this.connection.getTransaction(signature, {
          commitment: this.commitment,
          maxSupportedTransactionVersion: 0,
        });

        if (!transaction) {
          if (attempt < maxAttempts) {
            logger.debug('Transaction not found yet, retrying', { signature, attempt });
            await new Promise((r) => setTimeout(r, delayMs));
            continue;
          }
          return { valid: false, error: 'Transaction not found (RPC may be delayed)' };
        }

      if (!transaction.meta || transaction.meta.err) {
        return { valid: false, error: 'Transaction failed' };
      }

      // Check receiver and amount
      const postBalances = transaction.meta.postBalances;
      const preBalances = transaction.meta.preBalances;
      const accountKeys = transaction.transaction.message.accountKeys;

      let receiverFound = false;
      let amountTransferred = 0;

      const receiverStr = String(expectedReceiver);
      for (let i = 0; i < accountKeys.length; i++) {
        const accountKey = accountKeys[i];
        const keyStr = typeof accountKey === 'string' ? accountKey : (accountKey && accountKey.toString ? accountKey.toString() : String(accountKey));
        if (keyStr === receiverStr) {
          receiverFound = true;
          const balanceChange = postBalances[i] - preBalances[i];
          if (balanceChange > 0) {
            amountTransferred = balanceChange;
          }
          break;
        }
      }

      if (!receiverFound) {
        return { valid: false, error: 'Receiver not found in transaction' };
      }

      const expectedLamports = Math.round(Number(expectedAmount) * 1_000_000_000);
      const tolerance = 1000; // Lamports tolerance for fees

      if (Math.abs(amountTransferred - expectedLamports) > tolerance) {
        return {
          valid: false,
          error: `Amount mismatch. Expected: ${expectedLamports}, Got: ${amountTransferred}`,
        };
      }

      return {
        valid: true,
        signature,
        receiver: expectedReceiver,
        amount: amountTransferred / 1_000_000_000,
        blockTime: transaction.blockTime,
      };
      } catch (error) {
        if (attempt >= maxAttempts) {
          logger.error('Failed to verify transaction', { signature, error: error.message });
          return { valid: false, error: error.message };
        }
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }

    return { valid: false, error: 'Transaction not found after retries' };
  }

  /**
   * Initiate refund. Requires server wallet configuration.
   */
  async initiateRefund(receiver, amount, reason) {
    // To be implemented via server wallet
    logger.info('Refund initiated', { receiver, amount, reason });
    return {
      status: 'pending',
      receiver,
      amount,
      reason,
      message: 'Refund will be processed by server wallet',
    };
  }
}

module.exports = ClientPaymentService;
