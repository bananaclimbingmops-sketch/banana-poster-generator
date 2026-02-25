"""
rembg 抠图微服务
- 监听 5001 端口
- POST /api/remove-bg：接收图片文件，返回透明背景 PNG（base64）
"""
from flask import Flask, request, jsonify
from flask_cors import CORS
from rembg import remove, new_session
import base64
import io
import logging

app = Flask(__name__)
CORS(app)  # 允许 Vite 开发服务器跨域调用

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# 预加载模型，避免首次请求时延迟
logger.info("Loading rembg model (u2net)...")
session = new_session("u2net")
logger.info("Model loaded successfully.")


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
    app.run(host="0.0.0.0", port=5001, debug=False)
