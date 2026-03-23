"""
定线员贴纸合成微服务
- 监听 5002 端口
- POST /api/sticker/generate：接收图片+姓名+国籍，返回合成贴纸 PNG（base64）
- 流程：人脸检测 → 抠图 → 合成背景 → 智能构图置入人物 → 添加国旗+姓名标签
- 输出：945×945px PNG（对应 8cm×8cm @ 300dpi）

人脸检测策略（多级 fallback）：
  1. YuNet (OpenCV DNN) — 最准确，支持各种角度
  2. Haar Cascade 正面 + 侧面组合 — 兜底
  3. 若均未检测到 → 使用底部对齐兜底构图
"""
import os
import io
import base64
import logging
import numpy as np

from flask import Flask, request, jsonify
from flask_cors import CORS
from PIL import Image, ImageDraw, ImageFont
# rembg 已移到前端 WASM 处理，后端不再加载模型（节省 ~300MB 内存）
# from rembg import remove, new_session
import cairosvg
import cv2

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
YUNET_MODEL_PATH = os.path.join(ASSETS_DIR, "face_detection_yunet_2023mar.onnx")

# ── 输出尺寸：8cm × 8cm @ 300dpi = 945 × 945px ─────────────────────────────
OUTPUT_SIZE = 945
# SVG viewBox 为 226.77，缩放比例
SCALE = OUTPUT_SIZE / 226.77

# ── 标签区域参数（基于 SVG 坐标，乘以 SCALE 转为像素）─────────────────────
LABEL_X = 63.0 * SCALE
LABEL_Y = 141.26 * SCALE
LABEL_W = (226.77 - 63.0) * SCALE
LABEL_H = 66.91 * SCALE

# 国旗圆形中心：cx=97.77, cy=174.65, r=27.54（SVG坐标）
FLAG_CX = 97.77 * SCALE
FLAG_CY = 174.65 * SCALE
FLAG_R = 27.54 * SCALE

# 姓名文字起点
NAME_X = 132.57 * SCALE
NAME_Y = 182.93 * SCALE
FONT_SIZE = int(21.78 * SCALE)

# rembg 已移到前端 WASM 处理，后端不加载模型（节省 ~300MB 内存）
rembg_session = None
# ── 预加载人脸检测器 ──────────────────────────────────────────────────────────
# 1. YuNet DNN 检测器（最准确）
_yunet_detector = None
if os.path.exists(YUNET_MODEL_PATH):
    try:
        _yunet_detector = cv2.FaceDetectorYN.create(
            YUNET_MODEL_PATH,
            "",
            (320, 320),
            score_threshold=0.5,
            nms_threshold=0.3,
            top_k=5000,
        )
        logger.info("YuNet face detector loaded.")
    except Exception as e:
        logger.warning(f"YuNet load failed: {e}")
else:
    logger.warning(f"YuNet model not found: {YUNET_MODEL_PATH}")

# 2. Haar Cascade 正面检测器（兜底）
_haar_frontal = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_default.xml"
)
_haar_frontal_alt2 = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_frontalface_alt2.xml"
)
# 3. Haar Cascade 侧面检测器（兜底）
_haar_profile = cv2.CascadeClassifier(
    cv2.data.haarcascades + "haarcascade_profileface.xml"
)
logger.info("Haar cascade classifiers loaded.")

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


# ── 人脸检测（多级策略）──────────────────────────────────────────────────────
def detect_face_center(pil_img: Image.Image):
    """
    在 PIL 图像中检测人脸，返回最大人脸的 (cx, cy, fw, fh)。
    检测不到时返回 None。
    检测策略（按优先级）：
    1. YuNet DNN — 对各种角度、光线条件最准确
    2. Haar Cascade 正面（default + alt2）
    3. Haar Cascade 侧面（profile + 水平翻转）
    """
    img_rgb = np.array(pil_img.convert("RGB"))
    h, w = img_rgb.shape[:2]

    # ── 策略 1：YuNet DNN ────────────────────────────────────────────────────
    if _yunet_detector is not None:
        try:
            _yunet_detector.setInputSize((w, h))
            _, faces = _yunet_detector.detect(img_rgb)
            if faces is not None and len(faces) > 0:
                # faces 格式：[x, y, w, h, ...landmarks..., score]
                # 取置信度最高的人脸
                best = max(faces, key=lambda f: f[-1])
                fx, fy, fw, fh = int(best[0]), int(best[1]), int(best[2]), int(best[3])
                cx = fx + fw // 2
                cy = fy + fh // 2
                logger.info(f"YuNet detected face: ({cx}, {cy}), size={fw}x{fh}, score={best[-1]:.3f}")
                return (cx, cy, fw, fh)
        except Exception as e:
            logger.warning(f"YuNet detection error: {e}")

    # ── 策略 2：Haar Cascade 正面 ────────────────────────────────────────────
    gray = cv2.cvtColor(img_rgb, cv2.COLOR_RGB2GRAY)
    # 增强对比度，提高检测率
    gray_eq = cv2.equalizeHist(gray)

    for cascade, name in [(_haar_frontal, "frontal_default"), (_haar_frontal_alt2, "frontal_alt2")]:
        for scale_factor in [1.05, 1.1, 1.15]:
            faces = cascade.detectMultiScale(
                gray_eq,
                scaleFactor=scale_factor,
                minNeighbors=3,
                minSize=(max(20, w // 20), max(20, h // 20)),
                flags=cv2.CASCADE_SCALE_IMAGE,
            )
            if len(faces) > 0:
                faces_sorted = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)
                x, y, fw, fh = faces_sorted[0]
                cx, cy = x + fw // 2, y + fh // 2
                logger.info(f"Haar {name} (scale={scale_factor}) detected face: ({cx}, {cy}), size={fw}x{fh}")
                return (cx, cy, fw, fh)

    # ── 策略 3：Haar Cascade 侧面（正向 + 镜像）────────────────────────────
    for flip_code, flip_name in [(None, "profile_orig"), (1, "profile_flip")]:
        gray_test = cv2.flip(gray_eq, 1) if flip_code is not None else gray_eq
        for scale_factor in [1.05, 1.1]:
            faces = _haar_profile.detectMultiScale(
                gray_test,
                scaleFactor=scale_factor,
                minNeighbors=3,
                minSize=(max(20, w // 20), max(20, h // 20)),
            )
            if len(faces) > 0:
                faces_sorted = sorted(faces, key=lambda f: f[2] * f[3], reverse=True)
                x, y, fw, fh = faces_sorted[0]
                # 如果是镜像检测，需要翻转回原始坐标
                if flip_code is not None:
                    x = w - x - fw
                cx, cy = x + fw // 2, y + fh // 2
                logger.info(f"Haar {flip_name} (scale={scale_factor}) detected face: ({cx}, {cy}), size={fw}x{fh}")
                return (cx, cy, fw, fh)

    logger.info("No face detected by any method")
    return None


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
    mask = Image.new("L", (flag_size, flag_size), 0)
    draw = ImageDraw.Draw(mask)
    draw.ellipse((0, 0, flag_size, flag_size), fill=255)
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
    return_layers: bool = False,
) -> tuple:
    """
    合成定线员贴纸
    return_layers=False: 返回 (PNG bytes, face_detected: bool)
    return_layers=True:  返回 (PNG bytes, face_detected: bool, person_bytes, bg_bytes, layout_info)
      layout_info = {person_x, person_y, person_w, person_h, scale_ratio, canvas_size}
    """
    # 0. 限制输入图片最大尺寸（避免大图在低性能 CPU 上处理超时）
    INPUT_MAX = 1200  # 最大边长 1200px，足够人脸检测和构图精度
    original_img = Image.open(io.BytesIO(photo_bytes)).convert("RGBA")
    orig_w, orig_h = original_img.size
    if max(orig_w, orig_h) > INPUT_MAX:
        scale_down = INPUT_MAX / max(orig_w, orig_h)
        new_w = int(orig_w * scale_down)
        new_h = int(orig_h * scale_down)
        original_img = original_img.resize((new_w, new_h), Image.LANCZOS)
        orig_w, orig_h = new_w, new_h
        # 同步缩小 photo_bytes 供后续使用
        buf = io.BytesIO()
        original_img.save(buf, format='PNG')
        photo_bytes = buf.getvalue()
        logger.info(f"Input image downscaled to {new_w}x{new_h} for performance")

    # 1. 在原始图片上检测人脸（抠图前效果更好）
    face_result = detect_face_center(original_img)
    face_detected = face_result is not None
    if face_result is not None:
        face_center_orig = (face_result[0], face_result[1])  # (cx, cy)
        face_box_size = (face_result[2], face_result[3])     # (fw, fh)
    else:
        face_center_orig = None
        face_box_size = None
    logger.info(f"Face detection: center={face_center_orig}, box={face_box_size}, orig size: {orig_w}x{orig_h}")

    # 2. 抠图（rembg 已移到前端 WASM 处理，后端不再重复操作）
    person_bytes = photo_bytes

    person_img = Image.open(io.BytesIO(person_bytes)).convert("RGBA")

    # 3. 智能构图：计算缩放比例和人物偏移
    person_w, person_h = person_img.size

    # 画布参数
    CIRCLE_CX = OUTPUT_SIZE // 2   # 472
    CIRCLE_CY = OUTPUT_SIZE // 2   # 472
    CIRCLE_R  = OUTPUT_SIZE // 2   # 472
    # 目标人脸中心在画布中的位置（圆心偏上 15%）
    TARGET_FACE_CX = CIRCLE_CX
    TARGET_FACE_CY = int(OUTPUT_SIZE * 0.35)   # 330
    # 目标人脸高度（占圆形直径约 28%）
    TARGET_FACE_H  = int(OUTPUT_SIZE * 0.28)   # 264

    if face_detected:
        face_cx_orig, face_cy_orig = face_center_orig
        # 使用真实人脸框大小计算缩放比例
        actual_face_h = face_box_size[1] if face_box_size else max(orig_h // 5, 30)
        # 对于横向宽幅图，人脸相对于图片高度占比可能较大，使用真实大小更准确
        real_face_h = max(actual_face_h, 20)

        # 优先使用人脸大小驱动的缩放
        scale_by_face = TARGET_FACE_H / real_face_h
        # 动态 scale_min：人脸越大（特写照），scale_min 越小，避免特写照人脸过大
        face_rel_h = real_face_h / orig_h if orig_h > 0 else 0.15
        if face_rel_h > 0.25:
            # 特写照：人脸大小驱动即可，不需要 scale_min
            scale_min = 0.0
        elif face_rel_h > 0.12:
            # 中等人脸（半身照）：较小的 scale_min 保底
            scale_min = (OUTPUT_SIZE * 0.5) / person_h if person_h > 0 else 0.5
        else:
            # 小人脸（全身照）：需要 scale_min 确保人物充分占据画面
            scale_min = (OUTPUT_SIZE * 0.75) / person_h if person_h > 0 else 0.75
        scale_ratio = max(scale_by_face, scale_min)
        scale_ratio = max(0.5, min(scale_ratio, 4.0))

        # 计算缩放后尺寸（允许超出画布，圆形蒙版会裁剪）
        person_target_w = int(person_w * scale_ratio)
        person_target_h = int(person_h * scale_ratio)

        # 限制最大尺寸防止内存过大（3000px 约 34MB RGBA，可接受）
        max_dim = int(OUTPUT_SIZE * 3.2)
        if person_target_w > max_dim or person_target_h > max_dim:
            limit = max_dim / max(person_target_w, person_target_h)
            scale_ratio *= limit
            person_target_w = int(person_w * scale_ratio)
            person_target_h = int(person_h * scale_ratio)

        # 人脸在缩放后图片中的坐标
        scaled_face_cx = int(face_cx_orig * scale_ratio)
        scaled_face_cy = int(face_cy_orig * scale_ratio)

        # 计算人物在画布上的偏移（使人脸对齐目标位置）
        person_x = TARGET_FACE_CX - scaled_face_cx
        person_y = TARGET_FACE_CY - scaled_face_cy

        # 边界保护：确保人脸不超出圆形边界（距圆心不超过 65% 半径）
        face_canvas_x = person_x + scaled_face_cx
        face_canvas_y = person_y + scaled_face_cy
        dx = face_canvas_x - CIRCLE_CX
        dy = face_canvas_y - CIRCLE_CY
        dist = (dx ** 2 + dy ** 2) ** 0.5
        max_face_dist = CIRCLE_R * 0.65
        if dist > max_face_dist:
            factor = max_face_dist / dist
            face_canvas_x = int(CIRCLE_CX + dx * factor)
            face_canvas_y = int(CIRCLE_CY + dy * factor)
            person_x = face_canvas_x - scaled_face_cx
            person_y = face_canvas_y - scaled_face_cy
            logger.info(f"Face boundary clamped: dist={dist:.1f} -> {max_face_dist:.1f}")

        logger.info(
            f"Smart layout v2: face_orig=({face_cx_orig},{face_cy_orig}), "
            f"scale_ratio={scale_ratio:.3f}, "
            f"person=({person_x},{person_y}), "
            f"face_canvas=({face_canvas_x},{face_canvas_y})"
        )
    else:
        # 兜底：底部对齐圆形底部
        person_target_h = int(OUTPUT_SIZE * 1.05)
        if person_h > 0:
            scale_ratio = person_target_h / person_h
        else:
            scale_ratio = 1.0

        # 宽度不超过画布宽度（兜底模式保守处理）
        max_w = int(OUTPUT_SIZE * 0.95)
        person_target_w = int(person_w * scale_ratio)
        if person_target_w > max_w:
            scale_ratio = max_w / person_w
            person_target_w = max_w
            person_target_h = int(person_h * scale_ratio)

        person_x = (OUTPUT_SIZE - person_target_w) // 2
        person_y = OUTPUT_SIZE - person_target_h
        logger.info("No face detected, using bottom-align fallback")

    person_img = person_img.resize(
        (person_target_w, person_target_h), Image.LANCZOS
    )

    # 4. 确定人物在画布上的 X 位置
    # 智能构图模式：person_x 已由人脸对齐计算得出
    # 兜底模式：person_x 已设置为水平居中
    if not face_detected:
        pass  # person_x 已在兜底逻辑中设置
    # （智能构图模式的 person_x 已在上面计算）

    # 5. 合成：背景 + 人物（圆形蒙版裁剪）
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

    # 6. 绘制黄色胶囊标签背景
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

    # 7. 绘制国旗圆形
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

    # 8. 绘制姓名文字（垂直居中对齐国旗圆心）
    font = get_font(FONT_SIZE)
    available_w = int((OUTPUT_SIZE - NAME_X) * 0.9)
    bbox = draw.textbbox((0, 0), name, font=font)
    text_w = bbox[2] - bbox[0]

    if text_w <= available_w:
        tbbox = draw.textbbox((0, 0), name, font=font)
        text_h = tbbox[3] - tbbox[1]
        text_y = int(FLAG_CY - text_h / 2 - tbbox[1])
        draw.text((NAME_X, text_y), name, font=font, fill=(0, 0, 0, 255))
    else:
        mid = len(name) // 2
        line1 = name[:mid]
        line2 = name[mid:]
        tbbox1 = draw.textbbox((0, 0), line1, font=font)
        tbbox2 = draw.textbbox((0, 0), line2, font=font)
        line_h = tbbox1[3] - tbbox1[1]
        line_spacing = int(line_h * 1.15)
        total_h = line_h + line_spacing
        text_y = int(FLAG_CY - total_h / 2 - tbbox1[1])
        draw.text((NAME_X, text_y), line1, font=font, fill=(0, 0, 0, 255))
        draw.text((NAME_X, text_y + line_spacing), line2, font=font, fill=(0, 0, 0, 255))

    # 9. 最终圆形蒙版裁剪，确保输出为正圆形
    final_mask = Image.new("L", (OUTPUT_SIZE, OUTPUT_SIZE), 0)
    final_draw = ImageDraw.Draw(final_mask)
    final_draw.ellipse((0, 0, OUTPUT_SIZE - 1, OUTPUT_SIZE - 1), fill=255)
    r, g, b, a = result.split()
    a = Image.fromarray(np.minimum(np.array(a), np.array(final_mask)))
    result = Image.merge("RGBA", (r, g, b, a))

    # 10. 输出 PNG
    output = io.BytesIO()
    result.save(output, format="PNG", dpi=(300, 300))
    if not return_layers:
        return output.getvalue(), face_detected
    # 11. 额外返回分层数据（用于前端拖拽微调）
    # bg_bottom：纯黄色圆形背景 + 香蕉 logo（人物下方）
    bg_bottom = BG_IMAGE.copy()
    fm_b = Image.new("L", (OUTPUT_SIZE, OUTPUT_SIZE), 0)
    ImageDraw.Draw(fm_b).ellipse((0, 0, OUTPUT_SIZE-1, OUTPUT_SIZE-1), fill=255)
    rb,gb,bb,ab = bg_bottom.split()
    ab = Image.fromarray(np.minimum(np.array(ab), np.array(fm_b)))
    bg_bottom = Image.merge("RGBA", (rb,gb,bb,ab))
    bg_bottom_out = io.BytesIO()
    bg_bottom.save(bg_bottom_out, format="PNG")

    # bg_top：胶囊标签 + 国旗 + 姓名（人物上方，透明背景）
    bg_top = Image.new("RGBA", (OUTPUT_SIZE, OUTPUT_SIZE), (0, 0, 0, 0))
    bg_top_draw = ImageDraw.Draw(bg_top)
    # 绘制胶囊标签
    lx2 = int(LABEL_X); ly2 = int(LABEL_Y)
    lw2 = int(LABEL_W); lh2 = int(LABEL_H)
    bg_top_draw.rounded_rectangle([lx2, ly2, lx2+lw2, ly2+lh2], radius=lh2//2, fill=(255,218,42,255))
    # 绘制国旗
    flag_img2 = load_flag_icon(nationality)
    if flag_img2:
        bg_top.paste(flag_img2, (int(FLAG_CX-FLAG_R), int(FLAG_CY-FLAG_R)), flag_img2)
    else:
        bg_top_draw.ellipse([int(FLAG_CX-FLAG_R), int(FLAG_CY-FLAG_R), int(FLAG_CX+FLAG_R), int(FLAG_CY+FLAG_R)], fill=(200,200,200,255))
    # 绘制姓名
    font2 = get_font(FONT_SIZE)
    bbox2 = bg_top_draw.textbbox((0,0), name, font=font2)
    text_w2 = bbox2[2] - bbox2[0]
    avail_w2 = int((OUTPUT_SIZE - NAME_X) * 0.9)
    if text_w2 <= avail_w2:
        tb2 = bg_top_draw.textbbox((0,0), name, font=font2)
        th2 = tb2[3] - tb2[1]
        ty2 = int(FLAG_CY - th2/2 - tb2[1])
        bg_top_draw.text((NAME_X, ty2), name, font=font2, fill=(0,0,0,255))
    else:
        mid2 = len(name)//2
        l1, l2 = name[:mid2], name[mid2:]
        tb1 = bg_top_draw.textbbox((0,0), l1, font=font2)
        lh_t = tb1[3]-tb1[1]; ls = int(lh_t*1.15)
        ty2 = int(FLAG_CY - (lh_t+ls)/2 - tb1[1])
        bg_top_draw.text((NAME_X, ty2), l1, font=font2, fill=(0,0,0,255))
        bg_top_draw.text((NAME_X, ty2+ls), l2, font=font2, fill=(0,0,0,255))
    # 圆形蒙版裁剪 bg_top
    fm2 = Image.new("L", (OUTPUT_SIZE, OUTPUT_SIZE), 0)
    ImageDraw.Draw(fm2).ellipse((0, 0, OUTPUT_SIZE-1, OUTPUT_SIZE-1), fill=255)
    r2,g2,b2,a2 = bg_top.split()
    a2 = Image.fromarray(np.minimum(np.array(a2), np.array(fm2)))
    bg_top = Image.merge("RGBA", (r2,g2,b2,a2))
    bg_top_out = io.BytesIO()
    bg_top.save(bg_top_out, format="PNG")
    # 兼容旧字段：bg_out = bg_bottom（不含标签）
    bg_out = bg_bottom_out
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
    return output.getvalue(), face_detected, person_out.getvalue(), bg_out.getvalue(), bg_top_out.getvalue(), layout_info


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

    try:
        photo_bytes = file.read()
        logger.info(f"Generating sticker for: {name} ({nationality}), rembg={use_rembg}")

        sticker_bytes, face_detected = generate_sticker(photo_bytes, name, nationality, use_rembg)

        b64 = base64.b64encode(sticker_bytes).decode("utf-8")
        logger.info(f"Sticker generated: {len(sticker_bytes)} bytes, face_detected={face_detected}")
        return jsonify({
            "success": True,
            "result": b64,
            "face_detected": face_detected,
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
    try:
        photo_bytes = file.read()
        logger.info(f"Generating sticker layers for: {name} ({nationality}), rembg={use_rembg}")
        sticker_bytes, face_detected, person_bytes, bg_bytes, bg_top_bytes, layout_info = generate_sticker(
            photo_bytes, name, nationality, use_rembg, return_layers=True
        )
        return jsonify({
            "success": True,
            "result": base64.b64encode(sticker_bytes).decode("utf-8"),
            "person_layer": base64.b64encode(person_bytes).decode("utf-8"),
            "bg_bottom_layer": base64.b64encode(bg_bytes).decode("utf-8"),
            "bg_top_layer": base64.b64encode(bg_top_bytes).decode("utf-8"),
            "layout": layout_info,
            "face_detected": face_detected,
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
        "face_detector": "yunet" if _yunet_detector is not None else "haar_only",
    })


if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5002, debug=False, threaded=True)
