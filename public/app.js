const robotsList = document.getElementById('robots-list');
const robotForm = document.getElementById('robot-form');
const robotFormMessage = document.getElementById('robot-form-message');
const refreshAllButton = document.getElementById('refresh-all');
const availableActionsEl = document.getElementById('available-actions');
const aiAgentForm = document.getElementById('ai-agent-form');
const aiAgentMessage = document.getElementById('ai-agent-message');
const llmProviderSelect = document.getElementById('llm-provider');
const llmConfigDiv = document.getElementById('llm-config');

let map = null;
let markersLayer = null;

const api = {
  async request(path, options = {}) {
    const response = await fetch(path, {
      headers: {
        'Content-Type': 'application/json',
      },
      ...options,
      body: options.body ? JSON.stringify(options.body) : undefined,
    });

    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      const message = payload?.error || 'Unknown error';
      throw new Error(message);
    }
    return payload;
  },

  listRobots() {
    return this.request('/api/robots');
  },

  addRobot(data) {
    return this.request('/api/robots', {
      method: 'POST',
      body: data,
    });
  },

  refreshRobot(id) {
    return this.request(`/api/robots/${id}/refresh`, {
      method: 'POST',
    });
  },

  deleteRobot(id) {
    return fetch(`/api/robots/${id}`, {
      method: 'DELETE',
    });
  },

  getAiAgentConfig() {
    return this.request('/api/admin/ai-agent');
  },

  saveAiAgentConfig(data) {
    return this.request('/api/admin/ai-agent', {
      method: 'POST',
      body: data,
    });
  },

  getClientSettings() {
    return this.request('/api/admin/client-settings');
  },

  saveClientSettings(data) {
    return this.request('/api/admin/client-settings', {
      method: 'POST',
      body: data,
    });
  },
};

const setMessage = (element, message, type) => {
  element.textContent = message;
  element.className = `message ${type ?? ''}`;
};

const formatStatus = (robot) => {
  const classes = ['status', robot.status.state];
  if (robot.status.secure) {
    classes.push('secure');
  }
  const label = `${robot.status.state.toUpperCase()}${robot.status.secure ? ' · SECURE' : ''}`;
  return `<span class="${classes.join(' ')}">${label}</span>`;
};

const formatMethods = (robot) => {
  if (!robot.status.availableMethods?.length) {
    return '<span>No methods reported</span>';
  }

  return robot.status.availableMethods
    .map((method) => {
      if (typeof method === 'string') {
        return `<span class="method-pill">${method}</span>`;
      }

      const {
        path,
        httpMethod,
        description,
        pricing,
        parameters,
      } = method;

      const priceLabel = pricing
        ? `${pricing.amount} ${pricing.assetSymbol} → ${pricing.receiverAccount} (expires in ${pricing.paymentWindowSec}s)`
        : 'Free';

      const parametersLabel = parameters && Object.keys(parameters).length > 0
        ? JSON.stringify(parameters)
        : 'None';

      return `
        <article class="method-card">
          <header>
            <h4>${httpMethod || 'N/A'} · ${path || 'unknown'}</h4>
            <span class="method-meta">${description || 'No description'}</span>
          </header>
          <span class="method-pricing">Pricing: ${priceLabel}</span>
          <span class="method-parameters">Parameters: ${parametersLabel}</span>
        </article>
      `;
    })
    .join('');
};

const formatLocation = (location) => {
  if (!location) {
    return 'Unknown';
  }
  const lat = Number(location.lat).toFixed(4);
  const lng = Number(location.lng).toFixed(4);
  return `${lat}, ${lng}`;
};

const formatAmount = (value, digits = 6) => {
  if (typeof value !== 'number' || Number.isNaN(value) || !Number.isFinite(value)) {
    return null;
  }
  return value.toFixed(digits);
};

const renderRobot = (robot) => `
  <details class="robot-card" data-robot-id="${robot.id}">
    <summary>
      <div class="robot-summary">
        <div class="robot-summary-main">
          <span class="robot-name">${robot.name}</span>
          ${formatStatus(robot)}
        </div>
        <span class="robot-address">${robot.host}:${robot.port}</span>
      </div>
      <span class="robot-toggle" aria-hidden="true">▾</span>
    </summary>
    <div class="robot-details">
      <p>${robot.status.message || 'No message reported.'}</p>
      <div class="robot-stats">
        <span><strong>Location:</strong> ${formatLocation(robot.location)}</span>
        <span><strong>Last check:</strong> ${robot.lastHealthCheckAt || 'never'}</span>
      </div>
      <div class="methods">${formatMethods(robot)}</div>
      <div class="robot-actions">
        <button data-action="refresh" data-id="${robot.id}">Refresh</button>
        <button data-action="remove" data-id="${robot.id}">Remove</button>
      </div>
    </div>
  </details>
`;

const initMap = () => {
  if (typeof L === 'undefined') {
    console.error('Leaflet library is not available. Map will not be rendered.');
    const mapElement = document.getElementById('robots-map');
    if (mapElement) {
      mapElement.innerHTML = '<p class="message error">Map library failed to load.</p>';
    }
    return;
  }

  if (map) {
    return;
  }
  map = L.map('robots-map', {
    center: [20, 0],
    zoom: 2,
    minZoom: 2,
    worldCopyJump: true,
  });

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
  }).addTo(map);

  markersLayer = L.layerGroup().addTo(map);
};

const updateMapMarkers = (robots = []) => {
  if (!map || !markersLayer) {
    return;
  }

  markersLayer.clearLayers();

  const robotsWithLocation = robots.filter(
    (robot) => robot.location && typeof robot.location.lat === 'number' && typeof robot.location.lng === 'number',
  );

  if (robotsWithLocation.length === 0) {
    map.setView([20, 0], 2);
    return;
  }

  const bounds = [];
  robotsWithLocation.forEach((robot) => {
    const { lat, lng } = robot.location;
    const marker = L.marker([lat, lng]).addTo(markersLayer);
    marker.bindPopup(
      `<strong>${robot.name}</strong><br>${robot.host}:${robot.port}<br>Status: ${robot.status.state}`,
    );
    bounds.push([lat, lng]);
  });

  if (bounds.length === 1) {
    map.setView(bounds[0], 9);
  } else {
    map.fitBounds(bounds, { padding: [40, 40] });
  }
};

const renderRobots = async () => {
  try {
    const data = await api.listRobots();
    if (!data?.robots?.length) {
      robotsList.innerHTML = '<p class="robots-list-empty">No robots registered yet.</p>';
      updateMapMarkers([]);
      return;
    }
    robotsList.innerHTML = data.robots.map(renderRobot).join('');
    updateMapMarkers(data.robots);
  } catch (error) {
    robotsList.innerHTML = `<p class="message error">${error.message}</p>`;
  }
};

robotsList.addEventListener('click', async (event) => {
  const target = event.target;
  if (!(target instanceof HTMLElement)) {
    return;
  }

  const action = target.dataset.action;
  const id = target.dataset.id;
  if (!action || !id) {
    return;
  }

  try {
    if (action === 'refresh') {
      await api.refreshRobot(id);
    } else if (action === 'remove') {
      await api.deleteRobot(id);
    }
    await renderRobots();
  } catch (error) {
    setMessage(robotFormMessage, error.message, 'error');
  }
});

refreshAllButton.addEventListener('click', async () => {
  refreshAllButton.disabled = true;
  refreshAllButton.textContent = 'Refreshing...';
  try {
    const { robots } = await api.listRobots();
    await Promise.all(
      (robots || []).map((robot) => api.refreshRobot(robot.id)),
    );
    await renderRobots();
  } catch (error) {
    setMessage(robotFormMessage, error.message, 'error');
  } finally {
    refreshAllButton.disabled = false;
    refreshAllButton.textContent = 'Refresh All';
  }
});

robotForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(robotForm);
  const payload = {
    name: formData.get('name') || undefined,
    host: formData.get('host'),
    port: Number(formData.get('port')),
    requiresX402: formData.get('requiresX402') === 'on',
  };

  try {
    await api.addRobot(payload);
    robotForm.reset();
    setMessage(robotFormMessage, 'Robot registered successfully', 'success');
    await renderRobots();
  } catch (error) {
    setMessage(robotFormMessage, error.message, 'error');
  }
});

// Load and render available actions
const renderAvailableActions = async () => {
  try {
    const { robots } = await api.listRobots();
    const actionsMap = new Map();

    robots.forEach((robot) => {
      const methods = robot.status?.availableMethods || [];
      methods.forEach((method) => {
        const methodKey = typeof method === 'string' ? method : (method.path || method.description || 'unknown');
        if (!actionsMap.has(methodKey)) {
          actionsMap.set(methodKey, {
            name: methodKey,
            description: typeof method === 'object' ? (method.description || '') : '',
            httpMethod: typeof method === 'object' ? (method.httpMethod || 'POST') : 'POST',
            pricing: typeof method === 'object' ? (method.pricing || null) : null,
            parameters: typeof method === 'object' ? (method.parameters || {}) : {},
            availableRobots: [],
          });
        }
        actionsMap.get(methodKey).availableRobots.push({
          id: robot.id,
          name: robot.name,
        });
      });
    });

    const actions = Array.from(actionsMap.values());
    
    if (actions.length === 0) {
      availableActionsEl.innerHTML = '<p class="robots-list-empty">No actions available. Register robots first.</p>';
      return;
    }

    availableActionsEl.innerHTML = actions.map(action => `
      <div class="action-card">
        <div class="action-header">
          <h4>${action.name}</h4>
          <span class="method-meta">${action.httpMethod}</span>
        </div>
        ${action.description ? `<p class="method-description">${action.description}</p>` : ''}
        ${action.pricing ? `<p class="method-pricing">Price: ${action.pricing.amount} ${action.pricing.assetSymbol || 'SOL'}</p>` : '<p class="method-pricing">Free</p>'}
        <p class="method-meta">Available on ${action.availableRobots.length} robot(s): ${action.availableRobots.map(r => r.name).join(', ')}</p>
      </div>
    `).join('');
  } catch (error) {
    availableActionsEl.innerHTML = `<p class="message error">Error loading actions: ${error.message}</p>`;
  }
};

// AI Agent form handling
llmProviderSelect.addEventListener('change', (e) => {
  llmConfigDiv.classList.toggle('hidden', !e.target.value);
});

aiAgentForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(aiAgentForm);
  
  const config = {
    strategy: formData.get('strategy'),
    n8nWebhookUrl: formData.get('n8nWebhookUrl') || null,
    llm: {
      provider: formData.get('llmProvider') || null,
      apiKey: formData.get('llmApiKey') || null,
      endpoint: formData.get('llmEndpoint') || null,
      model: formData.get('llmModel') || null,
    },
  };

  try {
    await api.saveAiAgentConfig(config);
    setMessage(aiAgentMessage, 'AI Agent configuration saved successfully', 'success');
  } catch (error) {
    setMessage(aiAgentMessage, `Error saving configuration: ${error.message}`, 'error');
  }
});

// Load AI Agent config on page load
const loadAiAgentConfig = async () => {
  try {
    const config = await api.getAiAgentConfig();
    if (config) {
      document.getElementById('ai-strategy').value = config.strategy || 'smart';
      if (config.n8nWebhookUrl) {
        document.querySelector('[name="n8nWebhookUrl"]').value = config.n8nWebhookUrl;
      }
      if (config.llm) {
        llmProviderSelect.value = config.llm.provider || '';
        if (config.llm.provider) {
          llmConfigDiv.classList.remove('hidden');
          if (config.llm.apiKey) {
            document.querySelector('[name="llmApiKey"]').value = config.llm.apiKey;
          }
          if (config.llm.endpoint) {
            document.querySelector('[name="llmEndpoint"]').value = config.llm.endpoint;
          }
          if (config.llm.model) {
            document.querySelector('[name="llmModel"]').value = config.llm.model;
          }
        }
      }
    }
  } catch (error) {
    console.error('Failed to load AI Agent config:', error);
  }
};

// RPC settings form (admin panel)
const rpcSettingsForm = document.getElementById('rpc-settings-form');
const rpcSettingsMessage = document.getElementById('rpc-settings-message');
const rpcProviderSelect = document.getElementById('rpc-provider');
const rpcHeliusRow = document.getElementById('rpc-helius-row');
const rpcCustomRow = document.getElementById('rpc-custom-row');

const updateRpcOptionVisibility = () => {
  const provider = rpcProviderSelect?.value || 'helius';
  if (rpcHeliusRow) rpcHeliusRow.classList.toggle('hidden', provider !== 'helius');
  if (rpcCustomRow) rpcCustomRow.classList.toggle('hidden', provider !== 'custom');
};

const loadClientSettings = async () => {
  try {
    const data = await api.getClientSettings();
    if (rpcProviderSelect) rpcProviderSelect.value = data.rpcProvider || 'public';
    const heliusInput = document.getElementById('rpc-helius-key');
    if (heliusInput && data.hasHeliusKey) heliusInput.placeholder = '•••••••• (already set)';
    const customInput = document.getElementById('rpc-custom-url');
    if (customInput && data.customRpcUrl) customInput.value = data.customRpcUrl;
    updateRpcOptionVisibility();
  } catch (e) {
    console.warn('Failed to load RPC settings', e);
    updateRpcOptionVisibility();
  }
};

if (rpcProviderSelect) {
  rpcProviderSelect.addEventListener('change', updateRpcOptionVisibility);
}
if (rpcSettingsForm) {
  rpcSettingsForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const formData = new FormData(rpcSettingsForm);
    const provider = formData.get('rpcProvider') || 'public';
    const heliusKey = formData.get('heliusApiKey')?.trim() || '';
    const customUrl = formData.get('customRpcUrl')?.trim() || '';
    try {
      await api.saveClientSettings({
        rpcProvider: provider,
        heliusApiKey: heliusKey || undefined,
        customRpcUrl: provider === 'custom' ? customUrl : undefined,
      });
      setMessage(rpcSettingsMessage, 'RPC settings saved', 'success');
    } catch (err) {
      setMessage(rpcSettingsMessage, err.message || 'Failed to save', 'error');
    }
  });
}

setInterval(renderRobots, 15000);
initMap();
renderRobots();
renderAvailableActions();
loadAiAgentConfig();
loadClientSettings();

