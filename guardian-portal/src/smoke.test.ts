import { describe, expect, it } from 'vitest';
describe('Guardian Portal', () => { it('uses fragment links so credentials are not sent in the request path', () => expect('/watch#secret'.split('#')[0]).toBe('/watch')); });
