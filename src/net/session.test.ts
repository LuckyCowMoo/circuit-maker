import { describe, expect, it } from 'vitest';
import { acceptEdit, decodeCode, encodeCode } from './session';

describe('peer codes', () => {
  it('round-trips a connection description', async () => {
    const text = JSON.stringify({
      type: 'offer',
      sdp: 'v=0\r\n' + 'a=candidate:1 1 udp 1 192.168.1.1 9 typ host\r\n'.repeat(40),
    });
    const code = await encodeCode(text);
    expect(code).not.toContain('+');
    expect(code).not.toContain('/');
    expect(await decodeCode(code)).toBe(text);
  });

  it('accepts a guest edit only at the host revision', () => {
    expect(acceptEdit(3, 3)).toBe(true);
    expect(acceptEdit(3, 2)).toBe(false);
    expect(acceptEdit(0, 1)).toBe(false);
  });
});
