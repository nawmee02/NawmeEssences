// The card renderer now lives in js/render-card.js (UMD) so the browser's
// "Recommended for you" rail and the build share ONE implementation.
// This shim keeps every existing require('./lib/render-card') working.
module.exports = require('../../js/render-card');
