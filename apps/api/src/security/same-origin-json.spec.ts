import type { Request, Response } from 'express';
import { isJson, sameOriginJson } from './same-origin-json';

function run(method: string, headers: Record<string, string>) {
  const guard = sameOriginJson(['http://localhost:3000']);
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  const next = jest.fn();
  guard(
    { method, headers } as unknown as Request,
    response as unknown as Response,
    next,
  );
  return { status: next.mock.calls.length ? 'next' : response.statusCode };
}

const json = { 'content-type': 'application/json', 'content-length': '20' };

describe('sameOriginJson', () => {
  it('lets the web app post JSON', () => {
    expect(
      run('POST', {
        ...json,
        origin: 'http://localhost:3000',
        'sec-fetch-site': 'same-origin',
      }).status,
    ).toBe('next');
  });

  it.each([
    ['application/x-www-form-urlencoded'],
    ['multipart/form-data; boundary=x'],
    ['text/plain'],
    [''],
  ])('refuses a %s body: what an HTML form can send', (type) => {
    expect(
      run('POST', { 'content-type': type, 'content-length': '20' }).status,
    ).toBe(415);
  });

  it('refuses a request from another site, even with JSON', () => {
    expect(
      run('POST', { ...json, origin: 'https://evil.example' }).status,
    ).toBe(403);
    expect(
      run('POST', { ...json, 'sec-fetch-site': 'cross-site' }).status,
    ).toBe(403);
  });

  it('accepts a POST without a body, such as sign-out', () => {
    expect(run('POST', { origin: 'http://localhost:3000' }).status).toBe(
      'next',
    );
  });

  it('accepts requests that do not come from a browser', () => {
    expect(run('POST', json).status).toBe('next');
  });

  it('leaves reads alone', () => {
    expect(run('GET', { origin: 'https://evil.example' }).status).toBe('next');
  });

  it('reads the media type, whatever its parameters or case', () => {
    expect(isJson('Application/JSON; charset=utf-8')).toBe(true);
    expect(isJson('application/json-patch+json')).toBe(false);
  });
});
