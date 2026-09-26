import { describe, it, expect, vi, afterEach } from "vitest";
import { TelegramNotifier, NullNotifier } from "./telegram.js";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("NullNotifier", () => {
  it("does nothing and never calls the network", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    await new NullNotifier().send("hi");
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe("TelegramNotifier", () => {
  it("POSTs the message to the Telegram API with chat id and text", async () => {
    const fetchSpy = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal("fetch", fetchSpy);

    await new TelegramNotifier("TOKEN123", "CHAT456").send("hello world");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(url).toBe("https://api.telegram.org/botTOKEN123/sendMessage");
    expect(init.method).toBe("POST");
    const body = JSON.parse(init.body as string);
    expect(body.chat_id).toBe("CHAT456");
    expect(body.text).toBe("hello world");
  });

  it("swallows a network error instead of throwing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await expect(new TelegramNotifier("t", "c").send("x")).resolves.toBeUndefined();
  });

  it("swallows a non-OK response instead of throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({ ok: false, status: 400, text: async () => "bad request" }),
    );
    await expect(new TelegramNotifier("t", "c").send("x")).resolves.toBeUndefined();
  });
});
