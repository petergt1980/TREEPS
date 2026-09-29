import type { IncomingMessage, ServerResponse } from 'node:http';
import { handle } from '../_handler';

export default async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  return handle(req, res);
}
