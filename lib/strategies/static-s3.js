'use strict';

// static-s3 — sync a built artifact directory to an S3 prefix (optionally invalidate a
// CloudFront distribution). AWS auth is configured by the CI step (OIDC role or keys); this
// strategy only issues the sync/invalidation.

const { run } = require('../exec');

module.exports = {
  name: 'static-s3',

  validate(cfg) {
    const d = cfg.deploy || {};
    const missing = [];
    if (!d.bucket) missing.push('deploy.bucket');
    if (!d.artifactDir) missing.push('deploy.artifactDir (local directory to upload)');
    return missing;
  },

  async deploy({ cfg, dryRun, log }) {
    const d = cfg.deploy;
    const prefix = String(d.prefix || '').replace(/^\/+|\/+$/g, '');
    const dest = `s3://${d.bucket}${prefix ? `/${prefix}` : ''}/`;

    const args = ['s3', 'sync', d.artifactDir, dest];
    if (d.delete !== false) args.push('--delete');
    if (d.cacheControl) args.push('--cache-control', d.cacheControl);
    if (d.acl) args.push('--acl', d.acl);
    run('aws', args, { dryRun, log });

    if (d.cloudfrontDistributionId) {
      run('aws', ['cloudfront', 'create-invalidation', '--distribution-id', d.cloudfrontDistributionId, '--paths', '/*'],
        { dryRun, log });
    }
  },
};
