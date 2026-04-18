import readline from 'node:readline';

import type { HelperRequest, HelperResponse } from './helper-protocol.ts';
import { handleHelperRequest } from './helper-service.ts';

const rl = readline.createInterface({
  input: process.stdin,
  crlfDelay: Infinity,
});

async function handleLine(line: string): Promise<void> {
  if (!line.trim()) {
    return;
  }

  let request: HelperRequest;
  try {
    request = JSON.parse(line) as HelperRequest;
  } catch {
    const response: HelperResponse = {
      id: 'unknown',
      error: {
        code: 'INVALID_JSON',
        message: 'helper request is not valid JSON',
      },
    };
    process.stdout.write(`${JSON.stringify(response)}\n`);
    return;
  }

  try {
    const result = await handleHelperRequest(request);
    const response: HelperResponse = {
      id: request.id,
      result,
    };
    process.stdout.write(`${JSON.stringify(response)}\n`);
  } catch (error) {
    const response: HelperResponse = {
      id: request.id,
      error: {
        code: 'REQUEST_FAILED',
        message: error instanceof Error ? error.message : String(error),
      },
    };
    process.stdout.write(`${JSON.stringify(response)}\n`);
  }
}

rl.on('line', (line) => {
  void handleLine(line);
});

rl.on('close', () => {
  process.exit(0);
});
