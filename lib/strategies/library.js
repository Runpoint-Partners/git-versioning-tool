'use strict';

// library — the git tag IS the release. The version core (resolve-release + the workflow's
// tag push) already published it; there's no server to deploy to, so deploy is a no-op.
// `verify` for libraries means "the published tag's commit matches HEAD", handled by the
// version core's tag/commit check rather than a live URL fetch.

module.exports = {
  name: 'library',
  validate() { return []; },
  async deploy({ log }) {
    log('  library: no deploy step — the pushed git tag is the release.');
  },
};
