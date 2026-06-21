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

    // Remote script with `set -e` so any failure aborts and surfaces — never a half-applied
    // "success" (the earlier outage came from a masked npm-ci failure). Newline-separated so the
    // `|| true` stays scoped to the pm2 delete only.
    const remoteLines = ['set -e'];
    if (d.gitHttpsRewrite !== false) {
      // Public github deps resolve over https — no SSH key or token needed on the box.
      remoteLines.push('git config --global url."https://github.com/".insteadOf "ssh://git@github.com/"');
    }
    remoteLines.push(`cd '${d.appRoot}'`);
    // preRemote: repo-specific box steps after rsync, before install/restart (e.g. provision .env,
    // flip a feature flag). Each entry is a shell command.
    for (const cmd of (Array.isArray(d.preRemote) ? d.preRemote : [])) remoteLines.push(cmd);
    if (d.install !== false) remoteLines.push('npm ci --omit=dev');
    for (const p of d.processes) {
      const proc = typeof p === 'string' ? { name: p } : p;
      const script = proc.script || cfg.entry || 'index.js';
      remoteLines.push(`pm2 delete '${proc.name}' 2>/dev/null || true`);
      remoteLines.push(`pm2 start ${script} --name '${proc.name}' --update-env`);
    }
    remoteLines.push('pm2 save');
    run('ssh', [...sshOpts, target, remoteLines.join('\n')], { dryRun, log });
  },
};
