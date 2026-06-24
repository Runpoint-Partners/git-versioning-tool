'use strict';

// Configuration subsystem — resolve a project's versioning/deploy config from
//   preset defaults  <  project config  <  ($ENV resolution)
// with per-package selection for monorepos. Pure data + fs; no deploy side effects.
//
// Project config is read from (first found wins):
//   1. versioning.config.js      (module.exports = {...} — allows computed values / monorepo)
//   2. versioning.config.json
//   3. the "versioning" key in package.json
//
// Secrets are never stored here: string values of the form "$NAME" / "${NAME}" are resolved
// from process.env at load time, and *missing* refs are recorded (not thrown) so a command can
// print a precise "set these env vars" message before attempting a deploy.

const fs = require('fs');
const path = require('path');
const presets = require('./presets');

const CONFIG_FILES = ['versioning.config.js', 'versioning.config.json'];
const ENV_REF = /^\$\{?([A-Z0-9_]+)\}?$/;

function isPlainObject(v) {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

// deep-merge: override wins; plain objects merge recursively; arrays/scalars replace wholesale.
function merge(base, override) {
  if (!isPlainObject(base) || !isPlainObject(override)) {
    return override === undefined ? base : override;
  }
  const out = { ...base };
  for (const key of Object.keys(override)) {
    out[key] = isPlainObject(base[key]) && isPlainObject(override[key])
      ? merge(base[key], override[key])
      : override[key];
  }
  return out;
}

// Locate + load the raw project config. Returns { raw, source }; raw is null if none found.
function discover(cwd = process.cwd()) {
  for (const name of CONFIG_FILES) {
    const file = path.join(cwd, name);
    if (fs.existsSync(file)) {
      const raw = name.endsWith('.js') ? require(file) : JSON.parse(fs.readFileSync(file, 'utf8'));
      return { raw, source: name };
    }
  }
  const pkgFile = path.join(cwd, 'package.json');
  if (fs.existsSync(pkgFile)) {
    const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
    if (pkg.versioning) return { raw: pkg.versioning, source: 'package.json#versioning' };
  }
  return { raw: null, source: null };
}

// Monorepo: pick one package's config (root shared keys < that package's overrides).
// Single-package repos have no `packages` array → the raw config IS the package.
function selectPackage(raw, packageName) {
  if (!Array.isArray(raw.packages)) return { pkgConfig: raw, pkg: null };
  const names = raw.packages.map((p) => p.name).join(', ');
  if (!packageName) {
    const err = new Error(`multi-package repo — choose one with --package=<name> (have: ${names})`);
    err.code = 'NEEDS_PACKAGE';
    throw err;
  }
  const found = raw.packages.find((p) => p.name === packageName);
  if (!found) {
    const err = new Error(`unknown package "${packageName}" — have: ${names}`);
    err.code = 'UNKNOWN_PACKAGE';
    throw err;
  }
  const { packages, ...shared } = raw;
  return { pkgConfig: merge(shared, found), pkg: { name: found.name, path: found.path || '.' } };
}

// Recursively resolve "$NAME"/"${NAME}" strings from env; collect every ref + whether it's set.
function resolveEnv(value, env = process.env, refs = []) {
  if (typeof value === 'string') {
    const m = value.match(ENV_REF);
    if (!m) return value;
    const resolved = env[m[1]];
    refs.push({ ref: m[1], set: resolved !== undefined && resolved !== '' });
    return resolved === undefined ? null : resolved;
  }
  if (Array.isArray(value)) return value.map((v) => resolveEnv(v, env, refs));
  if (isPlainObject(value)) {
    const out = {};
    for (const k of Object.keys(value)) out[k] = resolveEnv(value[k], env, refs);
    return out;
  }
  return value;
}

// Produce a fully-resolved config for a given channel + package. Precedence (low→high):
// preset defaults  <  project config  <  env resolution. CLI-flag overrides are applied by
// the individual commands on top of this (flag > env > config).
function resolve({ cwd = process.cwd(), channel = null, packageName = null, env = process.env } = {}) {
  const { raw, source } = discover(cwd);
  if (!raw) {
    const err = new Error('no versioning config found — add a "versioning" key to package.json or a versioning.config.js');
    err.code = 'NO_CONFIG';
    throw err;
  }
  const { pkgConfig, pkg } = selectPackage(raw, packageName);
  const presetName = pkgConfig.preset || null;
  const merged = merge(presetName ? presets.defaults(presetName) : {}, pkgConfig);

  const refs = [];
  const resolved = resolveEnv(merged, env, refs);

  resolved._meta = { source, preset: presetName, package: pkg, envRefs: refs };
  resolved.channelName = channel;
  resolved.channelConfig = channel && resolved.channels ? (resolved.channels[channel] || null) : null;
  // A channel may override deploy specifics (e.g. a per-channel host for a SEPARATE staging box).
  // Merge channels.<channel>.deploy over the base deploy so the strategy sees the channel's values.
  // Backward-compatible: a channel with no `deploy` block of its own changes nothing.
  if (resolved.channelConfig && isPlainObject(resolved.channelConfig.deploy)) {
    resolved.deploy = merge(resolved.deploy || {}, resolved.channelConfig.deploy);
  }
  return resolved;
}

// Read a dotted path out of a resolved config (used by `rpv config get` + the workflow).
function get(config, dotpath) {
  return dotpath.split('.').reduce((acc, key) => (acc == null ? acc : acc[key]), config);
}

module.exports = { resolve, discover, selectPackage, merge, resolveEnv, get, isPlainObject };
