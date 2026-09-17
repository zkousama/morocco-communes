export default {
  fetch(request: Request): Response {
    return new Response(JSON.stringify({ marker: "worker-was-invoked", url: request.url }), {
      status: 418,
      headers: { "content-type": "application/json" },
    });
  },
};
