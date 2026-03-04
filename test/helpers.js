/**
 * Shared test helpers for server route tests.
 */

/** Create a mock ServerResponse that captures statusCode, headers, and JSON body. */
export function mockRes(status = 200) {
  return {
    statusCode: status,
    headers: {},
    setHeader(k, v) { this.headers[k] = v; },
    end(data) { this._body = data; },
    _body: null,
    get body() { return JSON.parse(this._body || "{}"); },
  };
}

/** Create a mock IncomingMessage that streams a JSON body. */
export function mockReq(method, url, body = {}, headers = {}) {
  const buf = Buffer.from(JSON.stringify(body));
  return {
    method,
    url,
    headers: { "content-type": "application/json", "host": "localhost:3000", ...headers },
    on(event, handler) {
      if (event === "data") setTimeout(() => handler(buf), 0);
      if (event === "end") setTimeout(() => handler(), 0);
      return this;
    },
  };
}

/** Standard respondJson implementation for route tests. */
export function respondJson(res, status, data) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(data));
}
