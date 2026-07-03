import type { TwitchStreamStatus } from "./twitch-config";
import type { TwitchConfig } from "./twitch-integration";
import type { TwitchPlugin } from "./twitch-plugin";
import { buildTwitchUrl } from "./runtime/twitch-plugin-config";

function jsonResponse(body: unknown, status: number = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function handleTwitchPluginEndpoint(
  plugin: TwitchPlugin,
  request: Request,
  path: string,
): Promise<Response | null> {
  if (path === "/status" && request.method === "GET") {
    const runtimeConfig = await plugin.buildRuntimeConfig();
    const status = await plugin.getBotStatus();
    const streamStatus = plugin.getStreamStatus();
    return jsonResponse({
      enabled: plugin.isEnabled(),
      connected: status.connected,
      error: status.error,
      lastActivity: status.lastActivity,
      live: streamStatus.live,
      title: streamStatus.title || null,
      gameName: streamStatus.gameName || null,
      viewerCount: streamStatus.viewerCount,
      url: streamStatus.url,
      channelName: runtimeConfig?.channelName,
      username: runtimeConfig?.username,
      autoStart: runtimeConfig?.autoStart ?? false,
    });
  }

  if (path === "/start" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    if (body && typeof body === "object" && "config" in body) {
      await plugin.updateConfig((body as { config: Record<string, unknown> }).config);
    }

    const result = await plugin.startBot();
    return jsonResponse(result, result.success ? 200 : 400);
  }

  if (path === "/stop" && request.method === "POST") {
    const result = await plugin.stopBot();
    return jsonResponse(result, result.success ? 200 : 400);
  }

  if ((path === "/test" || path === "/test-connection") && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const runtimeConfig = await plugin.buildRuntimeConfig(
      (body || {}) as Partial<TwitchConfig>,
    );

    if (!runtimeConfig) {
      return jsonResponse(
        { success: false, error: "Twitch credentials are incomplete" },
        400,
      );
    }

    const result = await plugin.testConnection(runtimeConfig);
    return jsonResponse(
      {
        ...result,
        connected: result.success,
        username: result.userInfo?.login,
        userId: result.userInfo?.id,
      },
      result.success ? 200 : 400,
    );
  }

  if (path === "/action/go-live" && request.method === "POST") {
    const body = await request.json().catch(() => ({}));
    const runtimeConfig = await plugin.buildRuntimeConfig();
    const nextStatus: TwitchStreamStatus = {
      live: true,
      title:
        typeof body?.title === "string" && body.title.trim().length > 0
          ? body.title.trim()
          : "Live with Phantasy",
      url: buildTwitchUrl(runtimeConfig?.channelName),
      viewerCount: 0,
    };
    plugin.setStreamStatus(nextStatus);
    plugin.touchLastActivity();

    return jsonResponse({
      success: true,
      live: true,
      title: nextStatus.title,
      url: nextStatus.url,
    });
  }

  if (path === "/action/end" && request.method === "POST") {
    const currentStatus = plugin.getStreamStatus();
    const nextStatus: TwitchStreamStatus = {
      ...currentStatus,
      live: false,
      viewerCount: 0,
    };
    plugin.setStreamStatus(nextStatus);
    plugin.touchLastActivity();

    return jsonResponse({
      success: true,
      live: false,
      title: nextStatus.title,
      url: nextStatus.url,
    });
  }

  return null;
}
