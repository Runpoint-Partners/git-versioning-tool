'use strict';

// server-ssh — deploy a Node app to a long-running host: rsync the repo (byte-for-byte, so the
// box always equals a real commit), then (re)start each pm2 process. Host/auth specifics come
// from config.deploy + env-resolved secrets (sshKey is a path to a key file the CI step writes).

const { run } = require('../exec');

const DEFAULT_EXCLUDES = ['.git/', '.env', 'node_modules/', 'data/', 'backups/'];

module.exports = {
  name: 'server-ssh',

  validate(cfg) {
    const d = cfg.deploy || {};
    const missing = [];
    if (!d.host) missing.push('deploy.host');
    if (!d.appRoot) missing.push('deploy.appRoot');
    if (!d.sshKey) missing.push('deploy.sshKey (path to the private key the CI step writes)');
    if (!Array.isArray(d.processes) || d.processes.length === 0) missing.push('deploy.processes[]');
    return missing;
  },

  async deploy({ cfg, dryRun, log }) {
    const d = cfg.deploy;
    const user = d.user || 'ec2-user';
    const target = `${user}@${d.host}`;
    const sshOpts = ['-i', d.sshKey, '-o', 'IdentitiesOnly=yes'];

    const rsyncArgs = ['-az'];
    if (d.rsyncDelete !== false) rsyncArgs.push('--delete');
    for (const ex of [...DEFAULT_EXCLUDES, ...(d.exclude || [])]) rsyncArgs.push(`--exclude=${ex}`);
    rsyncArgs.push('-e', `ssh ${sshOpts.join(' ')}`, './', `${target}:${d.appRoot}/`);
    run('rsync', rsyncArgs, { dryRun, log });

    const remote = [
      `cd '${d.appRoot}'`,
      // preRemote: repo-specific box steps run after rsync, before install/restart
      // (e.g. provision .env, flip a feature flag). Each entry is a shell command.
      ...(Array.isArray(d.preRemote) ? d.preRemote : []),
      d.install === false ? null : 'npm ci --omit=dev',
      ...d.processes.map((p) => {
        const proc = typeof p === 'string' ? { name: p } : p;
        const script = proc.script || cfg.entry || 'index.js';
        return `pm2 delete '${proc.name}' >/dev/null 2>&1 || true; pm2 start ${script} --name '${proc.name}' --update-env`;
      }),
      'pm2 save',
    ].filter(Boolean).join(' && ');
    run('ssh', [...sshOpts, target, remote], { dryRun, log });
  },
};
