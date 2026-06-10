'use strict';

// verify — is a live environment really on the version it claims? Environment is REQUIRED
// (--staging | --production); URL from --url= or the STAGING_URL / PRODUCTION_URL env var.

const git = require('../git');
const http = require('../http');
const verifier = require('../verifier');
const report = require('../report');
const cli = require('../cli');
const { flag, hasFlag, positionals } = require('../args');

const USAGE = 'usage: verify (--staging | --production) [version] [--url=<override>] [--ref=origin/main] [--no-fetch] [--json]';

module.exports = async function verify(args) {
  const staging = hasFlag(args, 'staging');
  const production = hasFlag(args, 'production');
  if (staging === production) cli.fail(USAGE);
  const env = production ? 'production' : 'staging';

  const url = flag(args, 'url') || process.env[production ? 'PRODUCTION_URL' : 'STAGING_URL'];
  if (!url) cli.fail(`verify: no URL for ${env} — set ${production ? 'PRODUCTION_URL' : 'STAGING_URL'} or pass --url=<url>`);

  if (!hasFlag(args, 'no-fetch')) git.fetchTags('origin');

  let certificate;
  try {
    certificate = await http.getJson(`${url.replace(/\/+$/, '')}/version`);
  } catch (error) {
    cli.fail(`Could not read ${url}/version: ${error.message}`, 3);
  }

  const verdict = verifier.evaluate(certificate, {
    environment: `${env} (${url})`,
    target: positionals(args)[0] || flag(args, 'expect'),
    ref: flag(args, 'ref') || 'origin/main',
  });

  cli.print(report.render(verdict, { json: hasFlag(args, 'json') }));
  process.exit(verdict.exitCode);
};
