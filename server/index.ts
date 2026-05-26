/**
 * 生产服务器
 *
 * 功能：
 * 1. 静态文件服务（Vite 构建产物）
 * 2. /api/remove-bg 和 /api/health 反向代理到 rembg Python 服务（端口 5001）
 *    - rembg 按需启动：第一次收到请求时才启动，空闲 10 分钟后自动退出
 * 3. /api/sticker/* 反向代理到贴纸合成 Python 服务（端口 5002）
 * 4. helmet 安全响应头
 * 5. compression Gzip 压缩
 * 6. morgan 访问日志
 * 7. SIGTERM 优雅关闭
 */
import express from "express";
import { createServer } from "http";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import http from "http";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  const isProduction = process.env.NODE_ENV === "production";

  // ── rembg 按需启动管理 ────────────────────────────────────────────────────
  const rembgScriptPath = path.resolve(__dirname, "..", "rembg_server.py");
  let rembgProcess: ReturnType<typeof spawn> | null = null;
  let rembgReady = false;
  let rembgStarting = false;
  let rembgReadyCallbacks: Array<(err?: Error) => void> = [];

  function startRembg(): void {
    if (rembgStarting || rembgReady) return;
    rembgStarting = true;
    rembgReady = false;
    console.log("[rembg] Starting rembg service on demand...");

    rembgProcess = spawn("python3.11", [rembgScriptPath], {
      detached: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    rembgProcess.stdout?.on("data", (d: Buffer) => {
      const msg = d.toString().trim();
      console.log("[rembg]", msg);
      // 检测 Flask 启动完成
      if (!rembgReady && (msg.includes("Running on") || msg.includes("Serving Flask"))) {
        rembgReady = true;
        rembgStarting = false;
        console.log("[rembg] Service is ready.");
        const cbs = rembgReadyCallbacks.splice(0);
        cbs.forEach(cb => cb());
      }
    });

    rembgProcess.stderr?.on("data", (d: Buffer) => {
      const msg = d.toString().trim();
      console.error("[rembg]", msg);
      // stderr 也可能包含 Flask 启动信息
      if (!rembgReady && (msg.includes("Running on") || msg.includes("Serving Flask"))) {
        rembgReady = true;
        rembgStarting = false;
        console.log("[rembg] Service is ready (via stderr).");
        const cbs = rembgReadyCallbacks.splice(0);
        cbs.forEach(cb => cb());
      }
    });

    rembgProcess.on("exit", (code: number | null) => {
      console.log(`[rembg] Process exited with code ${code}. Will restart on next request.`);
      rembgProcess = null;
      rembgReady = false;
      rembgStarting = false;
      // 通知所有等待中的回调（如果有）
      const cbs = rembgReadyCallbacks.splice(0);
      cbs.forEach(cb => cb(new Error(`rembg exited with code ${code}`)));
    });

    // 超时保护：60 秒内未就绪则认为启动失败
    setTimeout(() => {
      if (rembgStarting && !rembgReady) {
        console.warn("[rembg] Startup timeout (60s), marking as ready anyway to allow requests through.");
        rembgReady = true;
        rembgStarting = false;
        const cbs = rembgReadyCallbacks.splice(0);
        cbs.forEach(cb => cb());
      }
    }, 60000);
  }

  function ensureRembgReady(callback: (err?: Error) => void): void {
    if (rembgReady) {
      callback();
      return;
    }
    rembgReadyCallbacks.push(callback);
    if (!rembgStarting) {
      startRembg();
    }
  }

  // ── rembg 请求中间件：按需启动后再代理 ──────────────────────────────────
  function proxyToRembg(req: express.Request, res: express.Response): void {
    ensureRembgReady((err) => {
      if (err) {
        res.status(503).json({ error: "rembg service unavailable", detail: err.message });
        return;
      }

      // 手动代理请求到 rembg
      const options: http.RequestOptions = {
        hostname: "127.0.0.1",
        port: 5001,
        path: req.originalUrl,
        method: req.method,
        headers: req.headers,
      };

      const proxyReq = http.request(options, (proxyRes) => {
        res.writeHead(proxyRes.statusCode || 200, proxyRes.headers);
        proxyRes.pipe(res, { end: true });
      });

      proxyReq.on("error", (e) => {
        console.error("[rembg] Proxy error:", e.message);
        res.status(502).json({ error: "rembg proxy error", detail: e.message });
      });

      proxyReq.setTimeout(120000, () => {
        proxyReq.destroy();
        res.status(504).json({ error: "rembg request timeout" });
      });

      req.pipe(proxyReq, { end: true });
    });
  }

  // ── 启动贴纸合成 Python 微服务（常驻，内存占用小）────────────────────────
  const stickerScriptPath = path.resolve(__dirname, "..", "sticker_server.py");
  let stickerProcess = spawn("python3.11", [stickerScriptPath], {
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  function attachStickerListeners(proc: ReturnType<typeof spawn>) {
    proc.stdout?.on("data", (d: Buffer) =>
      console.log("[sticker]", d.toString().trim()),
    );
    proc.stderr?.on("data", (d: Buffer) =>
      console.error("[sticker]", d.toString().trim()),
    );
    proc.on("exit", (code: number | null) => {
      console.warn(`[sticker] process exited with code ${code}, restarting in 3s...`);
      setTimeout(() => {
        console.log("[sticker] Restarting sticker service...");
        stickerProcess = spawn("python3.11", [stickerScriptPath], {
          detached: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
        attachStickerListeners(stickerProcess);
      }, 3000);
    });
  }

  attachStickerListeners(stickerProcess);
  console.log("[server] sticker Python service starting on port 5002...");

  // ── 安全中间件：helmet ──────────────────────────────────────────────────────
  if (isProduction) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { default: helmet } = await import("helmet" as any);
      app.use(helmet({
        contentSecurityPolicy: false,
        crossOriginResourcePolicy: { policy: 'cross-origin' },
        crossOriginEmbedderPolicy: false,
      }));
      console.log("[server] helmet security headers enabled");
    } catch {
      console.warn("[server] helmet not installed, skipping");
    }

    // ── 压缩中间件：compression ───────────────────────────────────────────────
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { default: compression } = await import("compression" as any);
      app.use(compression());
      console.log("[server] gzip compression enabled");
    } catch {
      console.warn("[server] compression not installed, skipping");
    }
  }

  // ── 访问日志：morgan ────────────────────────────────────────────────────────
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { default: morgan } = await import("morgan" as any);
    app.use(morgan(isProduction ? "combined" : "dev"));
  } catch {
    console.warn("[server] morgan not installed, skipping");
  }

  // ── /api/sticker/* 反向代理到贴纸合成服务（端口 5002）─────────────────────
  const { createProxyMiddleware } = await import("http-proxy-middleware");
  app.use(
    "/api/sticker",
    createProxyMiddleware({
      target: "http://127.0.0.1:5002",
      changeOrigin: true,
      pathRewrite: { "^/": "/api/sticker/" },
      proxyTimeout: 120000,
      timeout: 120000,
    }),
  );

  // ── /api/remove-bg 和 /api/health 按需启动 rembg ──────────────────────────
  app.use("/api/remove-bg", (req, res) => proxyToRembg(req, res));
  app.use("/api/health", (req, res) => proxyToRembg(req, res));

  // ── 静态文件服务 ────────────────────────────────────────────────────────────
  const staticPath = path.resolve(__dirname, "..", "dist", "public");

  app.use(
    express.static(staticPath, {
      maxAge: isProduction ? "1d" : 0,
      setHeaders(res, filePath) {
        if (filePath.endsWith(".html")) {
          res.setHeader("Cache-Control", "no-cache");
        }
      },
    }),
  );

  // ── 域名验证文件 ────────────────────────────────────────────────────────────
  app.get("/aae062b3f7d8de5c12e1686f2688ce9b.txt", (_req, res) => {
    res.setHeader("Content-Type", "text/plain");
    res.send("fa0ebf200013048823d8f474d1ab1e5c563f3b8a");
  });

  // ── 客户端路由回退 ──────────────────────────────────────────────────────────
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = Number(process.env.PORT) || 3000;

  server.timeout = 150000;
  server.keepAliveTimeout = 150000;

  server.listen(port, () => {
    console.log(
      `[server] Running on http://localhost:${port}/ (${process.env.NODE_ENV ?? "development"})`,
    );
  });

  // ── 优雅关闭 ────────────────────────────────────────────────────────────────
  process.on("SIGTERM", () => {
    console.log("[server] SIGTERM received, shutting down...");
    try { if (rembgProcess) rembgProcess.kill(); } catch { /* ignore */ }
    try { stickerProcess.kill(); } catch { /* ignore */ }
    server.close(() => {
      console.log("[server] HTTP server closed");
      process.exit(0);
    });
  });
}

startServer().catch((err) => {
  console.error("[server] Failed to start:", err);
  process.exit(1);
});
