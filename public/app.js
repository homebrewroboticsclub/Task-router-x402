const robotsList = document.getElementById('robots-list');
const robotForm = document.getElementById('robot-form');
const robotFormMessage = document.getElementById('robot-form-message');
const danceForm = document.getElementById('dance-form');
const danceMessage = document.getElementById('dance-message');
const colaForm = document.getElementById('cola-form');
const colaMessage = document.getElementById('cola-message');
const refreshAllButton = document.getElementById('refresh-all');

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

  dance(quantity) {
    return this.request('/api/commands/dance', {
      method: 'POST',
      body: { quantity },
    });
  },

  buyCola({ location, quantity }) {
    return this.request('/api/commands/buy-cola', {
      method: 'POST',
      body: { location, quantity },
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

danceForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(danceForm);
  const quantity = formData.get('quantity');

  try {
    const result = await api.dance(quantity);
    const responses = Array.isArray(result.results) ? result.results : [];
    const successCount = responses.filter((entry) => entry.status === 'success').length;
    const failures = responses.filter((entry) => entry.status !== 'success');
    const suggestedPrice = formatAmount(result.summary?.suggestedPrice);
    const priceMessage = suggestedPrice ? ` Suggested price: ${suggestedPrice} SOL.` : '';
    const strategyMessage = result.summary?.selectionStrategy
      ? ` Strategy: ${result.summary.selectionStrategy}.`
      : '';
    if (failures.length > 0) {
      const firstFailure = failures[0];
      setMessage(
        danceMessage,
        `Command dispatched. ${successCount}/${responses.length} completed. `
          + `First failure: ${firstFailure.error || 'unknown error'}.${priceMessage}${strategyMessage}`,
        'error',
      );
    } else {
      setMessage(
        danceMessage,
        `Command dispatched. ${successCount}/${responses.length} robots completed move demo.${priceMessage}${strategyMessage}`,
        'success',
      );
    }
  } catch (error) {
    setMessage(danceMessage, error.message, 'error');
  }
});

colaForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(colaForm);
  const payload = {
    location: {
      lat: Number(formData.get('lat')),
      lng: Number(formData.get('lng')),
    },
    quantity: Number(formData.get('quantity')),
  };

  try {
    const result = await api.buyCola(payload);
    const commandResult = result.result || {};
    const summary = result.summary || {};
    const suggestedPrice = formatAmount(summary?.suggestedPrice);
    const priceMessage = suggestedPrice ? ` Suggested price: ${suggestedPrice} SOL.` : '';
    const status = commandResult.status || 'unknown';
    const robotId = commandResult.robotId || 'unknown';
    const strategy = summary.selectionStrategy || commandResult.selection?.strategy;
    const strategyMessage = strategy ? ` Strategy: ${strategy}.` : '';
    const message = `Command dispatched to robot ${robotId} with status ${status}.${priceMessage}${strategyMessage}`;
    setMessage(colaMessage, message, status === 'success' ? 'success' : 'error');
  } catch (error) {
    setMessage(colaMessage, error.message, 'error');
  }
});

setInterval(renderRobots, 15000);
initMap();
renderRobots();

