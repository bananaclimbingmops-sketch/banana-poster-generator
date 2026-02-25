# ── 阶段 1：构建前端 ──────────────────────────────────────────────────────────
FROM node:22-slim AS builder

WORKDIR /app

# 安装 pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# 复制依赖文件
COPY package.json pnpm-lock.yaml ./
COPY patches/ ./patches/

# 安装依赖（跳过 postinstall 脚本）
RUN pnpm install --frozen-lockfile

# 复制源码
COPY client/ ./client/
COPY server/ ./server/
COPY shared/ ./shared/
COPY public/ ./public/
COPY tsconfig.json tsconfig.node.json vite.config.ts components.json ./

# 构建前端和服务器
RUN pnpm build

# ── 阶段 2：生产运行时（Node.js + Python）────────────────────────────────────
FROM python:3.11-slim

WORKDIR /app

# 安装 Node.js 22
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    libgomp1 \
    && curl -fsSL https://deb.nodesource.com/setup_22.x | bash - \
    && apt-get install -y nodejs \
    && apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# 安装 Python 依赖
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

# 从构建阶段复制产物
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./

# 复制 rembg Python 服务
COPY rembg_server.py ./

# 预下载 rembg u2net 模型（构建时缓存，避免首次请求延迟）
RUN python3 -c "from rembg import new_session; new_session('u2net')" 2>/dev/null || true

# Railway 通过 PORT 环境变量注入端口
ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["node", "dist/index.js"]
