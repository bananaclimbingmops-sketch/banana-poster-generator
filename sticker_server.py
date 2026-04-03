"""
定线员贴纸合成微服务
- 监听 5002 端口
- POST /api/sticker/generate：接收图片+姓名+国籍，返回合成贴纸 PNG（base64）
- 流程：（可选抠图）→ 合成背景 → 居中置入人物 → 添加国旗+姓名标签
- 输出：945×945px PNG（对应 8cm×8cm @ 300dpi）

布局策略（简单可靠）：
  - 将人物图片等比缩放，使其高度 = 圆形直径（填满圆形高度）
  - 水平居中，垂直居中
  - 圆形蒙版裁剪
"""
import os
import io
import base64
import logging
import numpy as np

from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image, ImageDraw, ImageFont
import requests as http_requests
import cairosvg

app = Flask(__name__)
CORS(app)
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ── 路径配置 ────────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ASSETS_DIR = os.path.join(BASE_DIR, "assets")
FONT_PATH = os.path.join(ASSETS_DIR, "fonts", "SourceHanSansSC-Bold.otf")
BG_SVG_PATH = os.path.join(ASSETS_DIR, "定线员贴纸标准背景.svg")
NATIONALITY_DIR = os.path.join(ASSETS_DIR, "nationality_icons")

# ── 输出尺寸：8cm × 8cm @ 300dpi = 945 × 945px ─────────────────────────────
OUTPUT_SIZE = 945
# SVG viewBox 为 226.77，缩放比例
SCALE = OUTPUT_SIZE / 226.77

# ── 标签区域参数（基于 SVG 坐标，乘以 SCALE 转为像素）─────────────────────
LABEL_X = 63.0 * SCALE
LABEL_Y = 141.26 * SCALE
LABEL_W = 980  # 固定像素宽度（原 682.5px，扩展至 980px 以延伸至圆形边缘外）
LABEL_H = 66.91 * SCALE

# 国旗圆形中心：cx=97.77, cy=174.65, r=27.54（SVG坐标）
FLAG_CX = 97.77 * SCALE
FLAG_CY = 174.65 * SCALE
FLAG_R = 27.54 * SCALE

# 姓名文字起点
NAME_X = 132.57 * SCALE
NAME_Y = 182.93 * SCALE
FONT_SIZE = int(21.78 * SCALE)

# 抠图通过调用 rembg_server（端口 5001）实现，避免重复加载大模型占用内存
REMBG_SERVER_URL = "http://127.0.0.1:5001/api/remove-bg"

# ── 预渲染背景 PNG ────────────────────────────────────────────────────────────
def load_background() -> Image.Image:
    png_bytes = cairosvg.svg2png(
        url=BG_SVG_PATH,
        output_width=OUTPUT_SIZE,
        output_height=OUTPUT_SIZE,
    )
    return Image.open(io.BytesIO(png_bytes)).convert("RGBA")

logger.info("Pre-rendering background SVG...")
BG_IMAGE = load_background()
logger.info(f"Background ready: {BG_IMAGE.size}")


# ── 国旗 icon 加载 ────────────────────────────────────────────────────────────
def load_flag_icon(nationality: str) -> Image.Image | None:
    svg_path = os.path.join(NATIONALITY_DIR, f"{nationality}.svg")
    if not os.path.exists(svg_path):
        logger.warning(f"Flag icon not found: {svg_path}")
        return None
    flag_size = int(FLAG_R * 2)
    png_bytes = cairosvg.svg2png(
        url=svg_path,
        output_width=flag_size,
        output_height=flag_size,
    )
    flag_img = Image.open(io.BytesIO(png_bytes)).convert("RGBA")
    # 使用 4x 超采样创建抗锯齿圆形蒙版，避免硬边锯齿黑边
    ss = 4
    big = flag_size * ss
    mask_big = Image.new("L", (big, big), 0)
    ImageDraw.Draw(mask_big).ellipse((0, 0, big, big), fill=255)
    mask = mask_big.resize((flag_size, flag_size), Image.LANCZOS)
    flag_img.putalpha(mask)
    return flag_img


# ── 字体加载 ──────────────────────────────────────────────────────────────────
def get_font(size: int) -> ImageFont.FreeTypeFont:
    try:
        return ImageFont.truetype(FONT_PATH, size)
    except Exception as e:
        logger.warning(f"Font load failed: {e}, using default")
        return ImageFont.load_default()


# ── 主合成函数 ────────────────────────────────────────────────────────────────
def generate_sticker(
    photo_bytes: bytes,
    name: str,
    nationality: str,
    use_rembg: bool = True,
    rembg_mode: str = "free",
    return_layers: bool = False,
) -> tuple:
    """
    合成定线员贴纸
    return_layers=False: 返回 (PNG bytes, face_detected: bool)
    return_layers=True:  返回 (PNG bytes, face_detected: bool, person_bytes, bg_bytes, bg_top_bytes, layout_info)
    """
    # 1. 抠图（调用 rembg_server HTTP 接口，避免重复加载大模型）
    if use_rembg:
        try:
            resp = http_requests.post(
                REMBG_SERVER_URL,
                files={'file': ('photo.png', photo_bytes, 'image/png')},
                data={'mode': rembg_mode},
                timeout=90,
            )
            if resp.status_code == 200:
                data = resp.json()
                import base64 as _b64
                person_bytes = _b64.b64decode(data['result'])
                logger.info(f"rembg via rembg_server completed successfully (mode={rembg_mode})")
            else:
                logger.warning(f"rembg_server returned {resp.status_code}, using original image")
                person_bytes = photo_bytes
        except Exception as e:
            logger.warning(f"rembg_server call failed: {e}, using original image")
            person_bytes = photo_bytes
    else:
        person_bytes = photo_bytes

    person_img = Image.open(io.BytesIO(person_bytes)).convert("RGBA")

    # 2. 简单居中布局：图片等比缩放填满圆形高度，水平+垂直居中
    person_w, person_h = person_img.size

    # 缩放：使图片高度 = OUTPUT_SIZE（填满圆形），宽度等比
    # 如果图片宽度超过 OUTPUT_SIZE，则以宽度为基准缩放
    scale_by_h = OUTPUT_SIZE / person_h if person_h > 0 else 1.0
    scale_by_w = OUTPUT_SIZE / person_w if person_w > 0 else 1.0
    # 取较大的缩放比例，确保图片至少在一个方向上填满圆形
    scale_ratio = max(scale_by_h, scale_by_w)

    person_target_w = int(person_w * scale_ratio)
    person_target_h = int(person_h * scale_ratio)

    # 居中放置
    person_x = (OUTPUT_SIZE - person_target_w) // 2
    person_y = (OUTPUT_SIZE - person_target_h) // 2

    logger.info(
        f"Center layout: orig={person_w}x{person_h}, "
        f"scale={scale_ratio:.3f}, "
        f"target={person_target_w}x{person_target_h}, "
        f"pos=({person_x},{person_y})"
    )

    person_img = person_img.resize(
        (person_target_w, person_target_h), Image.LANCZOS
    )

    # 3. 合成：背景 + 人物（圆形蒙版裁剪）
    result = BG_IMAGE.copy()

    circle_mask = Image.new("L", (OUTPUT_SIZE, OUTPUT_SIZE), 0)
    circle_draw = ImageDraw.Draw(circle_mask)
    circle_draw.ellipse((0, 0, OUTPUT_SIZE, OUTPUT_SIZE), fill=255)

    person_layer = Image.new("RGBA", (OUTPUT_SIZE, OUTPUT_SIZE), (0, 0, 0, 0))
    person_layer.paste(person_img, (person_x, person_y), person_img)

    person_layer.putalpha(
        Image.fromarray(
            np.minimum(
                np.array(person_layer.split()[3]),
                np.array(circle_mask)
            )
        )
    )

    result = Image.alpha_composite(result, person_layer)

    # 4. 绘制黄色胶囊标签背景
    draw = ImageDraw.Draw(result)
    lx = int(LABEL_X)
    ly = int(LABEL_Y)
    lw = int(LABEL_W)
    lh = int(LABEL_H)
    capsule_radius = lh // 2
    draw.rounded_rectangle(
        [lx, ly, lx + lw, ly + lh],
        radius=capsule_radius,
        fill=(255, 218, 42, 255),
    )

    # 5. 绘制国旗圆形
    flag_img = load_flag_icon(nationality)
    if flag_img:
        flag_x = int(FLAG_CX - FLAG_R)
        flag_y = int(FLAG_CY - FLAG_R)
        result.paste(flag_img, (flag_x, flag_y), flag_img)
    else:
        draw.ellipse(
            [int(FLAG_CX - FLAG_R), int(FLAG_CY - FLAG_R),
             int(FLAG_CX + FLAG_R), int(FLAG_CY + FLAG_R)],
            fill=(200, 200, 200, 255)
        )

    # 6. 绘制姓名文字（垂直居中对齐国旗圆心）
    # 计算文字可用宽度：从 NAME_X 到圆形在国旗垂直中心处的右边界，留 4% 安全边距
    import math as _math
    _circle_cx = OUTPUT_SIZE / 2
    _circle_cy = OUTPUT_SIZE / 2
    _circle_r  = OUTPUT_SIZE / 2
    _dy = FLAG_CY - _circle_cy
    _visible_right = _circle_cx + _math.sqrt(max(0, _circle_r**2 - _dy**2))
    available_w = int((_visible_right - NAME_X) * 0.96)
    MIN_FONT_SIZE = int(FONT_SIZE * 0.45)

    def _fit_font(draw_obj, text, max_w, start_size, min_size):
        """从 start_size 开始逐步缩小字号，直到文字宽度 <= max_w"""
        fs = start_size
        f  = get_font(fs)
        w  = draw_obj.textbbox((0, 0), text, font=f)[2] - draw_obj.textbbox((0, 0), text, font=f)[0]
        while w > max_w and fs > min_size:
            fs = max(min_size, fs - 4)
            f  = get_font(fs)
            w  = draw_obj.textbbox((0, 0), text, font=f)[2] - draw_obj.textbbox((0, 0), text, font=f)[0]
        return f, fs

    if ' ' in name:
        # 有空格：在最后一个空格处拆为两行，两行各自适配宽度
        split_idx = name.rfind(' ')
        line1 = name[:split_idx]
        line2 = name[split_idx + 1:]
        # 两行分别选最小字号（以较长的一行为准）
        f1, fs1 = _fit_font(draw, line1, available_w, FONT_SIZE, MIN_FONT_SIZE)
        f2, fs2 = _fit_font(draw, line2, available_w, FONT_SIZE, MIN_FONT_SIZE)
        font = get_font(min(fs1, fs2))  # 两行统一字号
        tb1 = draw.textbbox((0, 0), line1, font=font)
        tb2 = draw.textbbox((0, 0), line2, font=font)
        line_h = tb1[3] - tb1[1]
        line_spacing = int(line_h * 1.1)
        total_h = line_h + line_spacing
        text_y = int(FLAG_CY - total_h / 2 - tb1[1])
        draw.text((NAME_X, text_y), line1, font=font, fill=(0, 0, 0, 255))
        draw.text((NAME_X, text_y + line_spacing), line2, font=font, fill=(0, 0, 0, 255))
    else:
        # 无空格：单行自动缩字
        font, _ = _fit_font(draw, name, available_w, FONT_SIZE, MIN_FONT_SIZE)
        tbbox = draw.textbbox((0, 0), name, font=font)
        text_h = tbbox[3] - tbbox[1]
        text_y = int(FLAG_CY - text_h / 2 - tbbox[1])
        draw.text((NAME_X, text_y), name, font=font, fill=(0, 0, 0, 255))

    # 7. 最终圆形蒙版裁剪，确保输出为正圆形
    final_mask = Image.new("L", (OUTPUT_SIZE, OUTPUT_SIZE), 0)
    final_draw = ImageDraw.Draw(final_mask)
    final_draw.ellipse((0, 0, OUTPUT_SIZE - 1, OUTPUT_SIZE - 1), fill=255)
    r, g, b, a = result.split()
    a = Image.fromarray(np.minimum(np.array(a), np.array(final_mask)))
    result = Image.merge("RGBA", (r, g, b, a))

    # 8. 输出 PNG
    output = io.BytesIO()
    result.save(output, format="PNG", dpi=(300, 300))
    if not return_layers:
        return output.getvalue(), False

    # 9. 额外返回分层数据（用于前端拖拽微调）
    # bg_bottom：纯黄色圆形背景 + 香蕉 logo（人物下方）
    bg_bottom = BG_IMAGE.copy()
    fm_b = Image.new("L", (OUTPUT_SIZE, OUTPUT_SIZE), 0)
    ImageDraw.Draw(fm_b).ellipse((0, 0, OUTPUT_SIZE-1, OUTPUT_SIZE-1), fill=255)
    rb, gb, bb, ab = bg_bottom.split()
    ab = Image.fromarray(np.minimum(np.array(ab), np.array(fm_b)))
    bg_bottom = Image.merge("RGBA", (rb, gb, bb, ab))
    bg_bottom_out = io.BytesIO()
    bg_bottom.save(bg_bottom_out, format="PNG")

    # bg_top：胶囊标签 + 国旗 + 姓名（人物上方，透明背景）
    bg_top = Image.new("RGBA", (OUTPUT_SIZE, OUTPUT_SIZE), (0, 0, 0, 0))
    bg_top_draw = ImageDraw.Draw(bg_top)
    lx2 = int(LABEL_X); ly2 = int(LABEL_Y)
    lw2 = int(LABEL_W); lh2 = int(LABEL_H)
    bg_top_draw.rounded_rectangle([lx2, ly2, lx2+lw2, ly2+lh2], radius=lh2//2, fill=(255, 218, 42, 255))
    flag_img2 = load_flag_icon(nationality)
    if flag_img2:
        bg_top.paste(flag_img2, (int(FLAG_CX-FLAG_R), int(FLAG_CY-FLAG_R)), flag_img2)
    else:
        bg_top_draw.ellipse([int(FLAG_CX-FLAG_R), int(FLAG_CY-FLAG_R), int(FLAG_CX+FLAG_R), int(FLAG_CY+FLAG_R)], fill=(200, 200, 200, 255))
    # bg_top 文字：与主渲染逻辑保持一致（有空格换行，无空格缩字）
    import math as _math2
    _vis_r2 = OUTPUT_SIZE/2 + _math2.sqrt(max(0, (OUTPUT_SIZE/2)**2 - (FLAG_CY - OUTPUT_SIZE/2)**2))
    avail_w2 = int((_vis_r2 - NAME_X) * 0.96)
    MIN_FS2 = int(FONT_SIZE * 0.45)

    def _fit_font2(text, max_w):
        fs = FONT_SIZE
        f  = get_font(fs)
        w  = bg_top_draw.textbbox((0, 0), text, font=f)[2] - bg_top_draw.textbbox((0, 0), text, font=f)[0]
        while w > max_w and fs > MIN_FS2:
            fs = max(MIN_FS2, fs - 4)
            f  = get_font(fs)
            w  = bg_top_draw.textbbox((0, 0), text, font=f)[2] - bg_top_draw.textbbox((0, 0), text, font=f)[0]
        return f, fs

    if ' ' in name:
        si2 = name.rfind(' ')
        l1_2, l2_2 = name[:si2], name[si2+1:]
        _, fs1_2 = _fit_font2(l1_2, avail_w2)
        _, fs2_2 = _fit_font2(l2_2, avail_w2)
        font2 = get_font(min(fs1_2, fs2_2))
        tb1_2 = bg_top_draw.textbbox((0, 0), l1_2, font=font2)
        lh2 = tb1_2[3] - tb1_2[1]
        ls2 = int(lh2 * 1.1)
        ty2 = int(FLAG_CY - (lh2 + ls2) / 2 - tb1_2[1])
        bg_top_draw.text((NAME_X, ty2), l1_2, font=font2, fill=(0, 0, 0, 255))
        bg_top_draw.text((NAME_X, ty2 + ls2), l2_2, font=font2, fill=(0, 0, 0, 255))
    else:
        font2, _ = _fit_font2(name, avail_w2)
        tb2 = bg_top_draw.textbbox((0, 0), name, font=font2)
        th2 = tb2[3] - tb2[1]
        ty2 = int(FLAG_CY - th2/2 - tb2[1])
        bg_top_draw.text((NAME_X, ty2), name, font=font2, fill=(0, 0, 0, 255))
    fm2 = Image.new("L", (OUTPUT_SIZE, OUTPUT_SIZE), 0)
    ImageDraw.Draw(fm2).ellipse((0, 0, OUTPUT_SIZE-1, OUTPUT_SIZE-1), fill=255)
    r2, g2, b2, a2 = bg_top.split()
    a2 = Image.fromarray(np.minimum(np.array(a2), np.array(fm2)))
    bg_top = Image.merge("RGBA", (r2, g2, b2, a2))
    bg_top_out = io.BytesIO()
    bg_top.save(bg_top_out, format="PNG")

    # 人物图层：已缩放的 person_img（透明背景）
    person_out = io.BytesIO()
    person_img.save(person_out, format="PNG")
    layout_info = {
        "person_x": person_x,
        "person_y": person_y,
        "person_w": person_target_w,
        "person_h": person_target_h,
        "scale_ratio": scale_ratio,
        "canvas_size": OUTPUT_SIZE,
    }
    return output.getvalue(), False, person_out.getvalue(), bg_bottom_out.getvalue(), bg_top_out.getvalue(), layout_info


@app.route("/api/sticker/generate", methods=["POST"])
def generate():
    file = request.files.get("photo")
    if file is None:
        return jsonify({"error": "No photo provided"}), 400

    name = request.form.get("name", "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400

    nationality = request.form.get("nationality", "").strip()
    use_rembg = request.form.get("rembg", "true").lower() == "true"
    rembg_mode = request.form.get("rembg_mode", "free").strip().lower()
    if rembg_mode not in ("free", "premium"):
        rembg_mode = "free"
    try:
        photo_bytes = file.read()
        logger.info(f"Generating sticker for: {name} ({nationality}), rembg={use_rembg}, mode={rembg_mode}")
        sticker_bytes, _ = generate_sticker(photo_bytes, name, nationality, use_rembg, rembg_mode)

        b64 = base64.b64encode(sticker_bytes).decode("utf-8")
        logger.info(f"Sticker generated: {len(sticker_bytes)} bytes")
        return jsonify({
            "success": True,
            "result": b64,
            "face_detected": False,
        })

    except Exception as e:
        logger.error(f"Sticker generation failed: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route("/api/sticker/generate-layers", methods=["POST"])
def generate_layers():
    """返回分层数据：合成图 + 人物图层 + 背景图层 + 构图参数，供前端拖拽微调"""
    file = request.files.get("photo")
    if file is None:
        return jsonify({"error": "No photo provided"}), 400
    name = request.form.get("name", "").strip()
    if not name:
        return jsonify({"error": "Name is required"}), 400
    nationality = request.form.get("nationality", "").strip()
    use_rembg = request.form.get("rembg", "true").lower() == "true"
    rembg_mode = request.form.get("rembg_mode", "free").strip().lower()
    if rembg_mode not in ("free", "premium"):
        rembg_mode = "free"
    try:
        photo_bytes = file.read()
        logger.info(f"Generating sticker layers for: {name} ({nationality}), rembg={use_rembg}, mode={rembg_mode}")
        sticker_bytes, _, person_bytes, bg_bytes, bg_top_bytes, layout_info = generate_sticker(
            photo_bytes, name, nationality, use_rembg, rembg_mode, return_layers=True
        )
        return jsonify({
            "success": True,
            "result": base64.b64encode(sticker_bytes).decode("utf-8"),
            "person_layer": base64.b64encode(person_bytes).decode("utf-8"),
            "bg_bottom_layer": base64.b64encode(bg_bytes).decode("utf-8"),
            "bg_top_layer": base64.b64encode(bg_top_bytes).decode("utf-8"),
            "layout": layout_info,
            "face_detected": False,
        })
    except Exception as e:
        logger.error(f"Sticker layers generation failed: {e}", exc_info=True)
        return jsonify({"error": str(e)}), 500


@app.route("/api/sticker/nationalities", methods=["GET"])
def list_nationalities():
    icons = []
    if os.path.exists(NATIONALITY_DIR):
        for f in sorted(os.listdir(NATIONALITY_DIR)):
            if f.endswith(".svg") and not f.startswith("._"):
                icons.append(f.replace(".svg", ""))
    return jsonify({"nationalities": icons})


@app.route("/api/sticker/health", methods=["GET"])
def health():
    return jsonify({
        "status": "ok",
        "service": "sticker",
        "layout": "center",
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5002, debug=False, threaded=True)
