const levels = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const levelFromEnv = () => {
  const value = (process.env.LOG_LEVEL || '').toLowerCase();
  if (value in levels) {
    return value;
  }
  return 'info';
};

const currentLevel = levelFromEnv();

const shouldLog = (level) => levels[level] >= levels[currentLevel];

const formatMessage = (level, message, context) => {
  const timestamp = new Date().toISOString();
  const base = `[${timestamp}] [${level.toUpperCase()}]`;
  if (!context) {
    return `${base} ${message}`;
  }
  try {
    return `${base} ${message} ${JSON.stringify(context)}`;
  } catch {
    return `${base} ${message} ${context}`;
  }
};

const logger = {
  debug(message, context) {
    if (shouldLog('debug')) {
      console.debug(formatMessage('debug', message, context));
    }
  },

  info(message, context) {
    if (shouldLog('info')) {
      console.info(formatMessage('info', message, context));
    }
  },

  warn(message, context) {
    if (shouldLog('warn')) {
      console.warn(formatMessage('warn', message, context));
    }
  },

  error(message, context) {
    if (shouldLog('error')) {
      console.error(formatMessage('error', message, context));
    }
  },
};

module.exports = logger;

