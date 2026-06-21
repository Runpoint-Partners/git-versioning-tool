'use strict';

// Boundary: minimal JSON-over-HTTP(S) GET. Rejects on non-200, bad JSON, or timeout.

const http = require('http');
const https = require('https');

function getJson(url, { timeoutMs = 15000 } = {}) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith('https:') ? https : http;
    const request = client.get(url, { timeout: timeoutMs }, (response) => {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode}`));
        return;
      }
      let body = '';
      response.on('data', (chunk) => { body += chunk; });
      response.on('end', () => {
        try { resolve(JSON.parse(body)); }
        catch (error) { reject(new Error(`invalid JSON: ${error.message}`)); }
      });
    });
    request.on('timeout', () => request.destroy(new Error('timeout')));
    request.on('error', reject);
  });
}

module.exports = { getJson };
