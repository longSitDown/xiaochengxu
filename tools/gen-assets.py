# -*- coding: utf-8 -*-
"""
红色纪念馆小程序 - 静态资源生成脚本（一次性工具，不打包进小程序）
生成：
  images/tab/*        tabBar 图标（81x81 PNG，灰/红两态）
  images/logo.png     Logo
  images/banners/*    首页轮播 Banner（750x340）
  images/covers/*     资讯/展品封面（600x400）
  images/panorama.png 720°全景展馆背景（2048x1024 等距柱状投影）
  images/placeholder.png 默认头像
  audio/demo*.wav     语音讲解演示音频（正弦波旋律）
"""
import math
import os
import struct
import wave

from PIL import Image, ImageDraw, ImageFont, ImageFilter

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
IMG = os.path.join(ROOT, 'images')
AUD = os.path.join(ROOT, 'audio')
os.makedirs(os.path.join(IMG, 'tab'), exist_ok=True)
os.makedirs(os.path.join(IMG, 'banners'), exist_ok=True)
os.makedirs(os.path.join(IMG, 'covers'), exist_ok=True)
os.makedirs(AUD, exist_ok=True)

FONT = r'C:\Windows\Fonts\msyh.ttc'
FONT_BD = r'C:\Windows\Fonts\msyhbd.ttc'

RED = (200, 16, 46)
RED_DARK = (158, 11, 32)
GOLD = (201, 160, 99)
GRAY = (154, 154, 154)
WHITE = (255, 255, 255)


def font(size, bold=True):
    try:
        return ImageFont.truetype(FONT_BD if bold else FONT, size)
    except Exception:
        return ImageFont.load_default()


def vgrad(w, h, top, bottom):
    """垂直渐变"""
    img = Image.new('RGB', (w, h))
    dr = ImageDraw.Draw(img)
    for y in range(h):
        t = y / max(1, h - 1)
        c = tuple(int(top[i] + (bottom[i] - top[i]) * t) for i in range(3))
        dr.line([(0, y), (w, y)], fill=c)
    return img


def star_points(cx, cy, r_out, r_in, n=5, rot=-90):
    pts = []
    for i in range(2 * n):
        r = r_out if i % 2 == 0 else r_in
        a = math.radians(rot + i * 180 / n)
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


# ================= tabBar 图标 =================

def draw_home(color):
    img = Image.new('RGBA', (81, 81), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.polygon([(40, 12), (12, 39), (68, 39)], fill=color)          # 屋顶
    d.rounded_rectangle([24, 38, 56, 66], radius=4, fill=color)     # 屋身
    d.rectangle([36, 50, 44, 66], fill=(255, 255, 255, 255))        # 门
    return img


def draw_hall(color):
    """古典展馆立面（三角楣 + 柱廊）"""
    img = Image.new('RGBA', (81, 81), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.polygon([(40, 12), (13, 35), (67, 35)], fill=color)           # 三角楣
    d.rectangle([15, 35, 65, 41], fill=color)                        # 檐部
    for x in (19, 31, 43, 55):
        d.rectangle([x, 41, x + 5, 62], fill=color)                  # 立柱
    d.rectangle([16, 62, 64, 67], fill=color)                        # 台基
    return img


def draw_quiz(color):
    img = Image.new('RGBA', (81, 81), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.polygon(star_points(40, 44, 27, 11), fill=color)               # 五角星
    d.ellipse([52, 12, 64, 24], fill=color)                          # 点缀圆点
    return img


def draw_profile(color):
    img = Image.new('RGBA', (81, 81), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([29, 12, 51, 34], fill=color)                          # 头
    d.pieslice([18, 36, 62, 76], 180, 360, fill=color)               # 肩
    return img


def draw_resv(color):
    """预约参观：日历票券（圆角边框 + 顶部挂环 + 五角星）"""
    img = Image.new('RGBA', (81, 81), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([14, 18, 67, 68], radius=8, outline=color, width=5)  # 票券边框
    d.rectangle([14, 32, 67, 40], fill=color)                                 # 日历头带
    for x in (27, 54):                                                        # 挂环
        d.rectangle([x - 2, 12, x + 2, 22], fill=color)
    d.polygon(star_points(40, 52, 12, 5), fill=color)                         # 中央五角星
    return img


def gen_tab_icons():
    makers = {'home': draw_home, 'hall': draw_hall, 'quiz': draw_quiz, 'profile': draw_profile,
              'resv': draw_resv}
    for name, fn in makers.items():
        fn(GRAY).save(os.path.join(IMG, 'tab', name + '.png'))
        fn(RED).save(os.path.join(IMG, 'tab', name + '-active.png'))
    print('[tab] done')


# ================= Logo =================

def gen_logo():
    img = Image.new('RGBA', (200, 200), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([8, 8, 192, 192], fill=RED)
    d.ellipse([16, 16, 184, 184], outline=GOLD, width=4)
    d.polygon(star_points(100, 100, 62, 26), fill=(255, 255, 255, 255))
    d.polygon(star_points(100, 100, 22, 9, rot=54), fill=GOLD)
    img.save(os.path.join(IMG, 'logo.png'))
    print('[logo] done')


# ================= Banner =================

def banner_text(d, txt, size, y, fill, bold=True):
    f = font(size, bold)
    w = d.textlength(txt, font=f)
    d.text(((750 - w) / 2, y), txt, font=f, fill=fill)


def gen_banners():
    specs = [
        ('铭记历史 缅怀先烈', '红色纪念馆 · 爱国主义教育示范基地'),
        ('传承红色基因 赓续精神血脉', '线上参观 720°全景数字展馆'),
        ('重温红色岁月 致敬革命英烈', '预约参观 · 知识竞赛 · 场馆指南'),
    ]
    for i, (main, sub) in enumerate(specs, 1):
        img = vgrad(750, 340, (150, 14, 34), (196, 20, 46))
        d = ImageDraw.Draw(img, 'RGBA')
        # 斜向装饰线
        for k in range(-340, 750, 60):
            d.line([(k, 340), (k + 140, 0)], fill=(255, 255, 255, 18), width=2)
        # 右上角金星
        d.polygon(star_points(660, 78, 52, 22), fill=(255, 255, 255, 60))
        # 左侧红绸
        d.polygon([(0, 300), (120, 300), (200, 340), (0, 340)], fill=(120, 8, 26, 220))
        banner_text(d, main, 58, 108, WHITE)
        # 副标题底条
        d.rounded_rectangle([140, 196, 610, 236], radius=20, fill=(120, 8, 26, 160))
        banner_text(d, sub, 28, 201, (255, 226, 200))
        img.save(os.path.join(IMG, 'banners', 'banner-%d.png' % i))
    print('[banners] done')


# ================= Covers =================

def cover_with(uri, title, motif, base_top, base_bottom):
    img = vgrad(600, 400, base_top, base_bottom)
    dr = ImageDraw.Draw(img, 'RGBA')
    # 背景大标题（半透明）
    f = font(120, True)
    w = dr.textlength(title, font=f)
    dr.text(((600 - w) / 2, 120), title, font=f, fill=(255, 255, 255, 26))

    motif(img, dr)

    # 底部信息条
    dr.rectangle([0, 320, 600, 400], fill=(90, 6, 20, 200))
    dr.polygon(star_points(52, 360, 20, 9), fill=GOLD)
    dr.text((88, 330), title, font=font(40, True), fill=WHITE)
    dr.text((88, 372), '红色纪念馆 · 数字馆藏', font=font(20, False), fill=(255, 226, 200))
    img.save(os.path.join(IMG, 'covers', uri + '.png'))


def m_star(img, dr):
    """居中大五角星（叠加在底纹上）"""
    dr.polygon(star_points(300, 190, 120, 50), fill=(255, 255, 255, 36))


def m_envelope(img, dr):
    dr.rounded_rectangle([200, 130, 400, 270], radius=10, fill=(255, 255, 255, 46))
    dr.polygon([(200, 130), (300, 205), (400, 130)], fill=(210, 40, 60, 90))


def m_medal(img, dr):
    dr.ellipse([225, 115, 375, 265], outline=(255, 255, 255, 90), width=8)
    dr.polygon(star_points(300, 190, 62, 26), fill=(255, 255, 255, 70))
    dr.rectangle([286, 265, 314, 300], fill=(255, 255, 255, 70))


def m_mountain(img, dr):
    dr.polygon([(0, 320), (150, 150), (260, 280), (360, 120), (480, 260), (600, 180), (600, 320)], fill=(40, 5, 12, 120))


def m_flame(img, dr):
    """火炬火焰"""
    dr.rectangle([288, 240, 312, 300], fill=(255, 235, 200, 90))
    dr.ellipse([250, 120, 350, 250], fill=(255, 200, 60, 90))
    dr.ellipse([272, 95, 328, 175], fill=(255, 150, 40, 110))


def m_shield(img, dr):
    dr.polygon([(300, 110), (365, 140), (365, 220), (300, 285), (235, 220), (235, 140)], outline=(255, 255, 255, 80), width=8)
    dr.polygon(star_points(300, 195, 40, 17), fill=(255, 255, 255, 70))


def m_sun(img, dr):
    dr.pieslice([140, 150, 460, 470], 180, 360, fill=(255, 210, 120, 80))


def m_ribbon(img, dr):
    dr.polygon([(180, 170), (420, 170), (400, 205), (420, 240), (180, 240), (200, 205)], fill=(255, 255, 255, 46))


def m_building(img, dr):
    dr.rectangle([170, 150, 430, 320], fill=(40, 5, 12, 110))
    dr.polygon([(170, 150), (300, 90), (430, 150)], fill=(40, 5, 12, 130))
    for x in range(195, 410, 45):
        dr.rectangle([x, 200, x + 18, 320], fill=(255, 255, 255, 40))
    dr.polygon(star_points(300, 175, 24, 10), fill=GOLD)


def gen_covers():
    covers = [
        ('cover-horn', '军号嘹亮', m_star, (140, 10, 30), (60, 4, 14)),
        ('cover-letter', '红色书信', m_envelope, (110, 16, 36), (52, 6, 16)),
        ('cover-medal', '革命勋章', m_medal, (150, 20, 34), (70, 6, 12)),
        ('cover-mountain', '峥嵘岁月', m_mountain, (90, 24, 28), (36, 8, 10)),
        ('cover-flame', '浴血奋战', m_flame, (170, 22, 30), (80, 8, 10)),
        ('cover-spark', '星火燎原', m_star, (24, 22, 46), (8, 6, 18)),
        ('cover-course', '光辉历程', m_sun, (150, 40, 30), (70, 14, 10)),
        ('cover-hero', '英烈不朽', m_mountain, (40, 34, 32), (14, 8, 10)),
        ('cover-oath', '初心如磐', m_shield, (160, 26, 20), (90, 10, 8)),
        ('cover-blood', '血脉传承', m_ribbon, (150, 12, 40), (72, 4, 18)),
        ('cover-hall', '红色展馆', m_building, (120, 30, 24), (52, 10, 8)),
        ('cover-spirit', '精神永存', m_flame, (180, 60, 20), (90, 22, 8)),
    ]
    for uri, title, motif, top, bottom in covers:
        cover_with(uri, title, motif, top, bottom)
    print('[covers] done')


# ================= 全景展馆背景 =================

def radial_glow(size, center, radius, color):
    """径向光斑（alpha 渐变）"""
    w, h = size
    ov = Image.new('RGBA', (w, h), (0, 0, 0, 0))
    d = ImageDraw.Draw(ov)
    steps = 24
    for i in range(steps, 0, -1):
        r = radius * i / steps
        a = int(120 * (1 - i / steps) ** 1.4)
        c = (color[0], color[1], color[2], a)
        d.ellipse([center[0] - r, center[1] - r, center[0] + r, center[1] + r], fill=c)
    return ov


def gen_panorama():
    W, H = 2048, 1024
    img = Image.new('RGB', (W, H))
    d = ImageDraw.Draw(img)

    # 天花板 / 墙面 / 地板
    for y in range(0, 230):
        t = y / 230
        c = tuple(int(24 + (44 - 24) * t) for _ in range(3))
        d.line([(0, y), (W, y)], fill=(c[0] - 6, c[1] - 8, c[2] - 8))
    wall = vgrad(W, 600, (96, 26, 32), (118, 34, 40))
    img.paste(wall, (0, 230))
    floor = vgrad(W, 194, (56, 30, 20), (30, 16, 10))
    img.paste(floor, (0, 830))
    # 地板分隔线（透视感）
    df = ImageDraw.Draw(img)
    for k in range(0, W, 128):
        df.line([(k, 830), (k, 1024)], fill=(20, 10, 6), width=2)

    # 等距柱状：每 512px 一个柱子（保证首尾无缝）
    col_w = 88
    for cx in range(256, W + 256, 512):
        if cx - col_w // 2 >= W:
            continue
        x0 = max(0, cx - col_w // 2)
        x1 = min(W, cx + col_w // 2)
        d.rectangle([x0, 230, x1, 830], fill=(58, 20, 24))
        d.rectangle([x0, 230, x0 + 10, 830], fill=(90, 36, 40))     # 高光
        d.rectangle([x1 - 10, 230, x1, 830], fill=(36, 12, 15))     # 阴影
        # 柱头
        d.rectangle([x0 - 14, 226, x1 + 14, 250], fill=(70, 26, 30))

    # 红色横幅（柱子之间）
    for bx in (512, 1024, 1536):
        d.rectangle([bx - 60, 320, bx + 60, 700], fill=(176, 22, 40))
        d.rectangle([bx - 60, 320, bx + 60, 340], fill=(120, 8, 24))
        d.rectangle([bx - 60, 680, bx + 60, 700], fill=(120, 8, 24))
        d.polygon(star_points(bx, 500, 40, 17), fill=(232, 200, 140))

    # 中央拱门（焦点）
    d.rounded_rectangle([760, 240, 1288, 830], radius=260, fill=(70, 22, 26))
    d.rounded_rectangle([796, 276, 1252, 830], radius=230, fill=(44, 14, 17))
    d.text((1024 - 130, 330), '红色纪念馆', font=font(64, True), fill=(232, 200, 140))
    d.text((1024 - 150, 420), 'RED MEMORIAL HALL', font=font(30, False), fill=(200, 160, 120))
    # 拱门内展台
    d.rounded_rectangle([860, 620, 1188, 830], radius=20, fill=(26, 10, 12))
    for ex in (900, 1024, 1148):
        d.rounded_rectangle([ex - 44, 560, ex + 44, 660], radius=8, fill=(150, 120, 80))

    # 射灯光斑
    for sx in (330, 860, 1180, 1730):
        img = Image.alpha_composite(img.convert('RGBA'), radial_glow((W, H), (sx, 780), 420, (255, 240, 200)))
        img = img.convert('RGB')
    img = img.convert('RGB')
    img.save(os.path.join(IMG, 'panorama.png'))
    print('[panorama] done')


# ================= 首页 8 宫格彩色图标 =================

def _entry_base(bg):
    """浅色圆底（144x144）"""
    img = Image.new('RGBA', (144, 144), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse([4, 4, 140, 140], fill=bg)
    return img, d


def draw_entry_notice():
    """参观须知：红皮书"""
    img, d = _entry_base((251, 235, 236, 255))
    d.rounded_rectangle([34, 36, 110, 112], radius=8, fill=(200, 16, 46, 255))   # 封面
    d.rectangle([44, 48, 100, 100], fill=(255, 255, 255, 255))                   # 书页
    for y in (60, 74, 88):
        d.line([(52, y), (92, y)], fill=(210, 170, 130, 255), width=4)          # 文字行
    return img


def draw_entry_vr():
    """VR 展览：VR 眼镜"""
    img, d = _entry_base((232, 240, 252, 255))
    d.rounded_rectangle([28, 50, 116, 100], radius=20, fill=(58, 96, 178, 255)) # 镜框
    d.ellipse([38, 60, 68, 90], fill=(255, 255, 255, 255))                      # 左镜筒
    d.ellipse([76, 60, 106, 90], fill=(255, 255, 255, 255))                     # 右镜筒
    d.rounded_rectangle([38, 34, 50, 54], radius=6, fill=(58, 96, 178, 255))    # 绑带扣
    d.rounded_rectangle([94, 34, 106, 54], radius=6, fill=(58, 96, 178, 255))
    return img


def draw_entry_hall():
    """展厅导览：展馆 + 时钟"""
    img, d = _entry_base((250, 240, 224, 255))
    c = (176, 128, 60, 255)
    d.polygon([(72, 30), (30, 62), (114, 62)], fill=c)                          # 三角楣
    d.rectangle([32, 62, 112, 70], fill=c)                                       # 檐部
    for x in (40, 58, 76, 94):
        d.rectangle([x, 70, x + 6, 104], fill=c)                                 # 立柱
    d.rectangle([34, 104, 110, 112], fill=c)                                     # 台基
    d.ellipse([92, 30, 116, 54], fill=(200, 16, 46, 255))                        # 时钟
    d.ellipse([97, 35, 111, 49], fill=(255, 255, 255, 255))
    d.line([(104, 42), (104, 37)], fill=(200, 16, 46, 255), width=3)
    d.line([(104, 42), (108, 44)], fill=(200, 16, 46, 255), width=3)
    return img


def draw_entry_ai():
    """AI 讲解：耳机 + 声波"""
    img, d = _entry_base((252, 234, 238, 255))
    c = (200, 16, 46, 255)
    d.arc([40, 34, 104, 92], 180, 360, fill=c, width=8)                          # 头梁
    d.rounded_rectangle([32, 62, 48, 100], radius=8, fill=c)                     # 左耳罩
    d.rounded_rectangle([96, 62, 112, 100], radius=8, fill=c)                    # 右耳罩
    for i, h in enumerate((14, 24, 18)):                                         # 声波
        x = 60 + i * 10
        d.rounded_rectangle([x, 72 - h // 2, x + 5, 72 + h // 2], radius=3, fill=(230, 120, 90, 255))
    return img


def draw_entry_relic():
    """文物赏析：三足鼎"""
    img, d = _entry_base((238, 242, 230, 255))
    c = (110, 132, 84, 255)
    d.ellipse([44, 48, 100, 88], fill=c)                                         # 鼎腹
    d.rectangle([40, 44, 104, 58], fill=c)                                       # 鼎口沿
    d.polygon([(46, 84), (38, 108), (52, 108), (58, 88)], fill=c)                # 左足
    d.polygon([(98, 84), (106, 108), (92, 108), (86, 88)], fill=c)               # 右足
    d.polygon([(66, 88), (78, 88), (74, 108), (70, 108)], fill=c)                # 中足
    d.arc([26, 30, 48, 66], 90, 270, fill=c, width=6)                            # 左耳
    d.arc([96, 30, 118, 66], 270, 90, fill=c, width=6)                           # 右耳
    return img


def draw_entry_mourn():
    """祭扫烈士：纪念碑 + 花环"""
    img, d = _entry_base((240, 238, 246, 255))
    c = (108, 92, 160, 255)
    d.polygon([(72, 28), (52, 44), (92, 44)], fill=(200, 16, 46, 255))           # 碑顶星
    d.polygon([(60, 44), (84, 44), (80, 108), (64, 108)], fill=c)                # 碑身
    d.rectangle([46, 108, 98, 118], fill=c)                                      # 底座
    d.ellipse([24, 60, 56, 92], outline=(150, 60, 70, 255), width=6)             # 花环
    d.ellipse([88, 60, 120, 92], outline=(150, 60, 70, 255), width=6)
    return img


def draw_entry_map():
    """红色地图：定位标"""
    img, d = _entry_base((234, 246, 240, 255))
    c = (44, 130, 96, 255)
    d.polygon([(72, 118), (40, 66), (104, 66)], fill=c)                          # 钉身
    d.ellipse([48, 30, 96, 78], fill=c)                                          # 钉头
    d.ellipse([60, 42, 84, 66], fill=(255, 255, 255, 255))                       # 中心孔
    d.polygon(star_points(72, 54, 9, 4), fill=(200, 16, 46, 255))                # 中心星
    return img


def draw_entry_event():
    """场馆活动：旗帜"""
    img, d = _entry_base((252, 240, 226, 255))
    c = (188, 110, 40, 255)
    d.rectangle([44, 28, 52, 116], fill=c)                                       # 旗杆
    d.polygon([(52, 32), (112, 44), (52, 72)], fill=(200, 16, 46, 255))          # 红旗
    d.polygon([(52, 72), (104, 82), (52, 106)], fill=(230, 140, 60, 255))        # 黄旗
    return img


def draw_entry_quiz():
    """知识竞赛：答题卡 + 对勾"""
    img, d = _entry_base((252, 238, 232, 255))
    c = (200, 16, 46, 255)
    d.rounded_rectangle([34, 26, 110, 118], radius=10, fill=(255, 255, 255, 255), outline=c, width=4)  # 答题卡
    d.line([(46, 44), (98, 44)], fill=(226, 196, 168, 255), width=5)             # 题干
    d.line([(46, 56), (80, 56)], fill=(226, 196, 168, 255), width=5)
    d.ellipse([46, 72, 62, 88], outline=c, width=4)                              # 选项一（未选）
    d.ellipse([46, 96, 62, 112], fill=c)                                         # 选项二（已选，实心更易辨识）
    d.line([(49, 104), (52, 108)], fill=(255, 255, 255, 255), width=3)           # 白色对勾左笔
    d.line([(52, 108), (59, 99)], fill=(255, 255, 255, 255), width=3)            # 白色对勾右笔
    d.line([(70, 80), (98, 80)], fill=(226, 196, 168, 255), width=5)
    d.line([(70, 104), (98, 104)], fill=(226, 196, 168, 255), width=5)
    return img


def gen_entry_icons():
    icons = {
        'notice': draw_entry_notice, 'vr': draw_entry_vr, 'hall': draw_entry_hall,
        'ai': draw_entry_ai, 'relic': draw_entry_relic, 'mourn': draw_entry_mourn,
        'map': draw_entry_map, 'event': draw_entry_event, 'quiz': draw_entry_quiz
    }
    out = os.path.join(IMG, 'entry')
    os.makedirs(out, exist_ok=True)
    for name, fn in icons.items():
        fn().save(os.path.join(out, 'entry-%s.png' % name))
    print('[entry] done')


# ================= 首页 hero 书法标题 =================

def gen_hero_title():
    """楷体书法标题：山河无恙 敬忠魂 + 红色印章（透明底 PNG）"""
    kai = r'C:\Windows\Fonts\simkai.ttf'
    img = Image.new('RGBA', (1080, 260), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    try:
        f = ImageFont.truetype(kai, 120)
        f_small = ImageFont.truetype(kai, 44)
        f_seal = ImageFont.truetype(kai, 40)
    except Exception:
        f = f_small = f_seal = ImageFont.load_default()
    txt = '山河无恙 敬忠魂'
    w = d.textlength(txt, font=f)
    # 主标题：白字 + 金色描边（浅投影增强层次）
    d.text(((1080 - w) / 2 + 4, 44 + 4), txt, font=f, fill=(120, 10, 24, 140))
    d.text(((1080 - w) / 2, 44), txt, font=f, fill=(255, 255, 255, 255),
           stroke_width=2, stroke_fill=(232, 200, 140, 255))
    # 红色印章（右上角）：铭记历史 2x2 印文
    d.rounded_rectangle([924, 16, 1024, 116], radius=10, fill=(196, 24, 42, 235))
    for i, ch in enumerate('铭记历史'):
        d.text((940 + (i % 2) * 36, 26 + (i // 2) * 44), ch, font=f_seal, fill=(255, 255, 255, 255))
    # 副标
    sub = '—— 红色纪念馆 · 爱国主义教育基地 ——'
    ws = d.textlength(sub, font=f_small)
    d.text(((1080 - ws) / 2, 196), sub, font=f_small, fill=(255, 226, 190, 230))
    img.save(os.path.join(IMG, 'hero-title.png'))
    print('[hero-title] done')


# ================= 占位头像 =================

def gen_placeholder():
    img = Image.new('RGBA', (200, 200), (233, 230, 225, 255))
    d = ImageDraw.Draw(img)
    d.ellipse([70, 40, 130, 100], fill=(190, 186, 180, 255))
    d.pieslice([40, 90, 160, 210], 180, 360, fill=(190, 186, 180, 255))
    img.save(os.path.join(IMG, 'placeholder.png'))
    print('[placeholder] done')


# ================= 演示音频（正弦波旋律） =================

SR = 22050
NOTE = {'C5': 523.25, 'D5': 587.33, 'E5': 659.25, 'G5': 783.99, 'A5': 880.0,
        'C6': 1046.5, 'E6': 1318.5, 'G6': 1567.98, 'A4': 440.0, 'G4': 392.0,
        'F4': 349.23, 'E4': 329.63, 'D4': 293.66, 'C4': 261.63, 'B4': 493.88}


def synth(freq, dur, amp=0.42):
    n = int(SR * dur)
    out = []
    for i in range(n):
        t = i / SR
        env = min(1.0, t * 25) * min(1.0, (dur - t) * 6)
        v = amp * env * (math.sin(2 * math.pi * freq * t)
                         + 0.28 * math.sin(2 * math.pi * freq * 2 * t)
                         + 0.12 * math.sin(2 * math.pi * freq * 3 * t))
        out.append(v)
    return out


def melody_wav(path, seq):
    """seq: [(note, beat)]，beat 为 0.45s 的倍数"""
    beat = 0.45
    samples = []
    for name, b in seq:
        samples.extend(synth(NOTE[name], beat * b))
        samples.extend(synth(0, 0.03))  # 间隙
    with wave.open(path, 'w') as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        frames = b''.join(struct.pack('<h', int(max(-1, min(1, s)) * 32000)) for s in samples)
        w.writeframes(frames)


def gen_audio():
    melody_wav(os.path.join(AUD, 'demo1.wav'), [
        ('C5', 1), ('E5', 1), ('G5', 1), ('C6', 2),
        ('G5', 1), ('E5', 1), ('C5', 1), ('G4', 2), ('C5', 3)])
    melody_wav(os.path.join(AUD, 'demo2.wav'), [
        ('G4', 1), ('C5', 1), ('D5', 1), ('E5', 2),
        ('C5', 1), ('D5', 1), ('E5', 1), ('G5', 2), ('E5', 3)])
    melody_wav(os.path.join(AUD, 'demo3.wav'), [
        ('A4', 1), ('C5', 1), ('E5', 1), ('A5', 2), ('G5', 1),
        ('E5', 1), ('C5', 1), ('A4', 2), ('C5', 4)])
    print('[audio] done')


if __name__ == '__main__':
    gen_tab_icons()
    gen_logo()
    gen_banners()
    gen_covers()
    gen_panorama()
    gen_placeholder()
    gen_audio()
    print('ALL DONE')
