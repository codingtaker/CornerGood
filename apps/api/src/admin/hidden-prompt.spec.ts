import { EventEmitter } from 'node:events';
import { FirstAdminError } from './first-admin';
import { readHiddenLine } from './hidden-prompt';

class FakeTerminal extends EventEmitter {
  isTTY = true;
  rawModes: boolean[] = [];
  setRawMode(mode: boolean) {
    this.rawModes.push(mode);
  }
  setEncoding() {}
  resume() {}
  pause() {}
  type(...chunks: string[]) {
    for (const chunk of chunks) this.emit('data', chunk);
  }
}

function setUp() {
  const input = new FakeTerminal();
  let written = '';
  const output = { write: (text: string) => (written += text) };
  return { input, output, written: () => written };
}

describe('readHiddenLine', () => {
  it('returns what was typed without echoing it, and restores the terminal', async () => {
    const { input, output, written } = setUp();
    const line = readHiddenLine('Password: ', input, output);
    input.type('s3cr', 'et é', '\r');
    await expect(line).resolves.toBe('s3cret é');
    expect(written()).toBe('Password: \n');
    expect(input.rawModes).toEqual([true, false]);
    expect(input.listenerCount('data')).toBe(0);
  });

  it('handles backspace and ignores arrow keys', async () => {
    const { input, output } = setUp();
    const line = readHiddenLine('Password: ', input, output);
    input.type('abcd', '\u007f', '\b', '\u001b[D', 'x\r');
    await expect(line).resolves.toBe('abx');
  });

  it('stops on Ctrl+C', async () => {
    const { input, output } = setUp();
    const line = readHiddenLine('Password: ', input, output);
    input.type('abc\u0003');
    await expect(line).rejects.toThrow(new FirstAdminError('Cancelled.'));
    expect(input.rawModes).toEqual([true, false]);
  });

  it('refuses to read from something other than a terminal', async () => {
    const { input, output, written } = setUp();
    input.isTTY = false;
    await expect(readHiddenLine('Password: ', input, output)).rejects.toThrow(
      'The password must be typed in an interactive terminal.',
    );
    expect(written()).toBe('');
  });
});
