"""生成 App 图标和开屏 Logo：深青绿底，白色对话气泡里是一段声波，右上角一颗小星光代表 AI。"""
import json, os, sys
from PIL import Image, ImageDraw, ImageFilter

OUT = sys.argv[1]
SS = 4  # supersampling
TEAL_TOP = (36, 98, 84)
TEAL_BOTTOM = (22, 66, 57)
MINT = (152, 228, 200)
WHITE = (255, 255, 255)

def gradient(size):
    img = Image.new('RGB', (size, size))
    d = ImageDraw.Draw(img)
    for y in range(size):
        t = y / (size - 1)
        c = tuple(round(TEAL_TOP[i] * (1 - t) + TEAL_BOTTOM[i] * t) for i in range(3))
        d.line([(0, y), (size, y)], fill=c)
    return img

def glyph(size, bubble=WHITE, wave=(30, 86, 74), star=MINT, transparent_wave=False):
    """在 size×size 透明画布上画气泡 + 声波 + 星光，坐标按 1024 设计稿缩放。"""
    S = size * SS
    k = S / 1024
    layer = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(layer)
    # 气泡主体
    x0, y0, x1, y1 = 212 * k, 262 * k, 812 * k, 702 * k
    d.rounded_rectangle([x0, y0, x1, y1], radius=150 * k, fill=bubble)
    # 气泡尾巴（左下）
    d.polygon([(318 * k, 650 * k), (300 * k, 800 * k), (452 * k, 690 * k)], fill=bubble)
    # 声波：5 根圆头竖条
    cx, cy = 512 * k, 482 * k
    heights = [130, 220, 300, 220, 130]
    bar_w, gap = 62 * k, 30 * k
    total = len(heights) * bar_w + (len(heights) - 1) * gap
    left = cx - total / 2
    mask = Image.new('L', (S, S), 0)
    md = ImageDraw.Draw(mask)
    for i, h in enumerate(heights):
        bx = left + i * (bar_w + gap)
        hh = h * k
        md.rounded_rectangle([bx, cy - hh / 2, bx + bar_w, cy + hh / 2], radius=bar_w / 2, fill=255)
    if transparent_wave:
        # 开屏 Logo：声波镂空，透出背景色
        alpha = layer.getchannel('A')
        alpha = Image.composite(Image.new('L', (S, S), 0), alpha, mask)
        layer.putalpha(alpha)
    else:
        layer.paste(Image.new('RGBA', (S, S), wave + (255,)), (0, 0), mask)
    # 星光：四角星
    sx, sy, r, w = 808 * k, 250 * k, 92 * k, 26 * k
    d = ImageDraw.Draw(layer)
    d.polygon([(sx, sy - r), (sx + w, sy - w), (sx + r, sy), (sx + w, sy + w),
               (sx, sy + r), (sx - w, sy + w), (sx - r, sy), (sx - w, sy - w)], fill=star)
    return layer.resize((size, size), Image.LANCZOS)

def app_icon(size=1024):
    bg = gradient(size).convert('RGBA')
    # 气泡下方一层很淡的阴影，增加层次
    shadow = glyph(size, bubble=(0, 0, 0), wave=(0, 0, 0), star=(0, 0, 0, 0))
    shadow.putalpha(shadow.getchannel('A').point(lambda a: int(a * 0.18)))
    shadow = shadow.filter(ImageFilter.GaussianBlur(size * 0.018))
    bg.alpha_composite(shadow, (0, int(size * 0.012)))
    bg.alpha_composite(glyph(size))
    return bg.convert('RGB')

def write_json(path, data):
    with open(path, 'w') as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
        f.write('\n')

assets = os.path.join(OUT, 'Assets.xcassets')
os.makedirs(assets, exist_ok=True)
write_json(os.path.join(assets, 'Contents.json'), {'info': {'author': 'xcode', 'version': 1}})

# App 图标：Xcode 15+ 单一 1024 尺寸
icon_dir = os.path.join(assets, 'AppIcon.appiconset')
os.makedirs(icon_dir, exist_ok=True)
app_icon().save(os.path.join(icon_dir, 'AppIcon-1024.png'))
write_json(os.path.join(icon_dir, 'Contents.json'), {
    'images': [{'filename': 'AppIcon-1024.png', 'idiom': 'universal', 'platform': 'ios', 'size': '1024x1024'}],
    'info': {'author': 'xcode', 'version': 1},
})

# 开屏 Logo：白色气泡、声波镂空，放在 LaunchBackground 色上
logo_dir = os.path.join(assets, 'LaunchLogo.imageset')
os.makedirs(logo_dir, exist_ok=True)
images = []
for scale in (1, 2, 3):
    name = f'LaunchLogo@{scale}x.png' if scale > 1 else 'LaunchLogo.png'
    glyph(120 * scale, transparent_wave=True).save(os.path.join(logo_dir, name))
    images.append({'filename': name, 'idiom': 'universal', 'scale': f'{scale}x'})
write_json(os.path.join(logo_dir, 'Contents.json'), {'images': images, 'info': {'author': 'xcode', 'version': 1}})

def colorset(name, light, dark):
    p = os.path.join(assets, f'{name}.colorset')
    os.makedirs(p, exist_ok=True)
    def comp(rgb):
        return {'color-space': 'srgb', 'components': {
            'red': f'{rgb[0] / 255:.3f}', 'green': f'{rgb[1] / 255:.3f}', 'blue': f'{rgb[2] / 255:.3f}', 'alpha': '1.000'}}
    write_json(os.path.join(p, 'Contents.json'), {
        'colors': [
            {'idiom': 'universal', 'color': comp(light)},
            {'idiom': 'universal', 'appearances': [{'appearance': 'luminosity', 'value': 'dark'}], 'color': comp(dark)},
        ],
        'info': {'author': 'xcode', 'version': 1},
    })

colorset('AccentColor', (36, 110, 94), (122, 196, 172))
colorset('LaunchBackground', (29, 82, 71), (18, 52, 45))

# 预览图：图标 + 模拟开屏
preview = Image.new('RGB', (1500, 900), (246, 245, 242))
icon = app_icon().resize((560, 560), Image.LANCZOS)
m = Image.new('L', (560, 560), 0)
ImageDraw.Draw(m).rounded_rectangle([0, 0, 559, 559], radius=126, fill=255)
preview.paste(icon, (120, 170), m)
launch = Image.new('RGB', (390, 760), (29, 82, 71))
lg = glyph(360, transparent_wave=True)
launch.paste(lg, (15, 200), lg)
lm = Image.new('L', (390, 760), 0)
ImageDraw.Draw(lm).rounded_rectangle([0, 0, 389, 759], radius=48, fill=255)
preview.paste(launch, (920, 70), lm)
preview.save(os.path.join(OUT, '..', 'icon-preview.png'))
print('ok')
