'use strict';

// init — scaffold a "versioning" config block into the consumer's package.json for a chosen
// preset. Fill in the CHANGE-ME / $ENV values, then `rpv config print` to validate.
//   rpv init --preset server-ssh | static-s3 | library | custom  [--dry-run]

const fs = require('fs');
const path = require('path');
const presets = require('../presets');
const cli = require('../cli');
const { flag, hasFlag } = require('../args');

const SCAFFOLD = {
  'server-ssh': {
    appName: 'CHANGE-ME', preset: 'server-ssh',
    channels: { production: { url: '$PRODUCTION_URL', stampPath: 'build-stamp.json' } },
    deploy: {
      strategy: 'server-ssh', host: '$DEPLOY_HOST', user: 'ec2-user',
      appRoot: '/home/ec2-user/app', sshKey: '$DEPLOY_SSH_KEY_PATH',
      processes: [{ name: 'app', script: 'index.js' }],
    },
  },
  'static-s3': {
    appName: 'CHANGE-ME', preset: 'static-s3',
    channels: { production: { url: '$PRODUCTION_URL' } },
    deploy: { strategy: 'static-s3', bucket: 'CHANGE-ME', prefix: 'app/v1', artifactDir: 'dist' },
  },
  library: { appName: 'CHANGE-ME', preset: 'library' },
  custom: {
    appName: 'CHANGE-ME', preset: 'custom',
    deploy: { strategy: 'custom', command: 'bash scripts/deploy.sh' },
  },
};

module.exports = function init(args) {
  const preset = flag(args, 'preset') || 'library';
  if (!SCAFFOLD[preset]) cli.fail(`init: unknown preset "${preset}" — available: ${presets.names().join(', ')}`);

  const pkgPath = path.resolve('package.json');
  if (!fs.existsSync(pkgPath)) cli.fail('init: no package.json in the current directory');
  const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
  if (pkg.versioning) cli.fail('init: package.json already has a "versioning" block — edit it directly');

  pkg.versioning = SCAFFOLD[preset];
  const out = `${JSON.stringify(pkg, null, 2)}\n`;
  if (hasFlag(args, 'dry-run')) { cli.print(out); return; }

  fs.writeFileSync(pkgPath, out);
  cli.print(`Added a "${preset}" versioning block to package.json.`);
  cli.print('Next: edit the CHANGE-ME / $ENV values, run "rpv config print" to validate, then wire the reusable workflow (see SETUP.md).');
};
