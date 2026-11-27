import test from "node:test";
import assert from "node:assert/strict";
import { summarize, minutesPerEpisode, durationText } from "../src/lib/domain/dashboard.ts";
import { readFile } from "node:fs/promises";
import vm from "node:vm";

test("看板覆盖全部状态与评分桶，类型去重，估算时长按真实进度", () => {
  const stats = summarize([
    {
      watch_status: "completed",
      watched_episodes: 24,
      platform: "TV",
      personal_rating: 10,
      meta_tags: [" 科幻", "科幻", "日常"],
    },
    {
      watch_status: "watching",
      watched_episodes: 6,
      platform: "TV",
      personal_rating: null,
      meta_tags: [],
    },
    {
      watch_status: "dropped",
      watched_episodes: 0,
      platform: null,
      personal_rating: 1,
      meta_tags: ["日常"],
    },
  ]);
  assert.deepEqual(
    stats.states.map((s) => s.count),
    [1, 0, 1, 0, 1],
  );
  assert.equal(stats.count, 3);
  assert.equal(stats.episodes, 30);
  assert.equal(durationText(stats.episodes, 24), "12 小时");
  assert.equal(durationText(stats.episodes, 20), "10 小时");
  assert.equal(durationText(1, 75), "1 小时 15 分钟");
  assert.equal(durationText(0, 24), "0 分钟");
  assert.equal(stats.unrated, 1);
  assert.deepEqual(
    stats.ratings.map((r) => r.count),
    [1, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  );
  assert.deepEqual(Object.fromEntries(stats.genres.map((r) => [r.name, r.count])), {
    科幻: 1,
    日常: 2,
    未分类: 1,
  });
  assert.equal(stats.platforms[0].count, 2);
  assert.equal(summarize([]).ratings.length, 10);
});
test("每集时长沿用数据库允许范围", () => {
  for (const n of [1, 24, 1440]) assert.equal(minutesPerEpisode(String(n)), n);
  for (const n of ["", null, 0, 1.5, -1, 1441]) assert.throws(() => minutesPerEpisode(n));
});
test("PWA 的唯一预缓存为公共离线页，鉴权/API/RSC 请求不经过离线回退", async () => {
  const origin = "https://journal.test";
  type MockRequest = { mode: string; url: string; method: string };
  type WorkerEvent = {
    request?: MockRequest;
    waitUntil?: (operation: Promise<void>) => void;
    respondWith?: (response: Promise<unknown>) => void;
  };
  const handlers: Record<string, (ev: WorkerEvent) => void> = {};
  const shellRequests: Request[] = [],
    cleaned: string[] = [];
  const shell = {
    add: async (req: Request) => {
      shellRequests.push(req);
    },
    match: async (path: string) => (path === "/offline.html" ? "offline" : undefined),
  };
  let network = true;
  // Node Request resolves only absolute URLs. A service worker resolves paths relative to its URL.
  class WorkerRequest extends Request {
    constructor(path: string, opts: RequestInit) {
      super(new URL(path, origin), opts);
    }
  }
  const context = {
    self: {
      location: { origin },
      clients: { claim: async () => {} },
      skipWaiting: async () => {},
      addEventListener: (name: string, handler: (ev: WorkerEvent) => void) => {
        handlers[name] = handler;
      },
    },
    caches: {
      open: async () => shell,
      keys: async () => ["unrelated", "bangumi-journal-shell-old", "bangumi-journal-shell-v1"],
      delete: async (name: string) => {
        cleaned.push(name);
      },
    },
    fetch: async () => {
      if (network) return "server-response";
      throw Error("offline");
    },
    URL,
    Request: WorkerRequest,
    Response,
  };
  vm.runInNewContext(await readFile(new URL("../public/sw.js", import.meta.url), "utf8"), context);
  for (const name of ["install", "activate"]) {
    let done: Promise<void> | undefined;
    handlers[name]({
      waitUntil: (p) => {
        done = p;
      },
    });
    await done;
  }
  assert.deepEqual(
    shellRequests.map((r) => [r.url, r.credentials, r.redirect]),
    [[origin + "/offline.html", "omit", "error"]],
  );
  assert.deepEqual(cleaned, ["bangumi-journal-shell-old"]);
  const navigate = (path: string, mode = "navigate", method = "GET") => {
    let res: Promise<unknown> | undefined;
    handlers.fetch({
      request: { url: new URL(path, origin).href, mode, method },
      respondWith: (r) => {
        res = r;
      },
    });
    return res;
  };
  assert.equal(await navigate("/library"), "server-response");
  network = false;
  assert.equal(await navigate("/library"), "offline");
  assert.equal(await navigate("/login"), "offline");
  for (const path of [
    "/api/dashboard",
    "/api/library",
    "/api/backup",
    "/_next/static/x",
    "https://other.test/",
  ])
    assert.equal(navigate(path), undefined);
  assert.equal(navigate("/library?_rsc=xyz", "cors"), undefined);
  assert.equal(navigate("/api/auth/login", "navigate", "POST"), undefined);
  assert.equal(shellRequests.length, 1);
});
test("桌面、iOS 与可遮罩安装图标均为标称像素尺寸的 PNG", async () => {
  for (const [name, size] of [
    ["app-192", 192],
    ["app-512", 512],
    ["maskable-512", 512],
    ["apple-touch-icon", 180],
  ] as const) {
    const png = await readFile(new URL("../public/icons/" + name + ".png", import.meta.url));
    assert.equal(png.subarray(1, 4).toString(), "PNG");
    assert.equal(png.readUInt32BE(16), size);
    assert.equal(png.readUInt32BE(20), size);
  }
});
