"""
rembg 抠图微服务
- 监听 5001 端口
- POST /api/remove-bg：接收图片文件，返回透明背景 PNG（base64）
- 支持两种抠图模式（通过 mode 参数选择）：
    mode=free（默认）：使用本地 u2netp 轻量模型，免费，速度快，精度一般
    mode=premium：调用 remove.bg API，付费（每月 50 次免费），精度极高
- 自动将图片缩放到最大 MAX_SIZE px，避免大图超时
"""
import os
import io
import base64
import logging
import requests as http_requests

from flask import Flask, request, jsonify
from flask_cors import CORS
from rembg import remove, new_session
from PIL import Image

app = Flask(__name__)
CORS(app)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── remove.bg API Key（从环境变量读取）──────────────────────────────────────
REMOVE_BG_API_KEY = os.environ.get("REMOVE_BG_API_KEY", "")
REMOVE_BG_API_URL = "https://api.remove.bg/v1.0/removebg"

# ── 预加载本地 u2netp 模型（免费模式）──────────────────────────────────────
logger.info("Loading rembg model (u2netp)...")
session = new_session("u2netp")
logger.info("Model loaded successfully.")

# 最大输入尺寸（像素），超过则缩放
# 免费模式：512px（u2netp 在 Railway 免费计划上可稳定运行）
# 付费模式：1200px（remove.bg 云端处理，支持更高分辨率）
MAX_SIZE_FREE = 512
MAX_SIZE_PREMIUM = 1200


def resize_if_needed(image_bytes: bytes, max_size: int) -> bytes:
    """如果图片尺寸超过 max_size，等比缩放后返回 PNG bytes"""
    img = Image.open(io.BytesIO(image_bytes))
    w, h = img.size
    if max(w, h) <= max_size:
        # 确保格式为 PNG（rembg 和 remove.bg 都支持）
        if img.format == "PNG":
            return image_bytes
        buf = io.BytesIO()
        img.convert("RGBA").save(buf, format="PNG")
        return buf.getvalue()
    ratio = max_size / max(w, h)
    new_w, new_h = int(w * ratio), int(h * ratio)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    buf = io.BytesIO()
    img.convert("RGBA").save(buf, format="PNG")
    logger.info(f"Resized image from {w}x{h} to {new_w}x{new_h}")
    return buf.getvalue()


def remove_bg_free(image_bytes: bytes) -> bytes:
    """使用本地 u2netp 模型抠图（免费）"""
    input_bytes = resize_if_needed(image_bytes, MAX_SIZE_FREE)
    output_bytes = remove(input_bytes, session=session)
    logger.info(f"[free] u2netp done. Output: {len(output_bytes)} bytes")
    return output_bytes


def remove_bg_premium(image_bytes: bytes) -> bytes:
    """调用 remove.bg API 抠图（付费，精度更高）"""
    if not REMOVE_BG_API_KEY:
        raise ValueError("REMOVE_BG_API_KEY 未配置，无法使用付费抠图")

    input_bytes = resize_if_needed(image_bytes, MAX_SIZE_PREMIUM)

    resp = http_requests.post(
        REMOVE_BG_API_URL,
        files={"image_file": ("photo.png", input_bytes, "image/png")},
        data={"size": "auto"},
        headers={"X-Api-Key": REMOVE_BG_API_KEY},
        timeout=60,
    )

    if resp.status_code == 200:
        logger.info(f"[premium] remove.bg done. Output: {len(resp.content)} bytes")
        return resp.content
    else:
        error_msg = resp.text[:200] if resp.text else f"HTTP {resp.status_code}"
        logger.error(f"[premium] remove.bg API error: {resp.status_code} {error_msg}")
        raise RuntimeError(f"remove.bg API 返回错误: {resp.status_code} {error_msg}")


@app.route("/api/remove-bg", methods=["POST"])
def remove_bg():
    # 同时兼容 'file' 和 'image' 字段名
    file = request.files.get("file") or request.files.get("image")
    if file is None:
        return jsonify({"error": "No file provided"}), 400

    if not file.content_type or not file.content_type.startswith("image/"):
        return jsonify({"error": "Invalid file type, must be an image"}), 400

    # mode 参数：free（默认）或 premium
    mode = request.form.get("mode", "free").strip().lower()
    if mode not in ("free", "premium"):
        mode = "free"

    try:
        input_bytes = file.read()
        logger.info(f"Processing image: {file.filename}, size: {len(input_bytes)} bytes, mode={mode}")

        if mode == "premium":
            output_bytes = remove_bg_premium(input_bytes)
        else:
            output_bytes = remove_bg_free(input_bytes)

        b64 = base64.b64encode(output_bytes).decode("utf-8")
        data_url = f"data:image/png;base64,{b64}"

        return jsonify({"success": True, "result": b64, "imageUrl": data_url, "mode": mode})

    except Exception as e:
        logger.error(f"Error processing image (mode={mode}): {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "model": "u2netp",
        "premium_available": bool(REMOVE_BG_API_KEY),
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=False, threaded=True)
