import { randomBytes } from 'node:crypto';
export const id = (prefix: string) => `${prefix}_${randomBytes(6).toString('hex')}`;
