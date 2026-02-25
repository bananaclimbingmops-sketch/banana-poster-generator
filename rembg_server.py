"""
rembg 抠图微服务
- 监听 5001 端口
- POST /api/remove-bg：接收图片文件，返回透明背景 PNG（base64）
- 自动将图片缩放到最大 1024px，避免大图超时
"""
from flask import Flask, request, jsonify
from flask_cors import CORS
from rembg import remove, new_session
from PIL import Image
import base64
import io
import logging

app = Flask(__name__)
CORS(app)  # 允许 Vite 开发服务器跨域调用

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 预加载模型，避免首次请求时延迟
logger.info("Loading rembg model (u2net)...")
# 使用 u2netp 轻量模型（速度是 u2net 的7倍，精度略低）
session = new_session("u2netp")
logger.info("Model loaded successfully.")

# 最大输入尺寸（像素），超过则缩放，避免处理超时
# Railway 有 30s 请求超时，u2netp 模型 + 512px 可在 10s 内完成
MAX_SIZE = 512


def resize_if_needed(image_bytes: bytes) -> bytes:
    """如果图片尺寸超过 MAX_SIZE，等比缩放后返回 JPEG bytes"""
    img = Image.open(io.BytesIO(image_bytes))
    w, h = img.size
    if max(w, h) <= MAX_SIZE:
        return image_bytes
    # 等比缩放
    ratio = MAX_SIZE / max(w, h)
    new_w, new_h = int(w * ratio), int(h * ratio)
    img = img.resize((new_w, new_h), Image.LANCZOS)
    buf = io.BytesIO()
    # 保持原格式，若无法判断则用 PNG
    fmt = img.format or "PNG"
    if fmt not in ("PNG", "JPEG", "WEBP"):
        fmt = "PNG"
    img.save(buf, format=fmt)
    logger.info(f"Resized image from {w}x{h} to {new_w}x{new_h}")
    return buf.getvalue()


@app.route("/api/remove-bg", methods=["POST"])
def remove_bg():
    # 同时兼容 'file' 和 'image' 字段名
    file = request.files.get("file") or request.files.get("image")
    if file is None:
        return jsonify({"error": "No file provided"}), 400

    if not file.content_type or not file.content_type.startswith("image/"):
        return jsonify({"error": "Invalid file type, must be an image"}), 400

    try:
        input_bytes = file.read()
        logger.info(f"Processing image: {file.filename}, size: {len(input_bytes)} bytes")

        # 自动缩放大图，避免超时
        input_bytes = resize_if_needed(input_bytes)

        # 执行抠图
        output_bytes = remove(input_bytes, session=session)

        # 转为 base64 返回（兼容前端期望的 result 字段和旧的 imageUrl 字段）
        b64 = base64.b64encode(output_bytes).decode("utf-8")
        data_url = f"data:image/png;base64,{b64}"

        logger.info(f"Done. Output size: {len(output_bytes)} bytes")
        return jsonify({"success": True, "result": b64, "imageUrl": data_url})

    except Exception as e:
        logger.error(f"Error processing image: {e}")
        return jsonify({"error": str(e)}), 500


@app.route("/api/health", methods=["GET"])
def health():
    return jsonify({"status": "ok", "model": "u2net"})


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001, debug=False, threaded=True)
