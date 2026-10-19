import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { parseNetworkUrl } from './network-url.mjs';

const require = createRequire(import.meta.url);
const qr = require('qrcode-terminal');
const nextCli = require.resolve('next/dist/bin/next');
const server = spawn(process.execPath, [nextCli, 'dev', ...process.argv.slice(2)], {
  stdio: ['inherit', 'pipe', 'inherit'],
});

let output = '';
let qrShown = false;
server.stdout.setEncoding('utf8');
server.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  if (qrShown) return;

  output = `${output}${chunk}`.slice(-4000);
  const url = parseNetworkUrl(output);
  if (url) {
    qrShown = true;
    process.stdout.write(`\nScan this QR code to open the dev app on your network:\n${url}\n`);
    qr.generate(url, { small: true });
  }
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.kill(signal));
}

server.on('error', (error) => {
  process.stderr.write(`Could not start Next.js dev server: ${error.message}\n`);
  process.exitCode = 1;
});
server.on('close', (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
