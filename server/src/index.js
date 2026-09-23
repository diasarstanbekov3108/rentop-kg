import http from 'node:http';
import { loadConfig } from './config.js';

// The HTTP process is intentionally small at this stage. The Telegram workflow
// will be added only after the MVP migration and BotFather configuration are ready.
// Secrets are read only from server/.env and must never be copied to frontend files.
const config = loadConfig();

const server = http.createServer((request, response) => {
  if (request.method === 'GET' && request.url === '/health') {
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8' });
    response.end(JSON.stringify({ ok: true, service: 'rentop-telegram-mvp' }));
    return;
  }

  response.writeHead(404, { 'content-type': 'application/json; charset=utf-8' });
  response.end(JSON.stringify({ error: 'Not found' }));
});

server.listen(config.port, () => {
  console.log(`Rentop MVP server is listening on port ${config.port}`);
});
