'use strict';
/**
 * โครงหน้าเว็บ (CSS, เมนู, หน้าล็อกอิน) และตัวช่วยแสดงผลของหน้าหลังบ้าน
 * สร้าง HTML ฝั่งเซิร์ฟเวอร์ทั้งหมด ไม่ใช้ framework
 */

/** escape อักขระพิเศษ HTML ต้องใช้กับทุกค่าที่มาจากฐานข้อมูลหรือฟอร์ม */
function esc(v) {
  return String(v === null || v === undefined ? '' : v)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** ใส่เครื่องหมายคั่นหลักพันให้ตัวเลขอ่านง่าย */
function เลข(v) {
  if (v === null || v === undefined || v === '') return '-';
  return Number(v).toLocaleString('th-TH');
}

// ---- จัดรูปแบบวันที่ ----
// pg คืน date/timestamp เป็น Date ไม่ใช่ข้อความ ห้ามจัดรูปแบบด้วย String() แล้วตัด
// ให้ทุกหน้าใช้ฟังก์ชันในส่วนนี้
const ชื่อเดือนสั้น = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
                      'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];

/** แปลงค่าที่ได้จากฐานข้อมูลให้เป็น Date ถ้าแปลงไม่ได้คืน null */
function เป็นวันที่(v) {
  if (v instanceof Date && !isNaN(v)) return v;
  if (typeof v === 'string') {
    // รูปแบบรายเดือน 2026-09 ต้องเติมวันที่ก่อน ไม่งั้นบางเบราว์เซอร์อ่านไม่ออก
    const s = /^\d{4}-\d{2}$/.test(v) ? v + '-01' : v;
    const d = new Date(s);
    if (!isNaN(d)) return d;
  }
  return null;
}

/**
 * ป้ายวันที่แบบสั้นสำหรับแกนนอนของกราฟ
 * @param {*} v ค่าจากฐานข้อมูล
 * @param {'วัน'|'เดือน'|'ปี'} ช่วง
 */
function วันที่สั้น(v, ช่วง = 'วัน') {
  const d = เป็นวันที่(v);
  if (!d) return String(v === null || v === undefined ? '' : v);
  const พศ = d.getFullYear() + 543;
  if (ช่วง === 'ปี') return String(พศ);
  if (ช่วง === 'เดือน') return `${ชื่อเดือนสั้น[d.getMonth()]} ${String(พศ).slice(2)}`;
  return `${d.getDate()} ${ชื่อเดือนสั้น[d.getMonth()]}`;
}

/** ป้ายวันที่แบบเต็ม ใช้ในตารางและป้ายลอย */
function วันที่เต็ม(v, ช่วง = 'วัน') {
  const d = เป็นวันที่(v);
  if (!d) return String(v === null || v === undefined ? '' : v);
  const พศ = d.getFullYear() + 543;
  if (ช่วง === 'ปี') return String(พศ);
  if (ช่วง === 'เดือน') return `${ชื่อเดือนสั้น[d.getMonth()]} ${พศ}`;
  return `${d.getDate()} ${ชื่อเดือนสั้น[d.getMonth()]} ${พศ}`;
}


// ---- CSS ของทุกหน้า ----
// สีเน้นมีสีเดียว (น้ำตาล) แถบเมนูด้านข้างสีเข้ม จอแคบยุบเป็นแถบบน
// สีตัวอักษรผ่านเกณฑ์คอนทราสต์ WCAG 4.5:1 บนพื้นขาว
const CSS = `
:root{
  --พื้น:#f6f3ef; --การ์ด:#ffffff; --พื้นรอง:#faf8f5;
  --เส้น:#ece5dc; --เส้นเข้ม:#dcd2c5;
  --หมึก:#1a1614; --หมึกรอง:#5c544e; --หมึกจาง:#746a63;
  --เน้น:#7b4b2a; --เน้นเข้ม:#5e3920; --เน้นอ่อน:#f4ebe3; --เน้นจาง:#faf5f0;
  --ข้าง:#1b1613; --ข้างรอง:#2a221e; --ข้างเส้น:#352b26; --ข้างหมึก:#b8aca2; --ข้างเน้น:#d9a97c;
  --ดี:#2f6b3c; --ดีอ่อน:#eef6f0; --เตือน:#8a5a12; --เตือนอ่อน:#fbf4e8;
  --อันตราย:#992f25; --อันตรายอ่อน:#fbefed;
  --มุม:14px; --มุมเล็ก:9px;
  --เงา:0 1px 2px rgba(26,22,20,.05),0 0 0 1px rgba(26,22,20,.02);
  --เงาลอย:0 10px 30px -10px rgba(26,22,20,.25),0 2px 6px rgba(26,22,20,.08);
  --ฟอนต์:"IBM Plex Sans Thai","Noto Sans Thai","Leelawadee UI","Sarabun","Segoe UI",system-ui,sans-serif;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;font-family:var(--ฟอนต์);font-size:15px;line-height:1.6;color:var(--หมึก);
  background:var(--พื้น);-webkit-font-smoothing:antialiased}
a{color:var(--เน้น)}
a:hover{color:var(--เน้นเข้ม)}
:focus-visible{outline:2px solid var(--เน้น);outline-offset:2px;border-radius:6px}

/* ---------------------------------------------------------------------------
   โครงหน้า แถบข้างกว้างคงที่ เนื้อหายืดตามจอ แต่ไม่เกิน 1180px เพื่อให้อ่านสบาย
   --------------------------------------------------------------------------- */
.โครง{display:grid;grid-template-columns:248px minmax(0,1fr);min-height:100vh}
.แถบข้าง{background:var(--ข้าง);color:var(--ข้างหมึก);padding:22px 14px;
  position:sticky;top:0;height:100vh;display:flex;flex-direction:column;gap:26px}
.แบรนด์{display:flex;gap:12px;align-items:center;text-decoration:none;color:#fff;padding:0 8px}
.แบรนด์:hover{color:#fff}
.โลโก้{width:42px;height:42px;border-radius:50%;flex:none;display:block;background:#fff;
  box-shadow:0 0 0 2px rgba(255,255,255,.08)}
.ซ้าย .โลโก้{width:52px;height:52px}
.แบรนด์ b{display:block;font-size:16px;line-height:1.25;letter-spacing:-.01em}
.แบรนด์ small{display:block;font-size:12px;color:var(--ข้างหมึก);font-weight:400}
.เมนู{display:flex;flex-direction:column;gap:2px}
/* ห้ามใส่ letter-spacing กับข้อความไทย สระและวรรณยุกต์จะหลุดออกจากพยัญชนะจนอ่านไม่ออก */
.เมนู .หัวกลุ่ม{font-size:12px;color:#93857c;padding:0 12px 6px;font-weight:600}
.เมนู a{display:flex;align-items:center;gap:11px;padding:9px 12px;border-radius:10px;
  color:var(--ข้างหมึก);text-decoration:none;font-size:14.5px;position:relative;
  transition:background .12s,color .12s}
.เมนู .ชื่อสั้น{display:none}
.เมนู a svg{width:18px;height:18px;flex:none;opacity:.85}
.เมนู a:hover{background:var(--ข้างรอง);color:#fff}
.เมนู a.active{background:var(--ข้างรอง);color:#fff;font-weight:600}
.เมนู a.active::before{content:"";position:absolute;left:-14px;top:9px;bottom:9px;width:3px;
  border-radius:0 3px 3px 0;background:var(--ข้างเน้น)}
.เมนู a.active svg{color:var(--ข้างเน้น);opacity:1}
.ล่างแถบ{margin-top:auto;display:flex;flex-direction:column;gap:12px}
.ป้ายส่วนตัว{display:flex;gap:9px;font-size:12px;line-height:1.55;color:#9a8d84;
  border:1px solid var(--ข้างเส้น);border-radius:10px;padding:10px 11px}
.ป้ายส่วนตัว svg{width:16px;height:16px;flex:none;color:var(--ข้างเน้น);margin-top:1px}
.ออก{display:flex;align-items:center;gap:10px;color:var(--ข้างหมึก);text-decoration:none;
  font-size:14px;padding:8px 12px;border-radius:10px}
.ออก svg{width:17px;height:17px}
.ออก:hover{background:var(--ข้างรอง);color:#fff}

/* เนื้อหาขยายตามจอ จอใหญ่ไม่เหลือที่ว่างด้านขวา แต่หยุดที่ 1720 พิกเซลเพื่อไม่ให้บรรทัดยาวจนอ่านยาก */
main{padding:clamp(22px,2.2vw,38px) clamp(16px,2.6vw,48px) 72px;max-width:1720px;width:100%}

/* หัวหน้า ชื่อหน้า คำอธิบาย และปุ่มหลักของหน้าอยู่ด้านขวา */
.หัวหน้า{display:flex;gap:20px;align-items:flex-end;justify-content:space-between;
  flex-wrap:wrap;margin-bottom:24px}
.หัวหน้า .ป้ายบน{font-size:12.5px;color:var(--หมึกจาง);font-weight:500;margin-bottom:2px}
h1{font-size:26px;line-height:1.3;font-weight:700;margin:0;letter-spacing:-.02em}
.คำอธิบาย{color:var(--หมึกรอง);font-size:14.5px;margin:6px 0 0;max-width:68ch}
h2{font-size:16px;font-weight:650;margin:0;letter-spacing:-.005em}
h3{font-size:14px;font-weight:600;margin:0 0 10px;color:var(--หมึกรอง)}
.หัวส่วน{display:flex;align-items:baseline;justify-content:space-between;gap:12px;
  flex-wrap:wrap;margin:34px 0 12px}

/* ---------------------------------------------------------------------------
   การ์ด
   --------------------------------------------------------------------------- */
.การ์ด{background:var(--การ์ด);border:1px solid var(--เส้น);border-radius:var(--มุม);
  padding:22px 24px;margin-bottom:16px;box-shadow:var(--เงา)}
.หัวการ์ด{display:flex;align-items:flex-start;justify-content:space-between;gap:14px;
  flex-wrap:wrap;margin-bottom:18px}
.หัวการ์ด .รอง{color:var(--หมึกจาง);font-size:13px;margin-top:2px}
.การ์ด.ชิดขอบ{padding:0;overflow:hidden}
.การ์ด.ชิดขอบ .หัวการ์ด{padding:20px 24px 0}
.ตารางเลื่อน{overflow:auto;max-height:clamp(360px,68vh,820px)}

/* ชุดตัวเลขสรุป */
.ตัวเลขชุด{display:grid;grid-template-columns:repeat(auto-fit,minmax(210px,1fr));gap:14px;margin-bottom:16px}
.ตัวเลข{background:var(--การ์ด);border:1px solid var(--เส้น);border-radius:var(--มุม);
  padding:18px 20px 16px;box-shadow:var(--เงา);display:flex;flex-direction:column;gap:2px;min-width:0}
.ตัวเลข .ป้าย{color:var(--หมึกรอง);font-size:13.5px;font-weight:500;display:flex;align-items:center;gap:8px}
.ตัวเลข .ป้าย svg{width:16px;height:16px;color:var(--เน้น)}
.ตัวเลข .ค่า{font-size:31px;font-weight:700;line-height:1.2;letter-spacing:-.025em;margin-top:6px}
.ตัวเลข .ค่า small{font-size:15px;font-weight:500;color:var(--หมึกรอง);letter-spacing:0;margin-left:4px}
.ตัวเลข .ท้าย{color:var(--หมึกจาง);font-size:12.5px;margin-top:4px}
.ตัวเลข.เด่น{background:linear-gradient(160deg,#2a1f1a,#1b1613);border-color:#1b1613;color:#fff}
.ตัวเลข.เด่น .ป้าย{color:#cdbfb4}
.ตัวเลข.เด่น .ป้าย svg{color:var(--ข้างเน้น)}
.ตัวเลข.เด่น .ท้าย{color:#a99a8f}
.ตัวเลข.เด่น .ค่า small{color:#cdbfb4}
.ส่วนต่าง{display:inline-flex;align-items:center;gap:4px;font-size:12.5px;font-weight:600;
  padding:1px 8px;border-radius:20px;margin-right:6px;background:var(--พื้นรอง);color:var(--หมึกรอง)}
.ส่วนต่าง.ขึ้น{background:var(--ดีอ่อน);color:var(--ดี)}
.ส่วนต่าง.ลง{background:var(--อันตรายอ่อน);color:var(--อันตราย)}
.ตัวเลข.เด่น .ส่วนต่าง{background:rgba(255,255,255,.1);color:#fff}
.มาตร{height:6px;border-radius:6px;background:var(--เน้นอ่อน);overflow:hidden;margin-top:10px}
.มาตร>i{display:block;height:100%;border-radius:6px;background:var(--เน้น)}

/* ---------------------------------------------------------------------------
   แถบตัวกรอง ปุ่มแบบแบ่งส่วน
   --------------------------------------------------------------------------- */
.แถบตัวกรอง{display:flex;flex-wrap:wrap;align-items:center;gap:10px 18px;
  background:var(--การ์ด);border:1px solid var(--เส้น);border-radius:var(--มุม);
  padding:12px 14px;margin-bottom:16px;box-shadow:var(--เงา)}
.ตัวกรอง{display:flex;align-items:center;gap:9px}
.ตัวกรอง>span{font-size:12.5px;color:var(--หมึกจาง);font-weight:500;white-space:nowrap}
.กลุ่มเลือก{display:inline-flex;background:var(--พื้น);border-radius:10px;padding:3px;gap:2px;
  border:1px solid var(--เส้น)}
.กลุ่มเลือก a{font-size:13.5px;padding:5px 12px;border-radius:8px;text-decoration:none;
  color:var(--หมึกรอง);white-space:nowrap;transition:background .12s,color .12s}
.กลุ่มเลือก a:hover{color:var(--หมึก);background:rgba(255,255,255,.7)}
.กลุ่มเลือก a.เลือกอยู่{background:var(--การ์ด);color:var(--หมึก);font-weight:600;
  box-shadow:0 1px 2px rgba(26,22,20,.12),0 0 0 1px rgba(26,22,20,.04)}
.ช่วงวันที่{margin-left:auto;display:flex;align-items:center;gap:8px;font-size:13px;
  color:var(--หมึกรอง);white-space:nowrap}
.ช่วงวันที่ svg{width:16px;height:16px;color:var(--หมึกจาง)}

/* ---------------------------------------------------------------------------
   ตาราง
   --------------------------------------------------------------------------- */
table{width:100%;border-collapse:separate;border-spacing:0;font-size:14px}
th,td{text-align:left;padding:11px 14px;border-bottom:1px solid var(--เส้น);vertical-align:middle}
thead th{position:sticky;top:0;z-index:1;background:var(--พื้นรอง);color:var(--หมึกรอง);
  font-weight:600;font-size:12.5px;white-space:nowrap;border-bottom:1px solid var(--เส้นเข้ม)}
.การ์ด:not(.ชิดขอบ) thead th{background:var(--การ์ด)}
tbody tr:last-child td{border-bottom:0}
tbody tr{transition:background .1s}
tbody tr:hover{background:var(--เน้นจาง)}
td.เลข,th.เลข{text-align:right;font-variant-numeric:tabular-nums}
tr.ศูนย์ td{color:var(--หมึกจาง)}
td a{color:var(--หมึก);text-decoration:none;font-weight:500}
td a:hover{color:var(--เน้น);text-decoration:underline;text-underline-offset:3px}
th a.หัวเรียง{color:inherit;text-decoration:none;display:inline-flex;align-items:center;gap:4px}
th a.หัวเรียง:hover{color:var(--หมึก)}
th a.หัวเรียง.กำลังเรียง{color:var(--เน้น)}
.ว่าง{color:var(--หมึกจาง);padding:44px 16px;text-align:center;font-size:14px}
.ว่าง .ไอคอนว่าง{width:44px;height:44px;margin:0 auto 10px;border-radius:12px;display:grid;
  place-items:center;background:var(--เน้นอ่อน);color:var(--เน้น)}
.ว่าง .ไอคอนว่าง svg{width:22px;height:22px}

/* ---------------------------------------------------------------------------
   ฟอร์มและปุ่ม
   --------------------------------------------------------------------------- */
input,select,textarea{width:100%;padding:9px 12px;border:1px solid var(--เส้นเข้ม);
  border-radius:var(--มุมเล็ก);font-family:inherit;font-size:14.5px;background:#fff;color:inherit;
  transition:border-color .12s,box-shadow .12s}
input:hover,select:hover,textarea:hover{border-color:#c9bcad}
input:focus,select:focus,textarea:focus{outline:none;border-color:var(--เน้น);
  box-shadow:0 0 0 3px rgba(123,75,42,.15)}
textarea{min-height:220px;resize:vertical;line-height:1.75}
label{display:block;margin-bottom:18px}
label .ชื่อช่อง,.ชื่อช่อง{display:block;font-weight:600;font-size:14px;margin-bottom:3px}
label .ช่วย,.ช่วย{display:block;color:var(--หมึกรอง);font-size:13px;margin-bottom:7px;line-height:1.6}
button,.ปุ่ม{display:inline-flex;align-items:center;justify-content:center;gap:7px;
  background:var(--เน้น);color:#fff;border:1px solid var(--เน้น);border-radius:var(--มุมเล็ก);
  padding:9px 16px;font-family:inherit;font-size:14px;font-weight:600;cursor:pointer;
  text-decoration:none;line-height:1.4;transition:background .12s,border-color .12s,box-shadow .12s}
button:hover,.ปุ่ม:hover{background:var(--เน้นเข้ม);border-color:var(--เน้นเข้ม);color:#fff}
button svg,.ปุ่ม svg{width:16px;height:16px}
button.รอง,.ปุ่ม.รอง{background:#fff;color:var(--หมึก);border-color:var(--เส้นเข้ม);font-weight:500}
button.รอง:hover,.ปุ่ม.รอง:hover{background:var(--พื้นรอง);color:var(--หมึก);border-color:#c9bcad}
button.อันตราย{background:#fff;color:var(--อันตราย);border-color:#e7c4bf;font-weight:500}
button.อันตราย:hover{background:var(--อันตรายอ่อน);color:var(--อันตราย);border-color:var(--อันตราย)}
.แถวปุ่ม{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.แถวปุ่ม .ดันขวา{margin-left:auto}

.แจ้ง{display:flex;gap:11px;padding:13px 15px;border-radius:var(--มุมเล็ก);margin-bottom:16px;
  font-size:14px;border:1px solid}
.แจ้ง::before{content:"i";flex:none;width:20px;height:20px;border-radius:50%;display:grid;
  place-items:center;font-size:12px;font-weight:700;color:#fff;margin-top:1px}
.แจ้ง.ดี{background:var(--ดีอ่อน);color:var(--ดี);border-color:#cfe3d4}
.แจ้ง.ดี::before{content:"✓";background:var(--ดี)}
.แจ้ง.เตือน{background:var(--เตือนอ่อน);color:var(--เตือน);border-color:#efdcba}
.แจ้ง.เตือน::before{content:"!";background:var(--เตือน)}
.แจ้ง.ผิด{background:var(--อันตรายอ่อน);color:var(--อันตราย);border-color:#efcdc8}
.แจ้ง.ผิด::before{content:"×";background:var(--อันตราย)}
.แจ้ง.สำคัญ{background:var(--อันตรายอ่อน);color:var(--อันตราย);border-color:#efcdc8}
.แจ้ง.สำคัญ::before{content:"!";background:var(--อันตราย)}

.ป้ายเล็ก{display:inline-flex;white-space:nowrap;align-items:center;gap:5px;padding:2px 10px;border-radius:20px;
  font-size:12.5px;font-weight:500;background:var(--พื้นรอง);border:1px solid var(--เส้น);
  color:var(--หมึกรอง);white-space:nowrap;line-height:1.6}
.ป้ายเล็ก.คำนวณ{background:var(--เน้นอ่อน);border-color:#e6d3c2;color:var(--เน้นเข้ม)}
.ป้ายเล็ก.ยืนยันแล้ว{background:var(--ดีอ่อน);border-color:#cfe3d4;color:var(--ดี)}
.ป้ายเล็ก.ยืนยันแล้ว::before{content:"✓";font-weight:700}
/* สีสถานะ แดงคือยังต้องมีคนจัดการ เขียวคือเรียบร้อยแล้ว */
.ป้ายเล็ก.ยังไม่ยืนยัน{background:var(--อันตรายอ่อน);border-color:#efcdc8;color:var(--อันตราย)}
.ป้ายเล็ก.ยังไม่ยืนยัน::before{content:"";width:6px;height:6px;border-radius:50%;background:currentColor}
.ป้ายเล็ก.สถานะ-open{background:var(--อันตรายอ่อน);border-color:#efcdc8;color:var(--อันตราย)}
.ป้ายเล็ก.สถานะ-done{background:var(--ดีอ่อน);border-color:#cfe3d4;color:var(--ดี)}
form.ป้ายฟอร์ม{display:inline;margin:0}
button.ป้ายเล็ก{cursor:pointer;font-family:inherit;transition:filter .1s,box-shadow .1s}
button.ป้ายเล็ก:hover{filter:brightness(.97);box-shadow:0 0 0 2px rgba(123,75,42,.12)}
.ว่างในตาราง{color:var(--เส้นเข้ม)}
.เตือนยาว{display:inline-grid;place-items:center;width:18px;height:18px;border-radius:50%;
  background:var(--อันตรายอ่อน);color:var(--อันตราย);font-size:11.5px;font-weight:700;cursor:help;
  margin-left:4px;vertical-align:1px}
.แท่ง{height:7px;background:var(--เน้นอ่อน);border-radius:7px;overflow:hidden;min-width:70px}
.แท่ง>i{display:block;height:100%;background:var(--เน้น);border-radius:7px}
.บันทึกท้าย{color:var(--หมึกจาง);font-size:13px;margin:14px 0 0;line-height:1.75}
.การ์ด.ชิดขอบ>.บันทึกท้าย{padding:0 24px 18px}

fieldset.ช่องเลือก{border:0;padding:0;margin:0 0 6px}
fieldset.ช่องเลือก legend{padding:0}
label.ตัวเลือก{display:flex;gap:11px;align-items:flex-start;margin:0 0 9px;
  border:1px solid var(--เส้นเข้ม);border-radius:var(--มุมเล็ก);padding:12px 14px;cursor:pointer;
  transition:border-color .12s,background .12s}
label.ตัวเลือก:hover{background:var(--พื้นรอง)}
label.ตัวเลือก:has(input:checked){border-color:var(--เน้น);background:var(--เน้นจาง);
  box-shadow:0 0 0 1px var(--เน้น)}
label.ตัวเลือก input{width:auto;margin-top:5px;flex:none;accent-color:var(--เน้น)}
label.ตัวเลือก strong{display:block;font-size:14px}
label.ตัวเลือก em{display:block;color:var(--หมึกรอง);font-size:13px;font-style:normal}

.แถวกรอง{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.แถวกรอง .ช่องค้น{flex:2 1 240px;position:relative;margin:0;display:block}
.แถวกรอง input,.แถวกรอง select{height:42px;margin:0}
.แถวกรอง .ช่องค้น svg{position:absolute;left:11px;top:50%;width:17px;height:17px;
  transform:translateY(-50%);color:var(--หมึกจาง);pointer-events:none}
.แถวกรอง .ช่องค้น input{padding-left:36px}
.แถวกรอง select{flex:1 1 190px;width:auto}
.แถวกรอง button,.แถวกรอง .ปุ่ม{flex:none}

.สองคอลัมน์{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(340px,100%),1fr));gap:16px;align-items:stretch;margin-bottom:16px}
.สองคอลัมน์>.การ์ด{margin-bottom:0}
.ฟอร์มสองคอลัมน์{display:grid;grid-template-columns:minmax(0,1fr) clamp(320px,28%,440px);gap:16px;align-items:start}
.ฟอร์มสองคอลัมน์ .ข้าง{position:sticky;top:20px}
.แถวปุ่ม.กลาง{justify-content:center;margin-top:14px}
.สรุปผลค้น{padding:0 24px}
.สรุปผลค้น .แจ้ง{margin-bottom:6px}
.แถบบันทึก{display:flex;gap:10px;flex-wrap:wrap;align-items:center}

/* ---------------------------------------------------------------------------
   กราฟเส้น
   ---------------------------------------------------------------------------
   เส้น 2 จุด พื้นที่ใต้เส้นเป็นสีเดียวกันที่ความทึบราว 10 เปอร์เซ็นต์
   เส้นตารางบางหนึ่งจุดและจางกว่าทุกอย่าง เพราะเป็นแค่ไม้บรรทัด
   ป้ายตัวเลขใช้สีตัวอักษร ไม่ใช้สีของเส้น เพราะต้องอ่าน ไม่ใช่จับคู่สี
   จุดมีวงสีพื้นล้อมสองจุด จึงยังเห็นชัดเมื่อทับเส้น */
.กล่องกราฟ{position:relative}
svg.กราฟเส้น{width:100%;height:auto;display:block;overflow:visible;touch-action:pan-y}
svg.กราฟเส้น .พื้นที่ใต้เส้น{fill:var(--เน้น);opacity:.1}
svg.กราฟเส้น .เส้นกราฟ{fill:none;stroke:var(--เน้น);stroke-width:2;stroke-linejoin:round;stroke-linecap:round}
svg.กราฟเส้น .จุดกราฟ{fill:var(--เน้น);stroke:var(--การ์ด);stroke-width:2}
svg.กราฟเส้น .จุดกราฟ.ล่าสุด{r:5.5}
svg.กราฟเส้น .เส้นอ้างอิง{stroke:var(--เส้น);stroke-width:1;shape-rendering:crispEdges}
svg.กราฟเส้น .เส้นอ้างอิง.เส้นฐาน{stroke:var(--เส้นเข้ม)}
svg.กราฟเส้น .ป้ายแกน{fill:var(--หมึกจาง);font-size:12px;font-family:inherit;font-variant-numeric:tabular-nums}
svg.กราฟเส้น .ป้ายค่า{fill:var(--หมึกรอง);font-size:12.5px;font-weight:600;font-family:inherit;
  paint-order:stroke;stroke:var(--การ์ด);stroke-width:4px;stroke-linejoin:round}
svg.กราฟเส้น .ป้ายค่า.ล่าสุด{fill:var(--หมึก)}
svg.กราฟเส้น .เส้นชี้{stroke:var(--หมึกจาง);stroke-width:1;stroke-dasharray:none;opacity:0;
  pointer-events:none;shape-rendering:crispEdges}
svg.กราฟเส้น .จุดชี้{fill:var(--เน้น);stroke:var(--การ์ด);stroke-width:2.5;opacity:0;pointer-events:none}
svg.กราฟเส้น.กำลังชี้ .เส้นชี้,svg.กราฟเส้น.กำลังชี้ .จุดชี้{opacity:1}
svg.กราฟเส้น.กำลังชี้ .ป้ายค่า{opacity:.35}
.ป้ายลอย{position:absolute;z-index:5;pointer-events:none;background:var(--หมึก);color:#fff;
  border-radius:9px;padding:7px 11px 7px;font-size:12.5px;line-height:1.45;white-space:nowrap;
  box-shadow:var(--เงาลอย);transform:translate(-50%,calc(-100% - 12px))}
.ป้ายลอย strong{display:block;font-size:15px;font-weight:700;font-variant-numeric:tabular-nums}
.ป้ายลอย span{color:#cdbfb4}
.ป้ายลอย[hidden]{display:none}
.คำอธิบายกราฟ{display:flex;flex-wrap:wrap;gap:6px 18px;color:var(--หมึกจาง);font-size:12.5px;margin-top:10px}
.คำอธิบายกราฟ i{display:inline-block;width:14px;height:2px;background:var(--เน้น);border-radius:2px;
  vertical-align:middle;margin-right:6px}
.คำอธิบายกราฟ i.ช่อง{background:none;border-top:2px dotted var(--เส้นเข้ม);height:0}

/* กราฟแท่งแนวนอน แท่งหนาไม่เกิน 24 จุด ปลายมน ฐานตรง */
.กราฟ{display:grid;grid-template-columns:minmax(120px,max-content) minmax(0,1fr) minmax(48px,max-content);
  gap:12px 16px;align-items:center;font-size:14px}
.กราฟ .ชื่อแกน{color:var(--หมึกรอง);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:260px}
.กราฟ .แท่ง{height:14px;border-radius:0 5px 5px 0;background:transparent;min-width:0}
.กราฟ .แท่ง>i{border-radius:0 5px 5px 0;transition:width .3s}
.กราฟ .ค่าท้าย{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}

/* ---------------------------------------------------------------------------
   จอแคบ แถบข้างกลายเป็นแถบบน
   --------------------------------------------------------------------------- */
@media (max-width:900px){
  .โครง{grid-template-columns:minmax(0,1fr)}
  .แถบข้าง{position:sticky;top:0;z-index:20;height:auto;flex-direction:row;align-items:center;
    padding:10px 14px;gap:14px;min-width:0;overflow-x:auto}
  .แบรนด์ small,.เมนู .หัวกลุ่ม,.ป้ายส่วนตัว,.ออก span{display:none}
  .แบรนด์{padding:0}
  .โลโก้{width:34px;height:34px}
  .แบรนด์ b{font-size:14px;white-space:nowrap}
  .เมนู{flex-direction:row;gap:2px}
  .เมนู a{padding:7px 10px;white-space:nowrap;font-size:14px}
  .เมนู a.active::before{display:none}
  .ล่างแถบ{margin:0 0 0 auto}
  main{padding:22px 16px 56px}
  .ฟอร์มสองคอลัมน์{grid-template-columns:1fr}
  .ฟอร์มสองคอลัมน์ .ข้าง{position:static}
}
@media (max-width:600px){
  h1{font-size:22px}
  .การ์ด{padding:18px 16px}
  .การ์ด.ชิดขอบ .หัวการ์ด{padding:16px 16px 0}
  .ตัวเลข .ค่า{font-size:26px}
  /* ตัวเลขสรุปวางสองคอลัมน์ ตัวเด่นเต็มแถว ไม่ให้การ์ดสี่ใบกินจอสี่ช่วงนิ้ว */
  .ตัวเลขชุด{grid-template-columns:1fr 1fr;gap:10px}
  .ตัวเลขชุด .ตัวเลข.เด่น{grid-column:1/-1}
  .ตัวเลขชุด .ตัวเลข{padding:14px}
  .ตัวเลขชุด .ตัวเลข .ค่า{font-size:22px}
  .ตัวเลขชุด .ตัวเลข.เด่น .ค่า{font-size:30px}
  .ตัวเลขชุด .ตัวเลข .ท้าย{font-size:12px}
  /* กราฟวาดบนพื้นกว้าง 1000 หน่วย ถ้าย่อลงเหลือ 350 พิกเซล ตัวอักษรเล็กจนอ่านไม่ได้
     จึงคงความกว้างขั้นต่ำไว้แล้วให้เลื่อนซ้ายขวาแทน */
  table.ตารางความรู้{min-width:680px}
  td.วันที่{white-space:nowrap}
  /* จอโทรศัพท์ เมนูสี่อันวางแนวนอนไม่พอ จึงย้ายลงไปเป็นแถบแท็บใต้ชื่อระบบ */
  .แถบข้าง{flex-wrap:wrap;padding:10px 0 0;gap:6px 0;overflow:visible}
  .แบรนด์{padding:0 16px}
  .ล่างแถบ{padding-right:8px}
  .เมนู{order:3;width:100%;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:0}
  .เมนู a{flex-direction:column;gap:3px;padding:7px 2px 8px;font-size:12px;border-radius:0;
    border-bottom:2px solid transparent;justify-content:center}
  .เมนู a.active{background:none;border-bottom-color:var(--ข้างเน้น)}
  .เมนู .ชื่อเต็ม{display:none}
  .เมนู .ชื่อสั้น{display:inline}
  .แถบตัวกรอง{padding:10px}
  .ตัวกรอง{width:100%;justify-content:space-between}
  .ตัวกรอง>span{display:none}
  .กลุ่มเลือก{width:100%}
  .กลุ่มเลือก a{flex:1;text-align:center;padding:6px 6px}
  .ช่วงวันที่{margin-left:0}
  th,td{padding:10px 10px}
  .กราฟ{grid-template-columns:minmax(90px,38%) minmax(0,1fr) auto;gap:10px}
}
/* ---- กล่องยืนยันก่อนเปลี่ยนข้อมูล (แทน confirm ของเบราว์เซอร์) ---- */
dialog.กล่องยืนยัน{border:none;padding:0;border-radius:18px;width:min(440px,calc(100vw - 32px));
  background:var(--การ์ด);color:var(--หมึก);box-shadow:0 24px 60px -12px rgba(27,22,19,.45),0 0 0 1px rgba(27,22,19,.06)}
dialog.กล่องยืนยัน::backdrop{background:rgba(27,22,19,.48);backdrop-filter:blur(3px)}
dialog.กล่องยืนยัน[open]{animation:กล่องโผล่ .16s ease-out}
@keyframes กล่องโผล่{from{opacity:0;transform:translateY(8px) scale(.98)}to{opacity:1;transform:none}}
.กล่องยืนยัน form{margin:0;padding:24px 24px 20px}
.กล่องยืนยัน .หัวกล่อง{display:flex;gap:14px;align-items:flex-start}
.กล่องยืนยัน .วงไอคอน{flex:none;width:44px;height:44px;border-radius:50%;display:grid;place-items:center;
  background:var(--เน้นอ่อน);color:var(--เน้น)}
.กล่องยืนยัน .วงไอคอน svg{width:22px;height:22px}
.กล่องยืนยัน .วงไอคอน>span{display:none}
.กล่องยืนยัน[data-แบบ="ปกติ"] .ไอคอน-ปกติ,.กล่องยืนยัน[data-แบบ="ดี"] .ไอคอน-ดี,
.กล่องยืนยัน[data-แบบ="อันตราย"] .ไอคอน-อันตราย{display:grid}
.กล่องยืนยัน[data-แบบ="ดี"] .วงไอคอน{background:var(--ดีอ่อน);color:var(--ดี)}
.กล่องยืนยัน[data-แบบ="อันตราย"] .วงไอคอน{background:var(--อันตรายอ่อน);color:var(--อันตราย)}
.กล่องยืนยัน h2{font-size:18px;line-height:1.4;margin:2px 0 4px}
.กล่องยืนยัน .อธิบาย{color:var(--หมึกรอง);font-size:14px;line-height:1.65;margin:0}
.กล่องยืนยัน .รายการ{margin:18px 0 0;padding:12px 14px;border-radius:12px;background:var(--พื้นรอง);border:1px solid var(--เส้น)}
.กล่องยืนยัน .รายการ small{display:block;color:var(--หมึกจาง);font-size:12px;margin-bottom:2px}
.กล่องยืนยัน .รายการ b{display:block;font-size:14.5px;font-weight:600;line-height:1.5}
.กล่องยืนยัน .เปลี่ยน{display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-top:10px}
.กล่องยืนยัน .เปลี่ยน[hidden]{display:none}
.กล่องยืนยัน .เปลี่ยน .ลูกศร{color:var(--หมึกจาง);font-size:15px}
.กล่องยืนยัน .ปุ่มกล่อง{display:flex;justify-content:flex-end;gap:10px;margin-top:22px}
.กล่องยืนยัน .ปุ่มกล่อง button{min-width:96px}
.กล่องยืนยัน[data-แบบ="ดี"] .ปุ่มตกลง{background:var(--ดี);border-color:var(--ดี)}
.กล่องยืนยัน[data-แบบ="ดี"] .ปุ่มตกลง:hover{filter:brightness(.92)}
.กล่องยืนยัน[data-แบบ="อันตราย"] .ปุ่มตกลง{background:var(--อันตราย);border-color:var(--อันตราย);color:#fff}
.กล่องยืนยัน[data-แบบ="อันตราย"] .ปุ่มตกลง:hover{filter:brightness(.92);color:#fff}
@media (max-width:600px){
  .กล่องยืนยัน .ปุ่มกล่อง{flex-direction:column-reverse}
  .กล่องยืนยัน .ปุ่มกล่อง button{width:100%}
}
@media print{
  .แถบข้าง,.แถบตัวกรอง{display:none}
  .โครง{display:block}
  body{background:#fff}
}
`;

// ---- ไอคอน ----
// เส้น SVG ที่วาดเอง ใช้ currentColor จึงรับสีตามข้อความรอบข้าง
const เส้นไอคอน = {
  ภาพรวม: '<rect x="3" y="3" width="7" height="9" rx="1.5"/><rect x="14" y="3" width="7" height="5" rx="1.5"/><rect x="14" y="12" width="7" height="9" rx="1.5"/><rect x="3" y="16" width="7" height="5" rx="1.5"/>',
  ฐานข้อมูล: '<ellipse cx="12" cy="5.5" rx="8" ry="2.8"/><path d="M4 5.5v6c0 1.6 3.6 2.8 8 2.8s8-1.2 8-2.8v-6"/><path d="M4 11.5v7c0 1.6 3.6 2.8 8 2.8s8-1.2 8-2.8v-7"/>',
  ความพึงพอใจ: '<circle cx="12" cy="12" r="9"/><path d="M8.5 14.5c.9 1.3 2.1 2 3.5 2s2.6-.7 3.5-2"/><path d="M9 9.5h.01M15 9.5h.01" stroke-width="2.6"/>',
  รายงาน: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  ออก: '<path d="M15 4h3a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-3"/><path d="M10 8l-4 4 4 4"/><path d="M6 12h10"/>',
  โล่: '<path d="M12 3l7 3v5c0 4.5-3 8.2-7 10-4-1.8-7-5.5-7-10V6z"/><path d="M9 12l2 2 4-4"/>',
  ปฏิทิน: '<rect x="3.5" y="5" width="17" height="15.5" rx="2"/><path d="M3.5 10h17M8 3v4M16 3v4"/>',
  ค้น: '<circle cx="11" cy="11" r="6.5"/><path d="M20 20l-4.2-4.2"/>',
  บวก: '<path d="M12 5v14M5 12h14"/>',
  คำถาม: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3h11A2.5 2.5 0 0 1 20 5.5v8a2.5 2.5 0 0 1-2.5 2.5H10l-4.5 4v-4h-1A.5.5 0 0 1 4 15.5z"/>',
  ผู้ใช้: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20.5c1.2-3.6 4.1-5.5 7.5-5.5s6.3 1.9 7.5 5.5"/>',
  เวลา: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  หนังสือ: '<path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5z"/><path d="M5 19.5A1.5 1.5 0 0 0 6.5 21H19"/>',
  เครื่องหมายถูก: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 10"/>',
  ธง: '<path d="M5 21V4"/><path d="M5 4h11l-2 4 2 4H5"/>',
  สลับ: '<path d="M4 8h13l-3.5-3.5"/><path d="M20 16H7l3.5 3.5"/>',
  ถังขยะ: '<path d="M4 7h16"/><path d="M9.5 7V4.5h5V7"/><path d="M6.5 7l1 13h9l1-13"/><path d="M10 11v5.5M14 11v5.5"/>',
  เตือน: '<path d="M12 3.5l9.5 16.5h-19z"/><path d="M12 10v4.5"/><path d="M12 17.5h.01" stroke-width="2.6"/>',
};

/** สร้างไอคอนจากชื่อ คืนสตริงว่างถ้าไม่รู้จักชื่อนั้น */
function ไอคอน(ชื่อ) {
  const d = เส้นไอคอน[ชื่อ];
  if (!d) return '';
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
}

// ---- ชิ้นส่วนที่ใช้ซ้ำในทุกหน้า ----

/** หัวหน้า ชื่อหน้าอยู่ซ้าย ปุ่มหลักของหน้าอยู่ขวา */
function หัวหน้า({ หัว, คำอธิบาย = '', ป้ายบน = '', ขวา = '' }) {
  return `<div class="หัวหน้า">
  <div>${ป้ายบน ? `<div class="ป้ายบน">${esc(ป้ายบน)}</div>` : ''}
    <h1>${esc(หัว)}</h1>${คำอธิบาย ? `<p class="คำอธิบาย">${คำอธิบาย}</p>` : ''}</div>
  ${ขวา ? `<div class="แถวปุ่ม">${ขวา}</div>` : ''}
</div>`;
}

/**
 * การ์ดตัวเลขสรุป
 * @param {{ป้าย:string, ค่า:string, หน่วย?:string, ท้าย?:string, ไอคอน?:string,
 *          เด่น?:boolean, ส่วนต่าง?:string, มาตร?:number}} ค่า
 *   ค่า ท้าย และส่วนต่าง ต้องเป็นข้อความที่แปลงอักขระแล้ว
 */
function การ์ดตัวเลข({ ป้าย, ค่า, หน่วย = '', ท้าย = '', ไอคอน: ชื่อไอคอน = '', เด่น = false,
  ส่วนต่าง = '', มาตร = null }) {
  const แถบมาตร =
    มาตร === null ? '' : `<div class="มาตร"><i style="width:${Math.max(0, Math.min(100, มาตร))}%"></i></div>`;
  return `<div class="ตัวเลข${เด่น ? ' เด่น' : ''}">
    <div class="ป้าย">${ไอคอน(ชื่อไอคอน)}${esc(ป้าย)}</div>
    <div class="ค่า">${ค่า}${หน่วย ? `<small>${esc(หน่วย)}</small>` : ''}</div>
    ${แถบมาตร}
    ${ส่วนต่าง || ท้าย ? `<div class="ท้าย">${ส่วนต่าง}${ท้าย}</div>` : ''}
  </div>`;
}

/** ป้ายร้อยละที่เพิ่ม/ลดจากช่วงก่อนหน้า มีลูกศรกำกับ ไม่ใช้สีอย่างเดียว */
function ป้ายส่วนต่าง(ตอนนี้, ก่อนหน้า) {
  const ก = Number(ก่อนหน้า);
  const น = Number(ตอนนี้) || 0;
  if (!(ก > 0)) return '';
  const ร้อยละ = Math.round(((น - ก) / ก) * 100);
  if (ร้อยละ === 0) return '<span class="ส่วนต่าง">= เท่าเดิม</span>';
  const ขึ้น = ร้อยละ > 0;
  return `<span class="ส่วนต่าง ${ขึ้น ? 'ขึ้น' : 'ลง'}">${ขึ้น ? '▲' : '▼'} ${Math.abs(ร้อยละ)}%</span>`;
}

/** กล่องว่างพร้อมไอคอน ใช้แทนตารางหรือกราฟเมื่อไม่มีข้อมูล */
function กล่องว่าง(ข้อความ, { ไอคอน: ชื่อไอคอน = 'ภาพรวม', ต่อท้าย = '' } = {}) {
  return `<div class="ว่าง"><div class="ไอคอนว่าง">${ไอคอน(ชื่อไอคอน)}</div>${ข้อความ}${ต่อท้าย}</div>`;
}

// ---- วาดกราฟเส้น (ใช้ทั้งฝั่งเซิร์ฟเวอร์และเบราว์เซอร์) ----
// เซิร์ฟเวอร์วาดขนาด 1000 x 300 ไว้ก่อน แล้วเบราว์เซอร์วาดซ้ำตามความกว้างจริงของกล่อง
// ฟังก์ชันนี้ถูก toString() ฝังลงหน้าเว็บ จึงห้ามอ้างตัวแปรภายนอก ห้ามใช้ backtick
// ห้ามมีแท็กปิด script และห้ามมีคำ undefined หรือ NaN ในตัวฟังก์ชัน (ชุดทดสอบใช้จับหน้าพัง)
//
//  @param {{v:Array<number|null>, l:string[], f:string[], u:string, d:number, a:boolean}} ส
//         v ค่า  l ป้ายแกนสั้น  f ป้ายเต็มในป้ายลอย  u หน่วย  d ทศนิยม  a ระบายพื้นที่ใต้เส้น
//  @returns {{ใน:string, จุด:Array, ฐาน:number, บน:number, สรุป:string}}
function วาดกราฟเส้น(ส, กว้าง, สูง) {
  function e(t) {
    return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }
  var ทศ = ส.d || 0;
  function รูป(v) {
    return Number(v).toLocaleString('th-TH', ทศ
      ? { minimumFractionDigits: ทศ, maximumFractionDigits: ทศ }
      : { maximumFractionDigits: 0 });
  }
  function ปัด(v) { return Math.round(v * 10) / 10; }

  var ค่า = ส.v.map(function (x) {
    if (x == null || x === '') return null;
    var n = Number(x);
    return isFinite(n) ? n : null;
  });
  var มีค่า = ค่า.filter(function (x) { return x !== null; });
  var สูงสุด = มีค่า.length ? Math.max.apply(null, มีค่า) : 0;

  // เส้นตารางเป็นเลขกลม ราวสี่ช่อง
  var เส้นตาราง = [0, 1];
  if (สูงสุด > 0) {
    var ดิบ = สูงสุด / 4;
    var หลัก = Math.pow(10, Math.floor(Math.log10(ดิบ)));
    var ก้าว = หลัก * 10;
    var ตัวคูณ = [1, 2, 2.5, 5, 10];
    for (var k = 0; k < ตัวคูณ.length; k++) {
      if (หลัก * ตัวคูณ[k] >= ดิบ) { ก้าว = หลัก * ตัวคูณ[k]; break; }
    }
    if (!ทศ) ก้าว = Math.max(1, Math.ceil(ก้าว));
    var บนสุด = Math.ceil(สูงสุด / ก้าว - 1e-9) * ก้าว;
    เส้นตาราง = [];
    for (var g = 0; g <= บนสุด + 1e-9; g += ก้าว) เส้นตาราง.push(Number(g.toFixed(6)));
  }
  var เพดาน = เส้นตาราง[เส้นตาราง.length - 1];

  var ขอบซ้าย = 8 + Math.max.apply(null, เส้นตาราง.map(function (v) { return รูป(v).length; })) * 8.5;
  var ขอบขวา = 20, ขอบล่าง = 36, ขอบบน = 30;
  var พื้นที่กว้าง = กว้าง - ขอบซ้าย - ขอบขวา;
  var พื้นที่สูง = สูง - ขอบล่าง - ขอบบน;
  var ฐาน = ขอบบน + พื้นที่สูง;
  var n = ค่า.length;
  var หลายจุด = n > 1;
  var ช่วง = หลายจุด ? พื้นที่กว้าง / (n - 1) : 0;
  function จุดX(i) { return หลายจุด ? ขอบซ้าย + i * ช่วง : ขอบซ้าย + พื้นที่กว้าง / 2; }
  function จุดY(v) { return ฐาน - (v / เพดาน) * พื้นที่สูง; }

  var พิกัด = ค่า.map(function (v, i) {
    return { x: ปัด(จุดX(i)), y: v === null ? null : ปัด(จุดY(v)), v: v, i: i };
  });

  // ตัดเส้นเป็นท่อนตรงจุดที่ไม่มีข้อมูล
  var ท่อน = [], ท่อนนี้ = [];
  พิกัด.forEach(function (p) {
    if (p.y === null) { if (ท่อนนี้.length) ท่อน.push(ท่อนนี้); ท่อนนี้ = []; }
    else ท่อนนี้.push(p);
  });
  if (ท่อนนี้.length) ท่อน.push(ท่อนนี้);

  var เส้น = ท่อน.map(function (t) {
    if (t.length === 1) return '';
    var จ = t.map(function (p) { return p.x + ',' + p.y; }).join(' ');
    return (ส.a !== false
      ? '<polygon class="พื้นที่ใต้เส้น" points="' + t[0].x + ',' + ฐาน + ' ' + จ + ' ' + t[t.length - 1].x + ',' + ฐาน + '"/>'
      : '') + '<polyline class="เส้นกราฟ" points="' + จ + '"/>';
  }).join('');

  // จุดบนเส้น: ถ้าจุดถี่บนจอ แสดงเฉพาะจุดล่าสุด จุดสูงสุด และจุดที่อยู่โดด
  var ล่าสุด = -1;
  for (var i = n - 1; i >= 0; i--) if (ค่า[i] !== null) { ล่าสุด = i; break; }
  var ที่สูงสุด = มีค่า.length && สูงสุด > 0 ? ค่า.indexOf(สูงสุด) : -1;
  var โดด = {};
  ท่อน.forEach(function (t) { if (t.length === 1) โดด[t[0].i] = true; });
  // มีค่าจริงไม่กี่จุดให้แสดงทุกจุดเสมอ
  var ระยะ = หลายจุด ? พื้นที่กว้าง / (n - 1) : พื้นที่กว้าง;
  var ถี่ = หลายจุด && มีค่า.length > 40 && ระยะ < 14;
  var รัศมี = Math.max(2.5, Math.min(4, ระยะ / 2));
  var จุด = พิกัด.filter(function (p) {
    return p.y !== null && (!ถี่ || p.i === ล่าสุด || p.i === ที่สูงสุด || โดด[p.i]);
  }).map(function (p) {
    return '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + (p.i === ล่าสุด ? 5.5 : รัศมี) +
      '" class="จุดกราฟ' + (p.i === ล่าสุด ? ' ล่าสุด' : '') + '"/>';
  }).join('');

  // ป้ายตัวเลขติดแค่ค่าล่าสุดกับค่าสูงสุด
  var ป้ายค่า = [ที่สูงสุด, ล่าสุด].filter(function (x, k, a) { return x >= 0 && a.indexOf(x) === k; })
    .map(function (x) {
      var p = พิกัด[x];
      var ขวา = p.x > กว้าง - 60;
      return '<text x="' + (ขวา ? p.x + 6 : p.x) + '" y="' + ปัด(p.y - 13) + '" text-anchor="' +
        (ขวา ? 'end' : 'middle') + '" class="ป้ายค่า' + (x === ล่าสุด ? ' ล่าสุด' : '') + '">' + e(รูป(p.v)) + '</text>';
    }).join('');

  // ป้ายแกนนอน เว้นระยะตามความกว้างป้าย จุดแรกกับจุดสุดท้ายมีป้ายเสมอ
  var กว้างป้าย = Math.max.apply(null, ส.l.map(function (t) { return String(t).length; }).concat([1])) * 7.5 + 22;
  var วางได้ = Math.max(2, Math.floor(พื้นที่กว้าง / กว้างป้าย));
  var เว้น = Math.max(1, Math.ceil((n - 1) / (วางได้ - 1)));
  var แสดงป้าย = {};
  for (var j = 0; j < n; j += เว้น) แสดงป้าย[j] = true;
  var ท้าย = n - 1;
  Object.keys(แสดงป้าย).forEach(function (s) {
    var jj = Number(s);
    if (jj !== ท้าย && (ท้าย - jj) * ช่วง < กว้างป้าย) delete แสดงป้าย[jj];
  });
  แสดงป้าย[0] = true;
  แสดงป้าย[ท้าย] = true;
  var ป้ายนอน = ส.l.map(function (t, k) {
    if (!แสดงป้าย[k]) return '';
    var ยึด = !หลายจุด ? 'middle' : k === 0 ? 'start' : k === ท้าย ? 'end' : 'middle';
    return '<text x="' + ปัด(จุดX(k)) + '" y="' + (สูง - 10) + '" text-anchor="' + ยึด + '" class="ป้ายแกน">' + e(t) + '</text>';
  }).join('');

  var อ้างอิง = เส้นตาราง.map(function (v) {
    var y = ปัด(จุดY(v));
    return '<line x1="' + ปัด(ขอบซ้าย) + '" x2="' + (กว้าง - ขอบขวา) + '" y1="' + y + '" y2="' + y +
      '" class="เส้นอ้างอิง' + (v === 0 ? ' เส้นฐาน' : '') + '"/>' +
      '<text x="' + ปัด(ขอบซ้าย - 10) + '" y="' + ปัด(y + 4) + '" text-anchor="end" class="ป้ายแกน">' + e(รูป(v)) + '</text>';
  }).join('');

  var สำหรับชี้ = พิกัด.map(function (p) {
    return {
      x: p.x, y: p.y,
      v: p.v === null ? 'ไม่มีข้อมูล' : (รูป(p.v) + ' ' + (ส.u || '')).trim(),
      l: String(ส.f[p.i] || ส.l[p.i]),
    };
  });

  var สรุป = 'กราฟเส้นแสดง' + (ส.u || '') + 'ตามช่วงเวลา ' + n + ' ช่วง' +
    (ล่าสุด >= 0 ? ' ล่าสุด ' + รูป(ค่า[ล่าสุด]) : '') +
    (ที่สูงสุด >= 0 ? ' สูงสุด ' + รูป(สูงสุด) : '');

  var ใน = อ้างอิง + เส้น +
    '<line class="เส้นชี้" x1="0" x2="0" y1="' + (ขอบบน - 8) + '" y2="' + ปัด(ฐาน) + '"/>' +
    จุด + ป้ายค่า + ป้ายนอน + '<circle class="จุดชี้" cx="0" cy="0" r="6"/>';

  return { ใน: ใน, จุด: สำหรับชี้, ฐาน: ปัด(ฐาน), สรุป: สรุป };
}

// ---- สคริปต์โต้ตอบของกราฟเส้นในเบราว์เซอร์ ----
// วาดกราฟซ้ำตามความกว้างกล่องเมื่อขนาดจอเปลี่ยน และแสดงเส้นชี้กับป้ายลอยเมื่อชี้ แตะ หรือกดลูกศร
const สคริปต์กราฟ = '<script>\n(function () {\nvar วาดกราฟเส้น = ' + วาดกราฟเส้น.toString() + ';\n' + `
  var กล่องทั้งหมด = document.querySelectorAll('.กล่องกราฟ');
  Array.prototype.forEach.call(กล่องทั้งหมด, function (กล่อง) {
    var svg = กล่อง.querySelector('svg.กราฟเส้น');
    if (!svg) return;
    var ข้อมูล;
    try { ข้อมูล = JSON.parse(svg.getAttribute('data-spec') || 'null'); } catch (e) { return; }
    if (!ข้อมูล || !ข้อมูล.v || !ข้อมูล.v.length) return;

    var จุด = [], กว้าง = 1000, สูง = 300, ฐาน = 0, กว้างเดิม = 0;
    var ป้าย = document.createElement('div');
    ป้าย.className = 'ป้ายลอย';
    ป้าย.hidden = true;
    var ค่า = document.createElement('strong');
    var ชื่อ = document.createElement('span');
    ป้าย.appendChild(ค่า);
    ป้าย.appendChild(ชื่อ);
    กล่อง.appendChild(ป้าย);
    var ปัจจุบัน = -1;

    function วาด() {
      var w = Math.round(กล่อง.clientWidth);
      if (!w || w === กว้างเดิม) return;
      กว้างเดิม = w;
      กว้าง = w;
      สูง = Math.round(Math.max(220, Math.min(380, w * 0.3)));
      var ผล = วาดกราฟเส้น(ข้อมูล, กว้าง, สูง);
      svg.setAttribute('viewBox', '0 0 ' + กว้าง + ' ' + สูง);
      svg.innerHTML = ผล.ใน;
      จุด = ผล.จุด;
      ฐาน = ผล.ฐาน;
      ซ่อน();
    }

    function แสดง(i) {
      if (i < 0 || i >= จุด.length) return;
      ปัจจุบัน = i;
      var d = จุด[i];
      var r = svg.getBoundingClientRect();
      var อัตราX = r.width / กว้าง, อัตราY = r.height / สูง;
      var เส้นชี้ = svg.querySelector('.เส้นชี้');
      var จุดชี้ = svg.querySelector('.จุดชี้');
      เส้นชี้.setAttribute('x1', d.x);
      เส้นชี้.setAttribute('x2', d.x);
      var yจุด = d.y === null ? ฐาน : d.y;
      จุดชี้.setAttribute('cx', d.x);
      จุดชี้.setAttribute('cy', yจุด);
      จุดชี้.style.display = d.y === null ? 'none' : '';
      svg.classList.add('กำลังชี้');
      ค่า.textContent = d.v;
      ชื่อ.textContent = d.l;
      ป้าย.hidden = false;
      var ครึ่ง = ป้าย.offsetWidth / 2;
      var ซ้าย = Math.max(ครึ่ง, Math.min(r.width - ครึ่ง, d.x * อัตราX));
      ป้าย.style.left = ซ้าย + 'px';
      ป้าย.style.top = Math.max(ป้าย.offsetHeight + 12, yจุด * อัตราY) + 'px';
    }
    function ซ่อน() {
      svg.classList.remove('กำลังชี้');
      ป้าย.hidden = true;
    }
    function ใกล้สุด(x) {
      var ดีสุด = 0, ห่าง = Infinity;
      for (var i = 0; i < จุด.length; i++) {
        var h = Math.abs(จุด[i].x - x);
        if (h < ห่าง) { ห่าง = h; ดีสุด = i; }
      }
      return ดีสุด;
    }
    svg.addEventListener('pointermove', function (ev) {
      var r = svg.getBoundingClientRect();
      แสดง(ใกล้สุด(((ev.clientX - r.left) / r.width) * กว้าง));
    });
    svg.addEventListener('pointerleave', ซ่อน);
    svg.addEventListener('focus', function () { แสดง(ปัจจุบัน < 0 ? จุด.length - 1 : ปัจจุบัน); });
    svg.addEventListener('blur', ซ่อน);
    svg.addEventListener('keydown', function (ev) {
      if (ev.key === 'ArrowLeft') { แสดง(Math.max(0, ปัจจุบัน - 1)); ev.preventDefault(); }
      if (ev.key === 'ArrowRight') { แสดง(Math.min(จุด.length - 1, ปัจจุบัน + 1)); ev.preventDefault(); }
      if (ev.key === 'Home') { แสดง(0); ev.preventDefault(); }
      if (ev.key === 'End') { แสดง(จุด.length - 1); ev.preventDefault(); }
    });

    วาด();
    if (window.ResizeObserver) new ResizeObserver(function () { วาด(); }).observe(กล่อง);
    else window.addEventListener('resize', วาด);
  });
})();
</script>`;

// ---- แถบนำทาง ----
// ไม่มีหน้าความรู้ที่ยังขาดแล้ว ตาราง knowledge_gaps ยังเก็บข้อมูลอยู่ ดูได้จากฐานข้อมูลโดยตรง
const เมนู = [
  // ที่อยู่, ชื่อเต็ม, ไอคอน, ชื่อสั้น (ใช้ตอนจอแคบ)
  ['/', 'ภาพรวม', 'ภาพรวม', 'ภาพรวม'],
  ['/knowledge', 'ฐานข้อมูล', 'ฐานข้อมูล', 'ฐานข้อมูล'],
  ['/feedback', 'ความพึงพอใจ', 'ความพึงพอใจ', 'พึงพอใจ'],
  ['/reports', 'รายงานจากผู้ใช้', 'รายงาน', 'รายงาน'],
];

// ---- โลโก้ (แถบเมนู หน้าล็อกอิน และไอคอนแท็บ) ----
// ฝังเป็น data URI เพราะหน้าล็อกอินต้องแสดงโลโก้ได้ก่อนเข้าสู่ระบบ
const โลโก้ = 'data:image/png;base64,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';

// ---- กล่องยืนยันก่อนเปลี่ยนข้อมูล ----
// ปุ่มที่มีแอตทริบิวต์ data-ยืนยัน-หัว จะเปิดกล่องนี้แทน confirm ของเบราว์เซอร์
// ถ้าปิดสคริปต์ไว้ onsubmit/onclick เดิมที่เรียก confirm ยังทำงานแทนได้
const กล่องยืนยัน = `<dialog class="กล่องยืนยัน" data-แบบ="ปกติ" aria-labelledby="กล่องยืนยัน-หัว">
  <form method="dialog">
    <div class="หัวกล่อง">
      <div class="วงไอคอน" aria-hidden="true">
        <span class="ไอคอน-ปกติ">${ไอคอน('สลับ')}</span>
        <span class="ไอคอน-ดี">${ไอคอน('เครื่องหมายถูก')}</span>
        <span class="ไอคอน-อันตราย">${ไอคอน('เตือน')}</span>
      </div>
      <div>
        <h2 id="กล่องยืนยัน-หัว"></h2>
        <p class="อธิบาย"></p>
      </div>
    </div>
    <div class="รายการ">
      <small></small><b></b>
      <div class="เปลี่ยน" hidden>
        <span class="ป้ายเล็ก จาก"></span><span class="ลูกศร" aria-hidden="true">→</span><span class="ป้ายเล็ก เป็น"></span>
      </div>
    </div>
    <div class="ปุ่มกล่อง">
      <button type="submit" value="ยกเลิก" class="รอง">ยกเลิก</button>
      <button type="submit" value="ตกลง" class="ปุ่มตกลง">ตกลง</button>
    </div>
  </form>
</dialog>`;

// ข้อความทุกช่องใส่ด้วย textContent เพราะหัวข้อมาจากข้อมูลที่ผู้ดูแลกรอก
const สคริปต์ยืนยัน = `<script>
(function () {
  var กล่อง = document.querySelector('dialog.กล่องยืนยัน');
  if (!กล่อง || typeof กล่อง.showModal !== 'function') return;
  var ปุ่มตกลง = กล่อง.querySelector('.ปุ่มตกลง');
  var เปลี่ยน = กล่อง.querySelector('.เปลี่ยน');
  var รอทำ = null;

  function ใส่(sel, ข้อความ) { กล่อง.querySelector(sel).textContent = ข้อความ || ''; }
  function ใส่ป้าย(sel, ค่า) {
    var ส่วน = (ค่า || '').split('|');
    var el = กล่อง.querySelector(sel);
    el.textContent = ส่วน[0] || '';
    el.className = 'ป้ายเล็ก ' + (sel === '.จาก' ? 'จาก ' : 'เป็น ') + (ส่วน[1] || '');
  }

  function เปิด(ที่มา, ทำต่อ) {
    function d(ชื่อ) { return ที่มา.getAttribute('data-ยืนยัน-' + ชื่อ) || ''; }
    กล่อง.setAttribute('data-แบบ', d('แบบ') || 'ปกติ');
    ใส่('h2', d('หัว'));
    ใส่('.อธิบาย', d('อธิบาย'));
    ใส่('.รายการ small', d('รายการ'));
    ใส่('.รายการ b', d('ชื่อ'));
    if (d('จาก') && d('เป็น')) {
      ใส่ป้าย('.จาก', d('จาก'));
      ใส่ป้าย('.เป็น', d('เป็น'));
      เปลี่ยน.hidden = false;
    } else {
      เปลี่ยน.hidden = true;
    }
    ปุ่มตกลง.textContent = d('ปุ่ม') || 'ตกลง';
    รอทำ = ทำต่อ;
    กล่อง.returnValue = '';
    กล่อง.showModal();
    ปุ่มตกลง.focus();
  }

  กล่อง.addEventListener('close', function () {
    var ทำ = รอทำ;
    รอทำ = null;
    if (กล่อง.returnValue === 'ตกลง' && ทำ) ทำ();
  });
  // คลิกพื้นหลังนอกกล่อง = ยกเลิก
  กล่อง.addEventListener('click', function (e) { if (e.target === กล่อง) กล่อง.close('ยกเลิก'); });

  Array.prototype.forEach.call(document.querySelectorAll('[data-ยืนยัน-หัว]'), function (el) {
    if (el.tagName === 'FORM') {
      el.removeAttribute('onsubmit');
      el.addEventListener('submit', function (e) {
        if (el.dataset['ผ่านแล้ว']) return;
        e.preventDefault();
        var ปุ่ม = e.submitter || null;
        เปิด(el, function () {
          el.dataset['ผ่านแล้ว'] = '1';
          if (el.requestSubmit) el.requestSubmit(ปุ่ม); else el.submit();
        });
      });
    } else {
      el.removeAttribute('onclick');
      el.addEventListener('click', function (e) {
        var ฟอร์ม = el.form;
        if (!ฟอร์ม || ฟอร์ม.dataset['ผ่านแล้ว']) return;
        e.preventDefault();
        เปิด(el, function () {
          ฟอร์ม.dataset['ผ่านแล้ว'] = '1';
          if (ฟอร์ม.requestSubmit) ฟอร์ม.requestSubmit(el); else el.click();
        });
      });
    }
  });
})();
</script>`;

function หน้า({ title, active, body }) {
  const ลิงก์ = เมนู
    .map(
      ([u, n, i, สั้น]) =>
        `<a href="${u}"${u === active ? ' class="active" aria-current="page"' : ''}>${ไอคอน(i)}` +
        `<span class="ชื่อเต็ม">${n}</span><span class="ชื่อสั้น" aria-hidden="true">${สั้น}</span></a>`
    )
    .join('');
  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<link rel="icon" type="image/png" href="${โลโก้}">
<title>${esc(title)} · หลังบ้านคุณภาษี</title>
<style>${CSS}</style></head>
<body>
<div class="โครง">
<header class="แถบข้าง">
  <a class="แบรนด์" href="/"><img class="โลโก้" src="${โลโก้}" alt="" width="42" height="42">
    <span><b>คุณภาษี</b><small>หลังบ้านผู้ดูแลระบบ</small></span></a>
  <nav class="เมนู" aria-label="เมนูหลัก"><div class="หัวกลุ่ม">เมนู</div>${ลิงก์}</nav>
  <div class="ล่างแถบ">
    <div class="ป้ายส่วนตัว">${ไอคอน('โล่')}<span>หน้านี้อ่านบทสนทนาของผู้ใช้ไม่ได้ กันไว้ถึงระดับสิทธิ์ของฐานข้อมูล</span></div>
    <a class="ออก" href="/logout">${ไอคอน('ออก')}<span>ออกจากระบบ</span></a>
  </div>
</header>
<main>${body}</main>
</div>
${กล่องยืนยัน}
${สคริปต์กราฟ}
${สคริปต์ยืนยัน}
</body></html>`;
}

/** หน้าล็อกอิน (ไม่มีเมนู เพราะยังไม่ได้ยืนยันตัวตน) */
function หน้าล็อกอิน(ข้อผิดพลาด) {
  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<link rel="icon" type="image/png" href="${โลโก้}">
<title>เข้าสู่ระบบ · หลังบ้านคุณภาษี</title>
<style>${CSS}
body{min-height:100vh;display:grid;grid-template-columns:minmax(0,1.05fr) minmax(0,1fr)}
.ซ้าย{background:radial-gradient(120% 90% at 0% 0%,#3a2b23 0%,#1b1613 55%);color:#e9e0d8;
  padding:48px 56px;display:flex;flex-direction:column;justify-content:space-between;gap:40px}
.ซ้าย .แบรนด์ b{font-size:18px}
.ซ้าย h2{font-size:30px;line-height:1.35;color:#fff;margin:0 0 14px;letter-spacing:-.02em;font-weight:700}
.ซ้าย p{color:#b8aca2;max-width:44ch;margin:0}
.ซ้าย ul{list-style:none;padding:0;margin:26px 0 0;display:grid;gap:12px}
.ซ้าย li{display:flex;gap:10px;color:#d7cbc1;font-size:14px}
.ซ้าย li svg{width:18px;height:18px;flex:none;color:var(--ข้างเน้น);margin-top:2px}
.ขวา{display:grid;place-items:center;padding:40px 24px}
.กล่อง{width:100%;max-width:380px}
.กล่อง h1{margin-bottom:6px}
.กล่อง form{margin-top:26px}
.กล่อง button{width:100%;padding:11px 16px}
@media (max-width:820px){body{grid-template-columns:1fr}.ซ้าย{padding:28px 24px}.ซ้าย ul,.ซ้าย p{display:none}.ซ้าย h2{font-size:22px;margin:0}}
</style></head>
<body>
<section class="ซ้าย">
  <span class="แบรนด์"><img class="โลโก้" src="${โลโก้}" alt="" width="42" height="42">
    <span><b>คุณภาษี</b><small>หลังบ้านผู้ดูแลระบบ</small></span></span>
  <div>
    <h2>ดูภาพรวมการใช้งาน<br>และดูแลฐานความรู้ภาษี</h2>
    <p>สำหรับผู้ดูแลระบบที่ปรึกษาภาษีบนไลน์เท่านั้น</p>
    <ul>
      <li>${ไอคอน('โล่')}<span>อ่านบทสนทนาของผู้ใช้ไม่ได้ ไม่ว่ากรณีใด บัญชีฐานข้อมูลถูกเพิกถอนสิทธิ์ไว้แล้ว</span></li>
      <li>${ไอคอน('ภาพรวม')}<span>เห็นเฉพาะตัวเลขสรุป เช่น จำนวนคำถามและคะแนนความพึงพอใจ</span></li>
      <li>${ไอคอน('ฐานข้อมูล')}<span>เพิ่มและแก้ไขความรู้ พร้อมทดลองค้นก่อนบันทึกทุกครั้ง</span></li>
    </ul>
  </div>
  <span></span>
</section>
<section class="ขวา"><div class="กล่อง">
  <h1>เข้าสู่ระบบ</h1>
  <p class="คำอธิบาย">กรอกรหัสผ่านผู้ดูแลที่ตั้งไว้ในไฟล์ .env</p>
  <form method="post" action="/login">
    ${ข้อผิดพลาด ? `<div class="แจ้ง ผิด">${esc(ข้อผิดพลาด)}</div>` : ''}
    <label>
      <span class="ชื่อช่อง">รหัสผ่าน</span>
      <input type="password" name="password" autofocus required autocomplete="current-password">
    </label>
    <button type="submit">เข้าสู่ระบบ</button>
  </form>
</div></section>
</body></html>`;
}

module.exports = {
  esc,
  วาดกราฟเส้น,
  เลข,
  เป็นวันที่,
  วันที่สั้น,
  วันที่เต็ม,
  หน้า,
  หน้าล็อกอิน,
  ไอคอน,
  หัวหน้า,
  การ์ดตัวเลข,
  ป้ายส่วนต่าง,
  กล่องว่าง,
};
