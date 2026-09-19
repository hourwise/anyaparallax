import type { EntryContext } from "react-router";
import { ServerRouter } from "react-router";
import { renderToReadableStream } from "react-dom/server";

export default async function handleRequest(
  request: Request,
  responseStatusCode: number,
  responseHeaders: Headers,
  routerContext: EntryContext,
): Promise<Response> {
  let shellRendered = false;

  const stream = await renderToReadableStream(
    <ServerRouter context={routerContext} url={request.url} />,
    {
      onError(error: unknown) {
        responseStatusCode = 500;
        if (shellRendered) {
          console.error(error);
        }
      },
    },
  );

  shellRendered = true;

  // HEAD/OPTIONS responses must not carry a body, so discard the render rather
  // than streaming it.
  if (request.method === "HEAD" || request.method === "OPTIONS") {
    await stream.cancel();
    return new Response(null, {
      headers: responseHeaders,
      status: responseStatusCode,
    });
  }

  responseHeaders.set("Content-Type", "text/html; charset=utf-8");

  return new Response(stream, {
    headers: responseHeaders,
    status: responseStatusCode,
  });
}
