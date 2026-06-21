'use strict';

// Preset bundles — named default-sets keyed to the deploy archetypes observed across the
// Runpoint repos. A project picks one with "preset": "<name>" and overrides only the deltas.
// A preset seeds `deploy.strategy` + a channel skeleton; the project supplies the specifics
// (host, bucket, processes, urls), usually as "$ENV" references.

const PRESETS = {
  // Long-running Node host: rsync the repo + (re)start pm2 processes over SSH.
  'server-ssh': {
    deploy: { strategy: 'server-ssh', user: 'ec2-user', rsyncDelete: true, processes: [] },
    channels: { production: { stampPath: 'build-stamp.json', release: 'minor', healthPath: '/version' } },
  },
  // Static artifact synced to S3, optional CloudFront invalidation.
  'static-s3': {
    deploy: { strategy: 'static-s3', cacheControl: 'no-cache', delete: true },
    channels: { production: { stampPath: 'build-stamp.json', release: 'minor' } },
  },
  // Library consumed via git-tag: the tag IS the release.
  // No live URL → no server deploy; `verify` falls back to a tag/commit check.
  library: {
    deploy: { strategy: 'library' },
    channels: {},
  },
  // Repo-provided deploy command: the toolkit owns version/tag/stamp/verify,
  // the repo owns the actual deploy step.
  custom: {
    deploy: { strategy: 'custom', command: null },
    channels: { production: { stampPath: 'build-stamp.json', release: 'minor' } },
  },
};

function defaults(name) {
  if (!PRESETS[name]) throw new Error(`unknown preset "${name}" — available: ${names().join(', ')}`);
  return JSON.parse(JSON.stringify(PRESETS[name])); // deep clone so callers can't mutate the template
}

function names() { return Object.keys(PRESETS); }

module.exports = { defaults, names };
