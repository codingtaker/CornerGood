import { FirstAdminError } from './first-admin';

/** The part of a terminal stream the prompt uses (process.stdin in practice). */
export interface PromptInput {
  isTTY?: boolean;
  setRawMode(mode: boolean): unknown;
  setEncoding(encoding: BufferEncoding): unknown;
  resume(): unknown;
  pause(): unknown;
  on(event: 'data', listener: (chunk: string) => void): unknown;
  removeListener(event: 'data', listener: (chunk: string) => void): unknown;
}

export interface PromptOutput {
  write(text: string): unknown;
}

const ENTER = /[\r\n]/;
const CTRL_C = '\u0003';
const CTRL_D = '\u0004';
const BACKSPACE = /^[\b\u007f]$/;
const ESCAPE = '\u001b';

/**
 * Reads one line from the terminal without echoing it. Raw mode is needed:
 * node:readline has no option to hide what is typed.
 */
export function readHiddenLine(
  question: string,
  input: PromptInput = process.stdin,
  output: PromptOutput = process.stdout,
): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!input.isTTY) {
      reject(
        new FirstAdminError(
          'The password must be typed in an interactive terminal.',
        ),
      );
      return;
    }

    let value: string[] = [];
    const finish = (error?: Error) => {
      input.removeListener('data', onData);
      input.setRawMode(false);
      input.pause();
      output.write('\n');
      if (error) reject(error);
      else resolve(value.join(''));
    };
    const onData = (chunk: string) => {
      // Arrow and function keys send escape sequences: ignore them whole.
      if (chunk.startsWith(ESCAPE)) return;
      for (const char of chunk) {
        if (ENTER.test(char)) return finish();
        if (char === CTRL_C || char === CTRL_D) {
          value = [];
          return finish(new FirstAdminError('Cancelled.'));
        }
        if (BACKSPACE.test(char)) value.pop();
        else if (char >= ' ') value.push(char);
      }
    };

    output.write(question);
    input.setRawMode(true);
    input.setEncoding('utf8');
    input.on('data', onData);
    input.resume();
  });
}
