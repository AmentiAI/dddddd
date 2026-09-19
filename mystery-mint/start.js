import { start } from './server.js';

start().catch((e) => {
  console.error(`\nCould not start: ${e.message}\n`);
  process.exit(1);
});
