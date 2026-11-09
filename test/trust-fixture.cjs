// Test-only CA trust: older Electron builds may ignore NODE_EXTRA_CA_CERTS.
// Restrict this to loopback TLS sockets; certificate and hostname checks stay enabled.
const tls = require('node:tls');
const fs = require('node:fs');
const connect = tls.connect;
const certificate = fs.readFileSync(process.env.NODE_EXTRA_CA_CERTS, 'utf8');
tls.connect = function (options, ...args) {
  const host = options.socket?.remoteAddress || options.host;
  if (host === '127.0.0.1' || host === '::ffff:127.0.0.1') {
    if (options.rejectUnauthorized === false) throw new Error('Test TLS certificate validation must stay enabled.');
    options = {...options, ca: [...tls.rootCertificates, certificate]};
  }
  return connect.call(this, options, ...args);
};
