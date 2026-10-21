// Puts the CORS answers of a real bucket (see docs/r2-cors.json) in front of the local S3 emulator,
// which has none: the browser sends photos to it from another origin during the end-to-end tests.
import http from "node:http";

const TARGET = new URL(process.env.S3_TEST_ENDPOINT ?? "http://127.0.0.1:9100");
const PORT = Number(process.env.S3_PROXY_PORT ?? 9101);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "PUT, GET, HEAD, OPTIONS",
  "access-control-allow-headers": "*",
  "access-control-expose-headers": "ETag",
};

http
  .createServer((request, response) => {
    if (request.method === "OPTIONS") {
      response.writeHead(204, CORS).end();
      return;
    }
    // The signature covers the host the client used: it is forwarded unchanged.
    const upstream = http.request(
      {
        host: TARGET.hostname,
        port: TARGET.port,
        method: request.method,
        path: request.url,
        headers: request.headers,
      },
      (answer) => {
        response.writeHead(answer.statusCode ?? 502, { ...answer.headers, ...CORS });
        answer.pipe(response);
      },
    );
    upstream.on("error", () => response.writeHead(502, CORS).end());
    request.pipe(upstream);
  })
  .listen(PORT, "127.0.0.1");
