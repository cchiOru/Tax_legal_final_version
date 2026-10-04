#!/usr/bin/env python3
"""
สร้างและติดตั้ง Rich Menu (เมนู 6 ปุ่มใต้หน้าแชท) ของ LINE OA ระบบที่ปรึกษาภาษี

รูปที่ออกแบบเอง: 2500 x 1686 พิกเซล ไฟล์ PNG ไม่เกิน 1 MB วางไว้ที่ line/tax_chatbot_rich_menu.png
หรือ line/rich-menu-custom.png (ถ้าไม่มี จะวาดรูปสำรองด้วย Pillow)
ลำดับปุ่มในรูปต้องตรงกับ BUTTONS เพราะพื้นที่กดคำนวณจากลำดับนั้น ไม่ได้อ่านจากรูป

    pip install pillow requests
    python line/setup-rich-menu.py                สร้างเมนู (อ่าน LINE_CHANNEL_ACCESS_TOKEN จาก .env)
    python line/setup-rich-menu.py --image-only   วาดรูปอย่างเดียว ไม่ติดต่อ LINE
    python line/setup-rich-menu.py --list         ดูเมนูที่มีอยู่
    python line/setup-rich-menu.py --clean        ลบเมนูเดิมทั้งหมดก่อนสร้างใหม่
"""

import json
import sys
from pathlib import Path

try:
    import requests
    from PIL import Image, ImageDraw, ImageFont
except ImportError:
    sys.exit("ต้องติดตั้งไลบรารีก่อน:\n    pip install pillow requests")

ROOT = Path(__file__).resolve().parent.parent
HERE = Path(__file__).resolve().parent

# รูปที่สคริปต์วาดเอง ใช้สำรองเมื่อไม่มีรูปที่ออกแบบไว้
IMG_PATH = HERE / "rich-menu.png"

# รูปที่ออกแบบเอง ใช้ไฟล์แรกที่เจอ
# ห้ามตั้งชื่อซ้ำกับ IMG_PATH ไม่งั้นรูปที่วาดจะเขียนทับงานออกแบบ
CUSTOM_IMG_CANDIDATES = [
    HERE / "tax_chatbot_rich_menu.png",
    HERE / "rich-menu-custom.png",
]

# ชื่อที่แนะนำในข้อความ เมื่อยังไม่มีรูปที่ออกแบบเลย
CUSTOM_IMG_PATH = CUSTOM_IMG_CANDIDATES[0]


def find_custom_image():
    """คืนไฟล์รูปที่ออกแบบเองไฟล์แรกที่มีอยู่จริง ถ้าไม่มีเลยคืน None"""
    for path in CUSTOM_IMG_CANDIDATES:
        if path.exists():
            return path
    return None

# ขนาดที่ LINE กำหนดสำหรับ Rich Menu แบบเต็ม
W, H = 2500, 1686
COLS, ROWS = 3, 2
CW, CH = W // COLS, H // ROWS

# ไอคอนสูงราว 22% ของความสูงช่อง ชัดบนมือถือโดยไม่เบียดข้อความ
ICON_R = int(CH * 0.11)
ICON_W = max(6, int(CH * 0.012))

# ปุ่มเรียงซ้ายไปขวา บนลงล่าง ค่า text คือข้อความที่ส่งเข้าแชทเหมือนผู้ใช้พิมพ์เอง
#   ปุ่ม 1-2 เป็นคำถามปกติ, ปุ่ม 3-5 ตอบสำเร็จรูป (ไม่เรียกแบบจำลอง), ปุ่ม 6 เปิดเมนูรายงาน/คุยกับแอดมิน
# ข้อความ text ต้องตรงกับ SMALL_TALK_CODE / MENU_SHORTCUTS ใน n8n/build-workflow.py (มีเทสต์ตรวจ)
BUTTONS = [
    {
        "title": "คำนวณภาษี",
        "icon": "calculator",
        "subtitle": "ต้องเสียเท่าไหร่",
        # ส่งข้อความสั้น แล้วโหนด Extract LINE Data ขยายเป็นคำถามเต็มด้วย MENU_SHORTCUTS
        "text": "คำนวณภาษี",
        "color": (0x1D, 0x9E, 0x75),
    },
    {
        "title": "ค่าลดหย่อน",
        "icon": "receipt",
        "subtitle": "ลดหย่อนอะไรได้บ้าง",
        "text": "ค่าลดหย่อน",
        "color": (0x37, 0x8A, 0xDD),
    },
    {
        "title": "คำถามที่พบบ่อย",
        "icon": "question",
        "subtitle": "ไม่รู้จะถามอะไร กดนี่",
        "text": "คำถามที่พบบ่อย",
        "color": (0x7F, 0x77, 0xDD),
    },
    {
        "title": "ขั้นตอนการยื่น",
        "icon": "calendar",
        "subtitle": "ยื่นเองได้ ทำตามนี้",
        "text": "ขั้นตอนการยื่น",
        "color": (0xD8, 0x5A, 0x30),
    },
    {
        "title": "แหล่งข้อมูลภาษี",
        "icon": "monitor",
        "subtitle": "อ่านต้นฉบับจากสรรพากร",
        "text": "แหล่งข้อมูลกฎหมายภาษี",
        "color": (0xBA, 0x75, 0x17),
    },
    {
        "title": "รายงาน และ ติดต่อ",
        "icon": "phone",
        "subtitle": "แจ้งปัญหา คุยกับเจ้าหน้าที่",
        "text": "รายงานปัญหา",
        "color": (0x5F, 0x5E, 0x5A),
    },
]




# ---- ไอคอนแต่ละปุ่ม วาดด้วยเส้นหนาเท่ากัน ไม่ต้องพึ่งไฟล์ไอคอนภายนอก ----


def _icon_calculator(d, cx, cy, r, color, w):
    """เครื่องคิดเลข สื่อถึงการคำนวณภาษี"""
    d.rounded_rectangle([cx - r * 0.62, cy - r, cx + r * 0.62, cy + r], radius=r * 0.16,
                        outline=color, width=w)
    d.rounded_rectangle([cx - r * 0.42, cy - r * 0.78, cx + r * 0.42, cy - r * 0.38],
                        radius=r * 0.06, outline=color, width=w)
    for row in range(3):
        for col in range(3):
            x = cx - r * 0.34 + col * r * 0.34
            y = cy - r * 0.08 + row * r * 0.32
            d.ellipse([x - r * 0.08, y - r * 0.08, x + r * 0.08, y + r * 0.08], fill=color)


def _icon_receipt(d, cx, cy, r, color, w):
    """ใบเสร็จขอบหยักพร้อมสัญลักษณ์บาท สื่อถึงค่าลดหย่อน"""
    top, bot = cy - r, cy + r * 0.72
    left, right = cx - r * 0.6, cx + r * 0.6
    zig = [(left, bot)]
    steps = 6
    for i in range(steps + 1):
        x = left + (right - left) * i / steps
        zig.append((x, bot + (r * 0.16 if i % 2 else 0)))
    d.line([(left, bot), (left, top), (right, top), (right, bot)], fill=color, width=w, joint="curve")
    d.line(zig, fill=color, width=w, joint="curve")
    d.line([(cx - r * 0.22, cy - r * 0.52), (cx + r * 0.22, cy - r * 0.52)], fill=color, width=w)
    d.line([(cx - r * 0.22, cy - r * 0.18), (cx + r * 0.22, cy - r * 0.18)], fill=color, width=w)
    d.line([(cx - r * 0.22, cy + r * 0.16), (cx + r * 0.05, cy + r * 0.16)], fill=color, width=w)


def _icon_calendar(d, cx, cy, r, color, w):
    """ปฏิทินพร้อมเครื่องหมายถูก สื่อถึงกำหนดเวลายื่นภาษี"""
    d.rounded_rectangle([cx - r * 0.72, cy - r * 0.72, cx + r * 0.72, cy + r * 0.78],
                        radius=r * 0.12, outline=color, width=w)
    d.line([(cx - r * 0.72, cy - r * 0.3), (cx + r * 0.72, cy - r * 0.3)], fill=color, width=w)
    for x in (cx - r * 0.36, cx + r * 0.36):
        d.line([(x, cy - r), (x, cy - r * 0.56)], fill=color, width=w)
    d.line([(cx - r * 0.32, cy + r * 0.22), (cx - r * 0.06, cy + r * 0.46),
            (cx + r * 0.38, cy - r * 0.04)], fill=color, width=int(w * 1.2), joint="curve")


def _icon_alarm(d, cx, cy, r, color, w):
    """นาฬิกาปลุก สื่อถึงการยื่นล่าช้าและค่าปรับ"""
    d.ellipse([cx - r * 0.72, cy - r * 0.62, cx + r * 0.72, cy + r * 0.82], outline=color, width=w)
    d.line([(cx - r * 0.86, cy - r * 0.62), (cx - r * 0.5, cy - r * 0.94)], fill=color, width=w)
    d.line([(cx + r * 0.86, cy - r * 0.62), (cx + r * 0.5, cy - r * 0.94)], fill=color, width=w)
    d.line([(cx, cy + r * 0.1), (cx, cy - r * 0.24)], fill=color, width=w)
    d.line([(cx, cy + r * 0.1), (cx + r * 0.3, cy + r * 0.1)], fill=color, width=w)


def _icon_monitor(d, cx, cy, r, color, w):
    """จอภาพพร้อมลูกศรส่งขึ้น สื่อถึงการยื่นภาษีออนไลน์"""
    d.rounded_rectangle([cx - r * 0.82, cy - r * 0.78, cx + r * 0.82, cy + r * 0.32],
                        radius=r * 0.1, outline=color, width=w)
    d.line([(cx, cy + r * 0.32), (cx, cy + r * 0.62)], fill=color, width=w)
    d.line([(cx - r * 0.4, cy + r * 0.72), (cx + r * 0.4, cy + r * 0.72)], fill=color, width=w)
    d.line([(cx, cy + r * 0.06), (cx, cy - r * 0.5)], fill=color, width=w)
    d.line([(cx - r * 0.22, cy - r * 0.28), (cx, cy - r * 0.52),
            (cx + r * 0.22, cy - r * 0.28)], fill=color, width=w, joint="curve")


def _icon_phone(d, cx, cy, r, color, w):
    """หูฟังคอลเซ็นเตอร์ สื่อถึงช่องทางติดต่อกรมสรรพากร"""
    d.arc([cx - r * 0.8, cy - r * 0.86, cx + r * 0.8, cy + r * 0.5], 180, 360, fill=color, width=w)
    d.rounded_rectangle([cx - r * 0.86, cy - r * 0.2, cx - r * 0.5, cy + r * 0.46],
                        radius=r * 0.16, outline=color, width=w)
    d.rounded_rectangle([cx + r * 0.5, cy - r * 0.2, cx + r * 0.86, cy + r * 0.46],
                        radius=r * 0.16, outline=color, width=w)
    d.arc([cx + r * 0.1, cy + r * 0.16, cx + r * 0.78, cy + r * 0.84], 0, 90, fill=color, width=w)
    d.line([(cx + r * 0.44, cy + r * 0.84), (cx + r * 0.1, cy + r * 0.84)], fill=color, width=w)


def _icon_question(d, cx, cy, r, color, w):
    """เครื่องหมายคำถามในวงกลม สื่อถึงรายการคำถามที่พบบ่อย"""
    d.ellipse([cx - r, cy - r, cx + r, cy + r], outline=color, width=w)
    # ส่วนโค้งด้านบน
    d.arc([cx - r * 0.42, cy - r * 0.60, cx + r * 0.42, cy - r * 0.02],
          start=170, end=360, fill=color, width=w)
    # ขาที่ลากลงจากปลายส่วนโค้ง
    d.line([cx + r * 0.02, cy - r * 0.06, cx + r * 0.02, cy + r * 0.22], fill=color, width=w)
    # จุดด้านล่าง
    d.ellipse([cx - r * 0.08, cy + r * 0.40, cx + r * 0.12, cy + r * 0.60], fill=color)


ICONS = {
    "calculator": _icon_calculator,
    "question": _icon_question,
    "receipt": _icon_receipt,
    "calendar": _icon_calendar,
    "alarm": _icon_alarm,
    "monitor": _icon_monitor,
    "phone": _icon_phone,
}


def load_token() -> str:
    """อ่าน LINE_CHANNEL_ACCESS_TOKEN จากไฟล์ .env"""
    env = ROOT / ".env"
    if not env.exists():
        sys.exit("ไม่พบไฟล์ .env")
    for line in env.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("LINE_CHANNEL_ACCESS_TOKEN="):
            token = line.split("=", 1)[1].strip().strip('"').strip("'")
            if token and not token.startswith("your_"):
                return token
    sys.exit("ไม่พบค่า LINE_CHANNEL_ACCESS_TOKEN ในไฟล์ .env")


def find_thai_font(size: int):
    """หาฟอนต์ภาษาไทยตามลำดับในรายการ ไม่เจอคืน None (ผู้เรียกจะเตือนแล้วใช้ฟอนต์เริ่มต้น)"""
    candidates = [
        "C:/Windows/Fonts/LeelaUIb.ttf",     # Leelawadee UI Bold
        "C:/Windows/Fonts/LeelawUI.ttf",     # Leelawadee UI
        "C:/Windows/Fonts/tahomabd.ttf",     # Tahoma Bold
        "C:/Windows/Fonts/tahoma.ttf",
        "C:/Windows/Fonts/upcdb.TTF",
        "/usr/share/fonts/truetype/tlwg/Garuda-Bold.ttf",
        "/usr/share/fonts/truetype/noto/NotoSansThai-Bold.ttf",
    ]
    for path in candidates:
        if Path(path).exists():
            try:
                return ImageFont.truetype(path, size)
            except Exception:
                continue
    return None


def draw_image() -> Path:
    """วาดรูป Rich Menu 6 ปุ่ม"""
    img = Image.new("RGB", (W, H), (0xFA, 0xFA, 0xF8))
    d = ImageDraw.Draw(img)

    f_title = find_thai_font(88)
    f_sub = find_thai_font(46)
    if f_title is None:
        print("  คำเตือน: ไม่พบฟอนต์ภาษาไทย รูปที่ได้จะแสดงตัวอักษรไม่ถูกต้อง")
        f_title = ImageFont.load_default()
        f_sub = ImageFont.load_default()

    for i, btn in enumerate(BUTTONS):
        col, row = i % COLS, i // COLS
        x0, y0 = col * CW, row * CH
        x1, y1 = x0 + CW, y0 + CH

        # พื้นช่องเป็นสีอ่อนของสีประจำปุ่ม
        r, g, b = btn["color"]
        light = (int(r + (255 - r) * 0.88), int(g + (255 - g) * 0.88), int(b + (255 - b) * 0.88))
        d.rectangle([x0 + 12, y0 + 12, x1 - 12, y1 - 12], fill=light)

        # แถบสีเข้มด้านบนช่อง ใช้แยกปุ่มออกจากกัน
        d.rectangle([x0 + 12, y0 + 12, x1 - 12, y0 + 28], fill=btn["color"])

        cx = x0 + CW // 2
        # ข้อความใช้โทนเข้มของสีเดียวกันแทนสีดำ
        dark = (int(r * 0.55), int(g * 0.55), int(b * 0.55))
        mid = (int(r * 0.72), int(g * 0.72), int(b * 0.72))

        # ไอคอนอยู่บน ข้อความอยู่ล่าง
        ICONS[btn["icon"]](d, cx, y0 + CH * 0.34, ICON_R, dark, ICON_W)

        tw = d.textlength(btn["title"], font=f_title)
        d.text((cx - tw / 2, y0 + CH * 0.58), btn["title"], font=f_title, fill=dark)

        sw = d.textlength(btn["subtitle"], font=f_sub)
        d.text((cx - sw / 2, y0 + CH * 0.76), btn["subtitle"], font=f_sub, fill=mid)

    img.save(IMG_PATH, "PNG", optimize=True)
    size_kb = IMG_PATH.stat().st_size / 1024
    print(f"  วาดรูปเสร็จ: {IMG_PATH}  ({size_kb:.0f} KB)")
    if size_kb > 1024:
        print("  คำเตือน: LINE จำกัดขนาดรูปไว้ที่ 1 MB")
    return IMG_PATH


def resolve_image() -> Path:
    """
    เลือกรูปที่จะอัปโหลด: รูปที่ออกแบบเองถ้ามี ไม่งั้นวาดรูปสำรอง
    ตรวจขนาดก่อนส่ง เพราะ LINE ปฏิเสธรูปที่ไม่ตรงกับ size ของเมนูด้วยข้อความที่อ่านยาก
    """
    custom = find_custom_image()
    if custom is not None:
        with Image.open(custom) as im:
            w, h = im.size
        if (w, h) != (W, H):
            sys.exit(
                f"รูปที่ออกแบบเองขนาดไม่ถูกต้อง\n"
                f"  ไฟล์: {custom}\n"
                f"  ขนาดที่พบ: {w} x {h}\n"
                f"  ขนาดที่ LINE ต้องการ: {W} x {H}\n"
                f"  วิธีแก้: ส่งออกจากโปรแกรมออกแบบใหม่ให้ได้ {W} x {H} พิกเซล"
            )
        size_kb = custom.stat().st_size / 1024
        if size_kb > 1024:
            sys.exit(f"รูปใหญ่เกินไป {size_kb:.0f} KB LINE จำกัดไว้ที่ 1 MB")
        print(f"  ใช้รูปที่ออกแบบเอง: {custom.name}  ({size_kb:.0f} KB)")
        return custom

    print("  ไม่พบรูปที่ออกแบบเอง จึงวาดรูปสำรองจากโค้ดแทน")
    print(f"  ถ้าต้องการใช้รูปของตัวเอง ให้วางไว้ที่ {CUSTOM_IMG_PATH}")
    return draw_image()


def build_menu_object() -> dict:
    """สร้างโครงสร้าง Rich Menu ตามรูปแบบที่ LINE กำหนด"""
    areas = []
    for i, btn in enumerate(BUTTONS):
        col, row = i % COLS, i // COLS
        x, y = col * CW, row * CH
        # ช่องริมขวา/ล่างยืดถึงขอบรูป เพราะ 2500 หาร 3 ไม่ลงตัว ไม่งั้นเหลือแถบที่กดไม่ติด
        width = (W - x) if col == COLS - 1 else CW
        height = (H - y) if row == ROWS - 1 else CH
        areas.append(
            {
                "bounds": {"x": x, "y": y, "width": width, "height": height},
                # action แบบ message ส่งข้อความเข้า webhook เหมือนผู้ใช้พิมพ์เอง
                "action": {"type": "message", "text": btn["text"]},
            }
        )
    return {
        "size": {"width": W, "height": H},
        "selected": True,
        "name": "คุณภาษี - เมนูหลัก",
        "chatBarText": "เมนูช่วยเหลือ",
        "areas": areas,
    }


def api(method: str, path: str, token: str, **kw):
    url = "https://api.line.me" + path
    headers = kw.pop("headers", {})
    headers["Authorization"] = f"Bearer {token}"
    r = requests.request(method, url, headers=headers, timeout=60, **kw)
    if not r.ok:
        sys.exit(f"เรียก LINE API ไม่สำเร็จ {r.status_code}\n{r.text}")
    return r


def main():
    args = sys.argv[1:]
    print("=" * 70)
    print("  ติดตั้ง Rich Menu ให้ LINE OA ระบบที่ปรึกษาภาษี")
    print("=" * 70)

    if "--image-only" in args:
        draw_image()
        print("\n  โหมดวาดรูปอย่างเดียว ไม่ได้ติดต่อ LINE")
        print(f"  เปิดดูรูปได้ที่ {IMG_PATH}")
        return

    img_path = resolve_image()
    token = load_token()

    if "--list" in args:
        data = api("GET", "/v2/bot/richmenu/list", token).json()
        menus = data.get("richmenus", [])
        print(f"\n  มีเมนูอยู่ {len(menus)} รายการ")
        for m in menus:
            print(f"    {m['richMenuId']}  {m.get('name')}")
        return

    if "--clean" in args:
        data = api("GET", "/v2/bot/richmenu/list", token).json()
        for m in data.get("richmenus", []):
            api("DELETE", f"/v2/bot/richmenu/{m['richMenuId']}", token)
            print(f"  ลบเมนูเดิม {m['richMenuId']}")

    print("\n  สร้างเมนูใหม่")
    menu = build_menu_object()
    res = api(
        "POST",
        "/v2/bot/richmenu",
        token,
        headers={"Content-Type": "application/json"},
        data=json.dumps(menu, ensure_ascii=False).encode("utf-8"),
    ).json()
    menu_id = res["richMenuId"]
    print(f"    รหัสเมนู {menu_id}")

    print(f"  อัปโหลดรูป {img_path.name}")
    with open(img_path, "rb") as f:
        requests.post(
            f"https://api-data.line.me/v2/bot/richmenu/{menu_id}/content",
            headers={"Authorization": f"Bearer {token}", "Content-Type": "image/png"},
            data=f.read(),
            timeout=120,
        ).raise_for_status()

    print("  ตั้งเป็นเมนูเริ่มต้นของผู้ใช้ทุกคน")
    api("POST", f"/v2/bot/user/all/richmenu/{menu_id}", token)

    print("\n  ติดตั้งสำเร็จ")
    print("  เปิดแชท LINE ของบอทแล้วดูแถบเมนูด้านล่าง")
    print("  ถ้ายังไม่ขึ้น ให้ปิดหน้าแชทแล้วเปิดใหม่ หรือรอสักครู่")


if __name__ == "__main__":
    main()
