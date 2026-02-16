const {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} = require('@solana/web3.js');
const bs58Module = require('bs58');
const bs58 = bs58Module.decode ? bs58Module : bs58Module.default;
const logger = require('../../utils/logger');

const NORMALISED_COMMITMENTS = new Set(['processed', 'confirmed', 'finalized']);

const parseSecretKey = (input) => {
  if (!input) {
    throw new Error('Solana secret key is required for direct payments');
  }

  if (input instanceof Uint8Array) {
    return input;
  }

  if (Array.isArray(input)) {
    return Uint8Array.from(input);
  }

  if (Buffer.isBuffer(input)) {
    return new Uint8Array(input);
  }

  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) {
      throw new Error('Solana secret key string is empty');
    }

    if (trimmed.startsWith('[') && trimmed.endsWith(']')) {
      try {
        const parsed = JSON.parse(trimmed);
        if (!Array.isArray(parsed)) {
          throw new Error('Secret key JSON must be an array');
        }
        return Uint8Array.from(parsed);
      } catch (error) {
        throw new Error(`Failed to parse Solana secret key JSON: ${error.message}`);
      }
    }

    // Try base64 first
    try {
      const buffer = Buffer.from(trimmed, 'base64');
      if (buffer.length > 0 && buffer.length !== 32 && buffer.length !== 64) {
        logger.debug('Base64 decoded secret has unexpected length, attempting base58 fallback', {
          length: buffer.length,
        });
      } else if (buffer.length > 0) {
        return new Uint8Array(buffer);
      }
    } catch (error) {
      logger.debug('Base64 decoding of Solana secret key failed, attempting base58', { error: error.message });
    }

    try {
      const decoded = bs58.decode(trimmed);
      if (decoded.length === 32 || decoded.length === 64) {
        return Uint8Array.from(decoded);
      }
      throw new Error(`Unexpected base58 decoded length ${decoded.length}`);
    } catch (error) {
      throw new Error('Failed to decode Solana secret key. Provide base64, base58, or JSON array.');
    }
  }

  throw new Error('Unsupported Solana secret key format');
};

class SolanaDirectPaymentProvider {
  constructor({
    rpcUrl,
    secretKey,
    commitment = 'confirmed',
    minConfirmations = 1,
  }) {
    if (!rpcUrl) {
      throw new Error('Solana RPC URL is required for direct payments');
    }

    this.connection = new Connection(rpcUrl, commitment);
    this.commitment = NORMALISED_COMMITMENTS.has(commitment) ? commitment : 'confirmed';
    this.minConfirmations = Math.max(1, Number(minConfirmations) || 1);

    const secret = parseSecretKey(secretKey);
    this.keypair = Keypair.fromSecretKey(secret);
    this.signerPublicKey = this.keypair.publicKey.toBase58();

    logger.info('Solana direct payment provider configured', {
      rpcUrl,
      commitment: this.commitment,
      minConfirmations: this.minConfirmations,
      signer: this.signerPublicKey,
    });
  }

  isReady() {
    return Boolean(this.connection && this.keypair);
  }

  async settle(invoice) {
    if (!invoice) {
      throw new Error('Invoice payload is required');
    }

    const receiver = invoice.receiver ?? invoice.payTo;
    const { amount, asset } = invoice;
    if (asset !== 'SOL') {
      throw new Error(`Unsupported asset "${asset}". Solana direct provider currently supports only SOL.`);
    }

    if (!receiver) {
      throw new Error('Receiver account (receiver/payTo) is required');
    }

    const numericAmount = typeof amount === 'string' ? Number(amount) : amount;
    if (!Number.isFinite(numericAmount) || numericAmount <= 0) {
      throw new Error(`Invalid payment amount "${amount}"`);
    }

    const lamports = Math.round(numericAmount * LAMPORTS_PER_SOL);
    if (lamports <= 0) {
      throw new Error(`Calculated lamports must be positive. Received amount: ${amount}`);
    }

    const toPublicKey = new PublicKey(receiver);
    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: this.keypair.publicKey,
        toPubkey: toPublicKey,
        lamports,
      }),
    );

    const latestBlockhash = await this.connection.getLatestBlockhash(this.commitment);
    transaction.recentBlockhash = latestBlockhash.blockhash;
    transaction.feePayer = this.keypair.publicKey;

    logger.info('Submitting on-chain payment', {
      receiver,
      lamports,
      signer: this.signerPublicKey,
      recentBlockhash: latestBlockhash.blockhash,
    });

    const signature = await sendAndConfirmTransaction(
      this.connection,
      transaction,
      [this.keypair],
      {
        commitment: this.commitment,
      },
    );

    if (this.minConfirmations > 1) {
      await this.connection.confirmTransaction(signature, this.commitment);
    }

    const settlement = {
      provider: 'solana-direct',
      signature,
      receiver,
      amount: numericAmount,
      asset,
      lamports,
      commitment: this.commitment,
      settledAt: new Date().toISOString(),
    };

    logger.info('On-chain payment settled', settlement);

    return settlement;
  }
}

module.exports = SolanaDirectPaymentProvider;

