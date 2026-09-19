// Vercel entry point. Vercel serves public/ as static files and runs this function
// for every /api/* request. Everything else (the server logic) lives in server.js,
// so `npm start` on a normal server and Vercel share the same code.
import { createApp, createStore, loadConfig } from '../server.js';

let appPromise;

function build() {
  const cfg = loadConfig();
  return createStore(cfg).then((store) => createApp(cfg, store));
}

export default async function handler(req, res) {
  try {
    appPromise ??= build();
    const app = await appPromise;
    await app(req, res);
  } catch (e) {
    appPromise = undefined; // let the next request retry (e.g. a cold database)
    console.error(e);
    if (!res.headersSent) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'The Order could not be reached.' }));
    }
  }
}
