// Wallet integration uses global window.solana
const API_BASE = '/api/client';
let currentRpcUrl = 'https://solana-rpc.publicnode.com';

// Solana Web3.js is loaded via script tag in HTML
let SolanaWeb3 = null;
const loadSolanaWeb3 = () => {
  return new Promise((resolve) => {
    // Check if library is loaded
    if (window.solanaWeb3Ready && window.solanaWeb3) {
      SolanaWeb3 = window.solanaWeb3;
      resolve();
      return;
    }
    
    // Set ready handler
    window.onSolanaWeb3Ready = () => {
      if (window.solanaWeb3) {
        SolanaWeb3 = window.solanaWeb3;
      }
      resolve();
    };
    
    // Already loaded
    if (window.solanaWeb3Ready) {
      if (window.solanaWeb3) {
        SolanaWeb3 = window.solanaWeb3;
      }
      resolve();
      return;
    }
    
    // Timeout if library never loads
    setTimeout(() => {
      if (!SolanaWeb3) {
        console.warn('Solana Web3.js not loaded, wallet features may not work');
      }
      resolve();
    }, 3000);
  });
};

// LAMPORTS_PER_SOL for amount conversion
const LAMPORTS_PER_SOL = 1_000_000_000;

// State
let currentMode = 'direct'; // 'direct' | 'router'
let wallet = null;
let walletPublicKey = null;
let connection = null;
let currentAction = null;

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await loadSettings();
    await loadSolanaWeb3();
    initConnection();
    setupEventListeners();
    loadMode();
  } catch (error) {
    console.error('Failed to load Solana Web3.js:', error);
    showNotification('Failed to load Solana library', 'error');
  }
});

function initConnection() {
  if (SolanaWeb3 && SolanaWeb3.Connection && currentRpcUrl) {
    connection = new SolanaWeb3.Connection(currentRpcUrl, 'confirmed');
  }
}

function setupEventListeners() {
  // Mode selection
  document.getElementById('mode-direct').addEventListener('click', () => setMode('direct'));
  document.getElementById('mode-router').addEventListener('click', () => setMode('router'));

  // Wallet
  document.getElementById('connect-wallet').addEventListener('click', connectWallet);
  document.getElementById('disconnect-wallet').addEventListener('click', disconnectWallet);

  // Action execution
  document.getElementById('execute-action').addEventListener('click', executeAction);
  document.getElementById('confirm-payment').addEventListener('click', confirmPayment);
  document.getElementById('cancel-payment').addEventListener('click', cancelPayment);
}

async function loadSettings() {
  try {
    const res = await fetch(`${API_BASE}/settings`);
    const data = await res.json();
    if (data.solanaRpcUrl) {
      currentRpcUrl = data.solanaRpcUrl;
    }
  } catch (e) {
    console.warn('Could not load RPC settings from server', e);
  }
}

function setMode(mode) {
  currentMode = mode;
  document.getElementById('mode-direct').classList.toggle('active', mode === 'direct');
  document.getElementById('mode-router').classList.toggle('active', mode === 'router');
  
  document.getElementById('direct-mode').classList.toggle('hidden', mode !== 'direct');
  document.getElementById('router-mode').classList.toggle('hidden', mode !== 'router');
  
  document.getElementById('action-form-section').classList.add('hidden');
  document.getElementById('execution-status').classList.add('hidden');

  const descriptions = {
    direct: '<strong>Direct:</strong> Choose robot and action. Full control over executor.',
    router: '<strong>Task Router:</strong> System selects the best executor. Individual robots are hidden.',
  };
  document.getElementById('mode-description').innerHTML = descriptions[mode];

  loadMode();
}

function loadMode() {
  if (currentMode === 'direct') {
    loadRobots();
  } else {
    loadCommands();
  }
}

async function loadRobots() {
  const listEl = document.getElementById('robots-list');
  listEl.innerHTML = '<p class="loading">Loading robots...</p>';

  try {
    const response = await fetch(`${API_BASE}/robots`);
    const data = await response.json();

    if (!data.robots || data.robots.length === 0) {
      listEl.innerHTML = '<p class="loading">No robots available</p>';
      return;
    }

    listEl.innerHTML = data.robots.map(robot => renderRobot(robot)).join('');
    
    // Add event listeners for method selection
    data.robots.forEach(robot => {
      robot.availableMethods.forEach(method => {
        const methodKey = getMethodKey(method);
        const methodEl = document.querySelector(`[data-robot-id="${robot.id}"][data-method="${methodKey}"]`);
        if (methodEl) {
          methodEl.addEventListener('click', () => selectAction(robot, method));
        }
      });
    });
  } catch (error) {
    showNotification('Failed to load robots: ' + error.message, 'error');
    listEl.innerHTML = '<p class="loading">Load failed</p>';
  }
}

async function loadCommands() {
  const listEl = document.getElementById('commands-list');
  listEl.innerHTML = '<p class="loading">Loading actions...</p>';

  try {
    const response = await fetch(`${API_BASE}/commands`);
    const data = await response.json();

    if (!data.commands || data.commands.length === 0) {
      listEl.innerHTML = '<p class="loading">No actions available</p>';
      return;
    }

    listEl.innerHTML = data.commands.map(cmd => renderCommand(cmd)).join('');
    
    // Add event listeners
    data.commands.forEach(cmd => {
      const cmdEl = document.querySelector(`[data-command="${cmd.name}"]`);
      if (cmdEl) {
        cmdEl.addEventListener('click', () => selectCommand(cmd));
      }
    });
  } catch (error) {
    showNotification('Failed to load actions: ' + error.message, 'error');
    listEl.innerHTML = '<p class="loading">Load failed</p>';
  }
}

function renderRobot(robot) {
  const methods = robot.availableMethods || [];
  const methodsHtml = methods.map(method => {
    const methodKey = getMethodKey(method);
    const methodName = typeof method === 'string' ? method : (method.path || method.description || 'unknown');
    const methodPrice = typeof method === 'object' && method.pricing 
      ? `${method.pricing.amount} ${method.pricing.assetSymbol || 'SOL'}` 
      : 'Free';
    const methodDesc = typeof method === 'object' ? (method.description || '') : '';

    return `
      <div class="method-item" data-robot-id="${robot.id}" data-method="${methodKey}">
        <div class="method-item-header">
          <span class="method-name">${methodName}</span>
          <span class="method-price">${methodPrice}</span>
        </div>
        ${methodDesc ? `<p class="method-description">${methodDesc}</p>` : ''}
      </div>
    `;
  }).join('');

  return `
    <div class="robot-card">
      <div class="robot-header">
        <span class="robot-name">${robot.name}</span>
        <span class="robot-status ${robot.status}">${robot.status.toUpperCase()}</span>
      </div>
      <div class="robot-methods">${methodsHtml || '<p>No methods available</p>'}</div>
    </div>
  `;
}

function renderCommand(cmd) {
  const price = cmd.pricing ? `${cmd.pricing.amount} ${cmd.pricing.assetSymbol || 'SOL'}` : 'Price TBD';
  
  return `
    <div class="command-card" data-command="${cmd.name}">
      <div class="command-name">${cmd.name}</div>
      <p class="command-description">${cmd.description || ''}</p>
      <p class="command-description"><strong>Price:</strong> ${price}</p>
    </div>
  `;
}

function getMethodKey(method) {
  if (typeof method === 'string') return method;
  return method.path || method.description || 'unknown';
}

function selectAction(robot, method) {
  currentAction = {
    mode: 'direct',
    robot,
    method,
  };
  showActionForm();
}

function selectCommand(cmd) {
  currentAction = {
    mode: 'router',
    command: cmd,
  };
  showActionForm();
}

function showActionForm() {
  const section = document.getElementById('action-form-section');
  const form = document.getElementById('action-form');
  const preview = document.getElementById('action-preview');
  
  section.classList.remove('hidden');
  preview.classList.add('hidden');
  
  if (currentAction.mode === 'direct') {
    document.getElementById('action-form-title').textContent = `Execute: ${getMethodKey(currentAction.method)}`;
    form.innerHTML = buildActionForm(currentAction.method);
  } else {
    document.getElementById('action-form-title').textContent = `Execute: ${currentAction.command.name}`;
    form.innerHTML = buildActionForm(currentAction.command);
  }

  // Estimate price
  estimatePrice();
}

function buildActionForm(method) {
  if (typeof method === 'string') {
    return '<p>No parameters required</p>';
  }

  const params = method.parameters || {};
  if (Object.keys(params).length === 0) {
    return '<p>No parameters required</p>';
  }

  let html = '';
  if (params.kwargs) {
    Object.entries(params.kwargs).forEach(([key, value]) => {
      html += `
        <div class="form-group">
          <label>${key}</label>
          <input type="text" name="${key}" value="${value || ''}" />
        </div>
      `;
    });
  }
  return html;
}

async function estimatePrice() {
  try {
    const payload = {
      mode: currentAction.mode,
    };

    if (currentAction.mode === 'direct') {
      payload.robotId = currentAction.robot.id;
      payload.command = getMethodKey(currentAction.method);
    } else {
      payload.command = currentAction.command.name;
    }

    const response = await fetch(`${API_BASE}/estimate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    const data = await response.json();

    if (data.estimatedPrice !== null) {
      document.getElementById('preview-price').textContent = data.estimatedPrice;
      document.getElementById('preview-robot').textContent = data.robot.name;
      document.getElementById('preview-action').textContent = 
        currentAction.mode === 'direct' ? getMethodKey(currentAction.method) : currentAction.command.name;
      
      document.getElementById('action-preview').classList.remove('hidden');
      document.getElementById('execute-action').disabled = !walletPublicKey;
    } else {
      showNotification('Could not determine cost', 'error');
    }
  } catch (error) {
    showNotification('Cost estimate error: ' + error.message, 'error');
  }
}

const WALLET_CONFIGS = [
  { id: 'phantom', name: 'Phantom', getProvider: () => (window.phantom?.solana || (window.solana?.isPhantom ? window.solana : null)) },
  { id: 'backpack', name: 'Backpack', getProvider: () => window.backpack || null },
  { id: 'solflare', name: 'Solflare', getProvider: () => window.solflare || null },
  { id: 'glow', name: 'Glow', getProvider: () => window.glow || null },
  { id: 'solana', name: 'Solana (Standard)', getProvider: () => (window.solana && !window.solana.isPhantom ? window.solana : null) },
];

function getAvailableWallets() {
  const list = [];
  const seen = new Set();
  for (const config of WALLET_CONFIGS) {
    try {
      const p = config.getProvider();
      if (p && typeof p.connect === 'function' && !seen.has(p)) {
        seen.add(p);
        list.push({ ...config, provider: p });
      }
    } catch (_) { /* ignore MetaMask/extension conflicts */ }
  }
  return list;
}

function showWalletSelector() {
  const modal = document.getElementById('wallet-selector-modal');
  const listEl = document.getElementById('wallet-selector-list');
  const wallets = getAvailableWallets();

  if (wallets.length === 0) {
    showNotification('Solana wallet not found. Install Phantom, Backpack, Solflare or another Solana wallet.', 'error');
    return;
  }

  listEl.innerHTML = wallets.map(w => 
    `<button type="button" class="wallet-option" data-wallet-id="${w.id}">${w.name}</button>`
  ).join('');

  listEl.querySelectorAll('.wallet-option').forEach(btn => {
    btn.addEventListener('click', async () => {
      const w = wallets.find(x => x.id === btn.dataset.walletId);
      if (w) {
        // Don't hide modal yet — keeps user gesture active for Phantom popup in incognito
        connectWithProvider(w.provider).finally(() => {
          modal.classList.add('hidden');
        });
      }
    });
  });

  document.getElementById('wallet-selector-cancel').onclick = () => modal.classList.add('hidden');
  modal.classList.remove('hidden');
}

const CONNECT_TIMEOUT_MS = 45000;

function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(message)), ms)),
  ]);
}

async function connectWithProvider(provider) {
  try {
    // Call connect() first while user gesture is still active (helps Phantom popup in incognito)
    let connectPromise = Promise.resolve();
    if (provider.connect) {
      connectPromise = Promise.resolve(provider.connect());
    } else if (provider.isConnected && !provider.isConnected()) {
      connectPromise = Promise.resolve(provider.connect());
    }

    await withTimeout(
      connectPromise,
      CONNECT_TIMEOUT_MS,
      'Connection timed out. Allow popups for this site (browser bar or site settings), especially in incognito.',
    );

    await loadSolanaWeb3();
    initConnection();

    let publicKey;
    if (provider.publicKey) {
      publicKey = provider.publicKey;
    } else if (provider.publicKeyBase58) {
      publicKey = provider.publicKeyBase58;
    } else {
      throw new Error('Unable to get public key from wallet');
    }

    wallet = provider;
    if (SolanaWeb3 && SolanaWeb3.PublicKey) {
      walletPublicKey = typeof publicKey === 'string' 
        ? new SolanaWeb3.PublicKey(publicKey)
        : publicKey;
    } else {
      walletPublicKey = typeof publicKey === 'string' ? publicKey : publicKey.toString();
    }

    updateWalletUI();
    await updateWalletBalance();
    showNotification('Wallet connected', 'success');
  } catch (error) {
    showNotification('Wallet connection error: ' + error.message, 'error');
  }
}

async function connectWallet() {
  const wallets = getAvailableWallets();

  if (wallets.length === 0) {
    showNotification('Solana wallet not found. Install Phantom, Backpack, Solflare or another Solana wallet.', 'error');
    return;
  }

  if (wallets.length === 1) {
    connectWithProvider(wallets[0].provider);
  } else {
    showWalletSelector();
  }
}

function disconnectWallet() {
  if (wallet && wallet.disconnect) {
    wallet.disconnect();
  }
  wallet = null;
  walletPublicKey = null;
  updateWalletUI();
  showNotification('Wallet disconnected', 'info');
}

function updateWalletUI() {
  const statusEl = document.getElementById('wallet-status');
  const infoEl = document.getElementById('wallet-info');

  if (walletPublicKey) {
    statusEl.classList.add('hidden');
    infoEl.classList.remove('hidden');
    const address = typeof walletPublicKey === 'string' 
      ? walletPublicKey 
      : walletPublicKey.toBase58();
    document.getElementById('wallet-address').textContent = 
      address.slice(0, 8) + '...' + address.slice(-8);
  } else {
    statusEl.classList.remove('hidden');
    infoEl.classList.add('hidden');
  }
}

async function updateWalletBalance() {
  if (!walletPublicKey || !connection) return;

  try {
    const balance = await connection.getBalance(walletPublicKey);
    const solBalance = balance / LAMPORTS_PER_SOL;
    document.getElementById('wallet-balance').textContent = solBalance.toFixed(4);
  } catch (error) {
    console.error('Failed to fetch balance:', error);
  }
}

async function executeAction() {
  if (!walletPublicKey) {
    showNotification('Connect wallet to execute action', 'error');
    return;
  }

  try {
    // Get invoice from robot
    const invoice = await initiateCommand();
    
    if (!invoice) {
      showNotification('Could not get payment invoice', 'error');
      return;
    }

    // Show payment modal
    showPaymentModal(invoice);
  } catch (error) {
    showNotification('Command initiation error: ' + error.message, 'error');
  }
}

/**
 * Parse 402 response body into invoice (x402 V2 accepts[0] or legacy).
 */
function parse402Invoice(data) {
  if (!data || typeof data !== 'object') return null;
  if (data.x402Version === 2 && Array.isArray(data.accepts) && data.accepts.length > 0) {
    const a = data.accepts[0];
    const ref = a?.extra?.reference;
    const payTo = a?.payTo;
    if (ref && payTo && (a?.amount != null) && a?.asset) {
      return { reference: ref, receiver: payTo, amount: a.amount, asset: a.asset };
    }
  }
  const ref = data.reference;
  const to = data.receiver ?? data.payTo;
  if (ref && to && (data.amount != null) && data.asset) {
    return { reference: ref, receiver: to, amount: data.amount, asset: data.asset };
  }
  return null;
}

/**
 * Collect parameters from #action-form container (div with inputs, not a form element).
 */
function getActionFormParameters() {
  const container = document.getElementById('action-form');
  const parameters = {};
  if (!container) return parameters;
  const inputs = container.querySelectorAll('input, select, textarea');
  inputs.forEach((el) => {
    const name = el.getAttribute('name');
    if (!name) return;
    if (el.type === 'checkbox' || el.type === 'radio') {
      if (el.checked) parameters[name] = el.value || 'on';
    } else {
      parameters[name] = el.value;
    }
  });
  return parameters;
}

async function initiateCommand() {
  if (!currentAction) {
    throw new Error('No action selected');
  }

  try {
    const parameters = getActionFormParameters();
    const commandName = currentAction.mode === 'direct'
      ? getMethodKey(currentAction.method)
      : currentAction.command.name;

    // Use server proxy — avoids ERR_CONNECTION_TIMED_OUT when robot is on private network
    const body = {
      mode: currentAction.mode,
      command: commandName,
      parameters,
    };
    if (currentAction.mode === 'direct') {
      body.robotId = currentAction.robot.id;
    }

    const response = await fetch(`${API_BASE}/invoice`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });

    const data = await response.json().catch(() => ({}));

    if (response.status === 402) {
      const invoice = parse402Invoice(data);
      if (!invoice) throw new Error('Invalid 402 response: missing payment details');
      return invoice;
    } else if (response.status === 200) {
      showExecutionStatus({
        status: 'success',
        message: 'Command executed successfully',
        response: data,
      });
      return null;
    } else {
      throw new Error(data.error || `Request failed (${response.status})`);
    }
  } catch (error) {
    showNotification('Command initiation error: ' + error.message, 'error');
    throw error;
  }
}

function showPaymentModal(invoice) {
  const modal = document.getElementById('payment-modal');
  const details = document.getElementById('payment-details');
  
  details.innerHTML = `
    <p><strong>Receiver:</strong> ${invoice.receiver}</p>
    <p><strong>Amount:</strong> ${invoice.amount} ${invoice.asset}</p>
    <p><strong>Reference:</strong> ${invoice.reference}</p>
  `;
  
  modal.classList.remove('hidden');
  currentAction.invoice = invoice;
}

function cancelPayment() {
  document.getElementById('payment-modal').classList.add('hidden');
  currentAction.invoice = null;
}

async function confirmPayment() {
  if (!currentAction.invoice || !walletPublicKey) {
    showNotification('Error: no payment data', 'error');
    return;
  }

  const invoice = currentAction.invoice;
  const button = document.getElementById('confirm-payment');
  button.disabled = true;
  button.textContent = 'Processing...';

  try {
    if (!SolanaWeb3 || !SolanaWeb3.Transaction || !SolanaWeb3.SystemProgram) {
      throw new Error('Solana Web3.js library not loaded');
    }

    const amountNum = Number(invoice.amount);
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      throw new Error('Invalid invoice amount');
    }

    // Build transaction
    const transaction = new SolanaWeb3.Transaction().add(
      SolanaWeb3.SystemProgram.transfer({
        fromPubkey: typeof walletPublicKey === 'string' 
          ? new SolanaWeb3.PublicKey(walletPublicKey) 
          : walletPublicKey,
        toPubkey: new SolanaWeb3.PublicKey(invoice.receiver),
        lamports: Math.round(amountNum * LAMPORTS_PER_SOL),
      })
    );

    // Get latest blockhash
    const { blockhash } = await connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = typeof walletPublicKey === 'string' 
      ? new SolanaWeb3.PublicKey(walletPublicKey) 
      : walletPublicKey;

    // Sign transaction
    const signed = await wallet.signTransaction(transaction);
    
    // Send transaction
    const signature = await connection.sendRawTransaction(signed.serialize());
    
    // Wait for confirmation
    await connection.confirmTransaction(signature, 'confirmed');

    // Close modal
    document.getElementById('payment-modal').classList.add('hidden');

    // Give RPC time to index the transaction before server verification
    await new Promise((r) => setTimeout(r, 2500));

    // Send confirmation to server
    await submitPaymentConfirmation(signature, invoice, amountNum);

    showNotification('Payment completed', 'success');
    button.disabled = false;
    button.textContent = 'Confirm payment';
  } catch (error) {
    showNotification('Payment error: ' + error.message, 'error');
    button.disabled = false;
    button.textContent = 'Confirm payment';
  }
}

async function submitPaymentConfirmation(signature, invoice, amountNum) {
  const amount = amountNum !== undefined ? amountNum : Number(invoice.amount);
  try {
    const parameters = getActionFormParameters();

    const response = await fetch(`${API_BASE}/execute`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mode: currentAction.mode,
        robotId: currentAction.mode === 'direct' ? currentAction.robot.id : null,
        command: currentAction.mode === 'direct' 
          ? getMethodKey(currentAction.method) 
          : currentAction.command.name,
        parameters,
        paymentSignature: signature,
        paymentTransaction: {
          signature,
          receiver: invoice.receiver,
          amount: Number.isFinite(amount) ? amount : invoice.amount,
          asset: invoice.asset,
          reference: invoice.reference,
          sender: walletPublicKey ? (typeof walletPublicKey === 'string' ? walletPublicKey : walletPublicKey.toBase58()) : undefined,
        },
      }),
    });

    const result = await response.json();

    if (!response.ok) {
      const msg = result.details ? `${result.error}: ${result.details}` : (result.error || 'Server error');
      showNotification(msg, 'error');
      showExecutionStatus({
        status: 'failed',
        error: msg,
        message: result.details && result.details.includes('not found') ? 'Transaction not yet visible to server. Wait a few seconds and try again, or retry the action.' : undefined,
      });
      return;
    }

    if (result.refundRequired) {
      showNotification('Command failed. Refund will be processed.', 'info');
    }

    showExecutionStatus(result);
  } catch (error) {
    showNotification('Payment confirmation error: ' + error.message, 'error');
  }
}

function showExecutionStatus(result) {
  const section = document.getElementById('execution-status');
  const content = document.getElementById('status-content');
  
  section.classList.remove('hidden');
  
  const msg = result.message || (result.status === 'failed' ? 'No message' : '');
  content.innerHTML = `
    <div class="status-item ${result.status}">
      <p><strong>Status:</strong> ${result.status}</p>
      ${msg ? `<p><strong>Message:</strong> ${msg}</p>` : ''}
      ${result.error ? `<p><strong>Error:</strong> ${result.error}</p>` : ''}
    </div>
  `;
}

function showNotification(message, type = 'info') {
  const notifications = document.getElementById('notifications');
  const notification = document.createElement('div');
  notification.className = `notification ${type}`;
  notification.textContent = message;
  
  notifications.appendChild(notification);
  
  setTimeout(() => {
    notification.remove();
  }, 5000);
}

// Listen for wallet events (Phantom, Backpack, etc. use similar API)
function setupWalletEventListeners() {
  try {
    const providers = [
      window.phantom?.solana,
      window.solana?.isPhantom ? window.solana : null,
      window.backpack,
      window.solflare,
    ].filter(Boolean);
    const seen = new Set();
    for (const p of providers) {
      if (!p || seen.has(p)) continue;
      seen.add(p);
      if (typeof p.on === 'function') {
        p.on?.('connect', () => {
          if (p.publicKey && wallet === p) {
            if (SolanaWeb3 && SolanaWeb3.PublicKey) {
              walletPublicKey = new SolanaWeb3.PublicKey(p.publicKey);
            } else {
              walletPublicKey = p.publicKey.toString();
            }
            updateWalletUI();
            updateWalletBalance();
          }
        });
        p.on?.('disconnect', () => {
          if (wallet === p) disconnectWallet();
        });
      }
    }
  } catch (_) { /* ignore MetaMask/extension conflicts */ }
}

window.addEventListener('load', setupWalletEventListeners);
