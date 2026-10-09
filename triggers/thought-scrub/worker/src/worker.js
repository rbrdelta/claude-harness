// Link previews (Telegram fetches URLs to build a card) are not clicks.
const PREVIEW_BOTS = /TelegramBot|bot|crawler|spider|preview/i;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const match = url.pathname.match(/^\/r\/([A-Za-z0-9_-]{1,64})$/);
    if (url.pathname === "/health") return new Response("ok");
    if (!match) return new Response("not found", { status: 404 });

    const ua = request.headers.get("user-agent") || "";
    if (!PREVIEW_BOTS.test(ua)) {
      await env.DB.prepare("INSERT INTO clicks (ping_id, clicked_at, user_agent) VALUES (?, ?, ?)")
        .bind(match[1], new Date().toISOString(), ua.slice(0, 200))
        .run();
    }
    return Response.redirect(env.TARGET, 302);
  },
};
