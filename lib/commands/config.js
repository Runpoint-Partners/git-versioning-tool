'use strict';

// config — inspect the resolved configuration.
//   rpv config print [--channel=] [--package=]   show resolved config + env-ref status + validation
//   rpv config get <dotpath> [--channel=] [--package=]   print one resolved value (for scripts/CI)

const config = require('../config');
const { validate } = require('../validate');
const cli = require('../cli');
const { flag, positionals } = require('../args');

module.exports = function configCmd(args) {
  const [sub = 'print', dotpath] = positionals(args);
  const channel = flag(args, 'channel');
  const packageName = flag(args, 'package');

  let resolved;
  try {
    resolved = config.resolve({ channel, packageName });
  } catch (err) {
    cli.fail(`config: ${err.message}`);
  }

  if (sub === 'get') {
    if (!dotpath) cli.fail('usage: rpv config get <dotpath> [--channel=] [--package=]');
    const value = config.get(resolved, dotpath);
    cli.print(value == null ? '' : typeof value === 'object' ? JSON.stringify(value) : String(value));
    return;
  }
  if (sub !== 'print') cli.fail('usage: rpv config (print | get <dotpath>) [--channel=] [--package=]');

  const view = { ...resolved };
  delete view._meta;
  cli.print(JSON.stringify(view, null, 2));
  cli.print('');
  cli.print(`source:  ${resolved._meta.source}`);
  cli.print(`preset:  ${resolved._meta.preset || '(none)'}`);
  if (resolved._meta.package) cli.print(`package: ${resolved._meta.package.name} (${resolved._meta.package.path})`);

  const refs = resolved._meta.envRefs;
  if (refs.length) {
    cli.print('env refs:');
    for (const r of refs) cli.print(`  [${r.set ? 'ok' : '--'}] $${r.ref}${r.set ? '' : '  (missing)'}`);
  }

  const { errors, missingEnv } = validate(resolved);
  if (errors.length) {
    cli.print('\nERRORS:');
    for (const e of errors) cli.print(`  - ${e}`);
    process.exit(1);
  }
  cli.print(`\nOK — config valid${missingEnv.length ? ` (but ${missingEnv.length} env ref(s) unset: ${missingEnv.join(', ')})` : ''}`);
};
