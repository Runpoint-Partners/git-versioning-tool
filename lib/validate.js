'use strict';

// Validate a resolved config: appName present, the deploy strategy resolvable, its required
// fields supplied, and which $ENV references are still unset. Returns a structured report
// (never throws on a config problem) so `rpv config print` and `rpv deploy` can fail loudly
// with a precise list BEFORE anything touches a real environment.

const strategies = require('./strategies');

function validate(config, { cwd } = {}) {
  const errors = [];
  if (!config.appName) errors.push('appName is required');

  const strategyName = config.deploy && config.deploy.strategy;
  let strategy = null;
  try {
    strategy = strategies.load(strategyName, { cwd });
  } catch (err) {
    errors.push(err.message);
  }
  if (strategy && typeof strategy.validate === 'function') {
    for (const field of strategy.validate(config)) errors.push(`missing ${field}`);
  }

  const envRefs = (config._meta && config._meta.envRefs) || [];
  const missingEnv = envRefs.filter((r) => !r.set).map((r) => r.ref);

  return { errors, missingEnv, strategy: strategyName };
}

module.exports = { validate };
