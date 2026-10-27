const pkg = require('../package.json');

// Metadata rilis opsional, diisi saat image/container dibangun.
const commit = process.env.RELEASE_COMMIT || null;
const builtAt = process.env.RELEASE_BUILT_AT || null;

// Fallback '0.0.0' bila package.json belum punya field version.
const version = pkg.version || '0.0.0';

module.exports = { version, commit, builtAt };
