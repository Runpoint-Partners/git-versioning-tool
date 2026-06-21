'use strict';

// custom — the toolkit owns version/tag/stamp/verify; the repo owns the actual deploy via a
// declared command (string "bash scripts/deploy.sh" or an argv array). Version/channel/commit
// are exported into the command's environment so the script can use them.

const { execFileSync } = require('child_process');

module.exports = {
  name: 'custom',

  validate(cfg) {
    return cfg.deploy && cfg.deploy.command ? [] : ['deploy.command'];
  },

  async deploy({ cfg, channel, dryRun, log }) {
    const cmd = cfg.deploy.command;
    const [bin, ...args] = Array.isArray(cmd) ? cmd : String(cmd).split(' ').filter(Boolean);
    const line = `${bin} ${args.join(' ')}`;
    if (dryRun) { log(`  (dry-run) ${line}`); return; }
    log(`  $ ${line}`);
    execFileSync(bin, args, {
      stdio: 'inherit',
      env: { ...process.env, RPV_CHANNEL: channel, RPV_APP: cfg.appName || '' },
    });
  },
};
