/**
 * 生产服务器
 *
 * 功能：
 * 1. 静态文件服务（Vite 构建产物）
 * 2. /api/remove-bg 和 /api/health 反向代理到 rembg Python 服务（端口 5001）
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
import { createProxyMiddleware } from "http-proxy-middleware";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const server = createServer(app);

  const isProduction = process.env.NODE_ENV === "production";

  // ── 启动 rembg Python 微服务 ─────────────────────────────────────────────────
  const rembgScriptPath = path.resolve(__dirname, "..", "rembg_server.py");

  // 启动 rembg 服务，并在崩溃后自动重启
  let rembgProcess = spawn("python3.11", [rembgScriptPath], {
    detached: false,
    stdio: ["ignore", "pipe", "pipe"],
  });

  function attachRembgListeners(proc: ReturnType<typeof spawn>) {
    proc.stdout?.on("data", (d: Buffer) =>
      console.log("[rembg]", d.toString().trim()),
    );
    proc.stderr?.on("data", (d: Buffer) =>
      console.error("[rembg]", d.toString().trim()),
    );
    proc.on("exit", (code: number | null) => {
      console.warn(`[rembg] process exited with code ${code}, restarting in 3s...`);
      setTimeout(() => {
        console.log("[rembg] Restarting rembg service...");
        rembgProcess = spawn("python3.11", [rembgScriptPath], {
          detached: false,
          stdio: ["ignore", "pipe", "pipe"],
        });
        attachRembgListeners(rembgProcess);
      }, 3000);
    });
  }

  attachRembgListeners(rembgProcess);
  console.log("[server] rembg Python service starting on port 5001...");

  // ── 启动贴纸合成 Python 微服务 ───────────────────────────────────────────────
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
        // 允许跨域资源加载（html-to-image 需要加载字体和图片资源）
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
  app.use(
    "/api/sticker",
    createProxyMiddleware({
      target: "http://127.0.0.1:5002",
      changeOrigin: true,
      pathRewrite: { "^/": "/api/sticker/" },
    }),
  );

  // ── /api 反向代理到 rembg Python 服务（端口 5001）──────────────────────────
  // 注意：Express 的 app.use('/api', middleware) 会自动去掉 /api 前缀
  // 但 Flask 路由已包含 /api 前缀，所以使用 pathRewrite 恢复前缀
  app.use(
    "/api",
    createProxyMiddleware({
      target: "http://127.0.0.1:5001",
      changeOrigin: true,
      pathRewrite: { "^/": "/api/" },
    }),
  );

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

  // ── 客户端路由回退 ──────────────────────────────────────────────────────────
  app.get("*", (_req, res) => {
    res.sendFile(path.join(staticPath, "index.html"));
  });

  const port = Number(process.env.PORT) || 3000;

  server.listen(port, () => {
    console.log(
      `[server] Running on http://localhost:${port}/ (${process.env.NODE_ENV ?? "development"})`,
    );
  });

  // ── 优雅关闭 ────────────────────────────────────────────────────────────────
  process.on("SIGTERM", () => {
    console.log("[server] SIGTERM received, shutting down...");
    try { rembgProcess.kill(); } catch { /* ignore */ }
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
