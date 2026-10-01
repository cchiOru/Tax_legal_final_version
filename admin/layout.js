'use strict';
/**
 * ============================================================================
 *  โครงหน้าเว็บและตัวช่วยแสดงผล
 * ----------------------------------------------------------------------------
 *  หน้าเว็บนี้สร้าง HTML ที่ฝั่งเซิร์ฟเวอร์ทั้งหมด ไม่ใช้ JavaScript framework
 *
 *  เหตุผล
 *    ผู้ใช้มีคนเดียว ปริมาณข้อมูลน้อย และหน้าเว็บนี้ต้องอยู่ได้นานหลังส่งงาน
 *    การไม่พึ่ง framework ทำให้ไม่มีอะไรให้อัปเดตตามและไม่มีช่องโหว่จากไลบรารีภายนอก
 *    ทั้งโปรเจกต์นี้ใช้ npm package ตัวเดียวคือ pg สำหรับต่อฐานข้อมูล
 * ============================================================================
 */

/**
 * แปลงอักขระพิเศษของ HTML ให้ปลอดภัยก่อนนำไปแสดง
 *
 * ต้องเรียกกับทุกค่าที่มาจากฐานข้อมูลหรือจากฟอร์ม
 * ถ้าลืมแม้แต่ที่เดียว จะเปิดช่องให้ฝังสคริปต์ผ่านเนื้อหาความรู้ที่ผู้ดูแลกรอกเอง
 */
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

// ---------------------------------------------------------------------------
//  จัดรูปแบบวันที่
// ---------------------------------------------------------------------------
//  ที่มาของบั๊ก พบจากหน้าจอจริงเมื่อ 27 กันยายน 2569
//
//  ไดรเวอร์ pg คืนคอลัมน์ชนิด date และ timestamp มาเป็นอ็อบเจกต์ Date ของ
//  จาวาสคริปต์ ไม่ใช่ข้อความ เมื่อนำไปต่อกับข้อความตรง ๆ จะได้
//    "Fri Sep 25 2026 00:00:00 GMT+0700 (Indochina Time)"
//  ยาว 52 ตัวอักษร ทั้งบนป้ายแกนนอนของกราฟและในตารางข้างล่าง
//
//  โค้ดเดิมพยายามตัดปีออกด้วย .slice(5) ซึ่งเขียนไว้ตอนที่เข้าใจว่าค่าที่ได้
//  เป็นข้อความรูปแบบ 2026-09-25 การตัดห้าตัวแรกจึงควรได้ 09-25
//  แต่พอค่าจริงเป็น Date การตัดกลับได้ "Sep 25 2026 00:00:00 GMT+0700..."
//  ป้ายทุกแท่งจึงทับกันจนอ่านไม่ออกเลยสักอัน
//
//  บทเรียนคือการแปลงชนิดข้อมูลโดยปริยายด้วย String() ทำให้ความผิดพลาดเงียบ
//  แก้ด้วยการแปลงที่เดียวตรงนี้ แล้วให้ทุกหน้าเรียกใช้ฟังก์ชันเดียวกัน
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
 * ป้ายวันที่แบบสั้นสำหรับแกนนอนของกราฟ ต้องสั้นที่สุดเท่าที่ยังอ่านรู้เรื่อง
 *
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

/** ป้ายวันที่แบบเต็ม ใช้ในตารางและในข้อความช่วยตอนเอาเมาส์ชี้ */
function วันที่เต็ม(v, ช่วง = 'วัน') {
  const d = เป็นวันที่(v);
  if (!d) return String(v === null || v === undefined ? '' : v);
  const พศ = d.getFullYear() + 543;
  if (ช่วง === 'ปี') return String(พศ);
  if (ช่วง === 'เดือน') return `${ชื่อเดือนสั้น[d.getMonth()]} ${พศ}`;
  return `${d.getDate()} ${ชื่อเดือนสั้น[d.getMonth()]} ${พศ}`;
}

const CSS = `
/* ===========================================================================
   ธีมน้ำตาล ขาว ดำ
   ---------------------------------------------------------------------------
   ใช้สีเน้นสีเดียวทั้งระบบ คือน้ำตาล เพราะหน้านี้ไม่มีกราฟที่ต้องแยกหลายชุด
   ข้อมูล การใส่หลายสีจึงไม่ได้สื่ออะไรเพิ่ม มีแต่ทำให้สายตาสับสนว่าสีแปลว่าอะไร

   ค่าที่ตรวจแล้วด้วยเกณฑ์ WCAG บนพื้นการ์ดสีขาว
     แท่งกราฟ #7B4B2A      7.29:1   เกินเกณฑ์กราฟิก 3:1 อยู่มาก
     ตัวอักษรหลัก #1B1715  17.80:1
     ตัวอักษรรอง #6F6660    5.61:1   เกินเกณฑ์ตัวอักษร 4.5:1
   เส้นขอบตั้งใจให้คอนทราสต์ต่ำ เพราะมีหน้าที่แบ่งพื้นที่ ไม่ใช่ให้อ่าน
   =========================================================================== */
:root{
  --พื้นหลัง:#faf7f3; --การ์ด:#ffffff; --เส้น:#e8e0d6; --เส้นเข้ม:#d6cabb;
  --ตัวอักษร:#1b1715; --รอง:#6f6660; --จาง:#9a918a;
  --เน้น:#7b4b2a; --เน้นอ่อน:#f2e9e1; --เน้นเข้ม:#5e3920;
  --เตือน:#8a5a12; --อันตราย:#8f2f26; --ดี:#3f6b45;
  --เงา:0 1px 2px rgba(27,23,21,.04), 0 1px 1px rgba(27,23,21,.03);
}
*{box-sizing:border-box}
body{margin:0;font-family:"Sarabun","Segoe UI",system-ui,sans-serif;
  background:var(--พื้นหลัง);color:var(--ตัวอักษร);line-height:1.6;
  -webkit-font-smoothing:antialiased}

/* แถบเมนูบนสุด เส้นใต้บาง ๆ พอให้แยกจากเนื้อหา ไม่ต้องใช้เงา */
header{background:var(--การ์ด);border-bottom:1px solid var(--เส้น);padding:0 24px}
header .แถบ{max-width:1120px;margin:0 auto;display:flex;align-items:center;gap:2px;
  height:60px;flex-wrap:wrap}
header .ชื่อ{font-weight:700;margin-right:28px;letter-spacing:-.01em}
header a{color:var(--รอง);text-decoration:none;padding:7px 13px;border-radius:7px;
  font-size:15px;transition:background .12s,color .12s}
header a:hover{background:var(--พื้นหลัง);color:var(--ตัวอักษร)}
header a.active{color:var(--เน้น);font-weight:600;background:var(--เน้นอ่อน)}
header .ขวา{margin-left:auto}

main{max-width:1120px;margin:0 auto;padding:32px 24px 64px}

/* ลำดับความสำคัญของตัวหนังสือ ต่างกันด้วยขนาดและน้ำหนัก ไม่ใช่ด้วยสี */
h1{font-size:24px;font-weight:700;margin:0 0 6px;letter-spacing:-.015em}
h2{font-size:15px;font-weight:600;margin:36px 0 14px;color:var(--รอง);
  text-transform:none;letter-spacing:.01em}
h2:first-of-type{margin-top:28px}
.คำอธิบาย{color:var(--รอง);font-size:14px;margin:0 0 26px;max-width:70ch}

/* -----------------------------------------------------------------------
   การ์ด
   -----------------------------------------------------------------------
   แยกขอบเขตด้วยสามอย่างพร้อมกัน คือพื้นขาวตัดกับพื้นหลังอุ่น เส้นขอบ
   และเงาบางมาก การใช้อย่างเดียวจะแยกไม่ชัดพอบนจอที่ความสว่างต่ำ */
.การ์ด{background:var(--การ์ด);border:1px solid var(--เส้น);border-radius:12px;
  padding:22px 24px;margin-bottom:18px;box-shadow:var(--เงา)}
.การ์ด>h2:first-child{margin-top:0}

/* ชุดตัวเลขสรุป การ์ดเล็กเรียงเป็นแถว ตัวเลขคือพระเอก ป้ายเป็นตัวรอง */
.ตัวเลขชุด{display:grid;grid-template-columns:repeat(auto-fit,minmax(190px,1fr));
  gap:14px;margin-bottom:18px}
.ตัวเลข{background:var(--การ์ด);border:1px solid var(--เส้น);border-radius:12px;
  padding:18px 20px;box-shadow:var(--เงา)}
.ตัวเลข .ป้าย{color:var(--รอง);font-size:13px;font-weight:500}
.ตัวเลข .ค่า{font-size:32px;font-weight:700;margin-top:6px;line-height:1.15;
  letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.ตัวเลข .ท้าย{color:var(--จาง);font-size:12px;margin-top:6px}

/* ตาราง เส้นคั่นเฉพาะแนวนอน ตัวเลขชิดขวาและใช้ความกว้างตัวเลขเท่ากัน
   เพื่อให้เทียบหลักกันได้ด้วยสายตาโดยไม่ต้องอ่านทีละตัว */
table{width:100%;border-collapse:collapse;font-size:14px}
th,td{text-align:left;padding:11px 12px;border-bottom:1px solid var(--เส้น);
  vertical-align:top}
thead th{color:var(--รอง);font-weight:600;font-size:12px;white-space:nowrap;
  border-bottom:1px solid var(--เส้นเข้ม);letter-spacing:.02em}
tbody tr:last-child td{border-bottom:0}
td.เลข,th.เลข{text-align:right;font-variant-numeric:tabular-nums}
tbody tr:hover{background:var(--พื้นหลัง)}
.ว่าง{color:var(--จาง);padding:36px 0;text-align:center;font-size:14px}

/* ฟอร์ม */
input,select,textarea{width:100%;padding:9px 12px;border:1px solid var(--เส้นเข้ม);
  border-radius:8px;font-family:inherit;font-size:14px;background:#fff;color:inherit}
input:focus,select:focus,textarea:focus{outline:2px solid var(--เน้น);outline-offset:-1px;
  border-color:var(--เน้น)}
textarea{min-height:150px;resize:vertical;line-height:1.7}
label{display:block;margin-bottom:14px}
label .ชื่อช่อง{display:block;font-weight:600;font-size:14px;margin-bottom:4px}
label .ช่วย{display:block;color:var(--รอง);font-size:13px;margin-bottom:5px}
button,.ปุ่ม{background:var(--เน้น);color:#fff;border:0;border-radius:8px;
  padding:9px 18px;font-family:inherit;font-size:14px;font-weight:500;cursor:pointer;
  text-decoration:none;display:inline-block;transition:background .12s}
button:hover,.ปุ่ม:hover{background:var(--เน้นเข้ม)}
button.รอง{background:#fff;color:var(--ตัวอักษร);border:1px solid var(--เส้นเข้ม)}
button.รอง:hover{background:var(--พื้นหลัง)}
button.อันตราย{background:var(--อันตราย)}
.แถวปุ่ม{display:flex;gap:10px;align-items:center;flex-wrap:wrap;margin-top:6px}

/* แถบแจ้งสถานะ ใช้สีคู่กับข้อความเสมอ ไม่ใช้สีอย่างเดียวสื่อความหมาย */
.แจ้ง{padding:12px 15px;border-radius:9px;margin-bottom:18px;font-size:14px}
.แจ้ง.ดี{background:#f1f6f2;color:var(--ดี);border:1px solid #cfe0d2}
.แจ้ง.เตือน{background:#fbf5ea;color:var(--เตือน);border:1px solid #ecdcbf}
.แจ้ง.ผิด{background:#fbf1f0;color:var(--อันตราย);border:1px solid #edd2ce}

.ป้ายเล็ก{display:inline-block;padding:2px 9px;border-radius:20px;font-size:12px;
  background:var(--พื้นหลัง);border:1px solid var(--เส้น);color:var(--รอง)}
.ป้ายเล็ก.คำนวณ{background:var(--เน้นอ่อน);border-color:#e0cfbe;color:var(--เน้น)}
.ป้ายเล็ก.ยืนยันแล้ว{background:#f1f6f2;border-color:#cfe0d2;color:var(--ดี)}
.ป้ายเล็ก.ยังไม่ยืนยัน{background:#fbf5ea;border-color:#ecdcbf;color:var(--เตือน)}
.ว่างในตาราง{color:var(--เส้นเข้ม)}
.เตือนยาว{color:var(--เตือน);font-weight:700;cursor:help}
form.ป้ายฟอร์ม{display:inline;margin:0}
button.ป้ายเล็ก{cursor:pointer;font-family:inherit;line-height:1.6}
button.ป้ายเล็ก:hover{filter:brightness(.96)}
.แท่ง{height:7px;background:var(--พื้นหลัง);border-radius:4px;overflow:hidden;min-width:70px}
.แท่ง>i{display:block;height:100%;background:var(--เน้น)}
.บันทึกท้าย{color:var(--จาง);font-size:13px;margin-top:10px;line-height:1.7}

fieldset.ช่องเลือก{border:0;padding:0;margin:0 0 14px}
fieldset.ช่องเลือก legend{padding:0;font-weight:600;font-size:14px;margin-bottom:4px}
label.ตัวเลือก{display:flex;gap:10px;align-items:flex-start;margin:0 0 8px;
  border:1px solid var(--เส้น);border-radius:9px;padding:11px 13px;cursor:pointer}
label.ตัวเลือก:hover{background:var(--พื้นหลัง)}
label.ตัวเลือก input{width:auto;margin-top:4px;flex:none}
label.ตัวเลือก strong{display:block;font-size:14px}
label.ตัวเลือก em{display:block;color:var(--รอง);font-size:13px;font-style:normal}

.แถวกรอง{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.แถวกรอง input{flex:2 1 220px}
.แถวกรอง select{flex:1 1 180px}
.แถวกรอง button,.แถวกรอง .ปุ่ม{flex:none}

/* -----------------------------------------------------------------------
   กราฟเส้นพร้อมพื้นที่ใต้เส้น
   -----------------------------------------------------------------------
   ไม่กำหนดความสูงตายตัว ปล่อยให้สูงตามอัตราส่วนของ viewBox
   ถ้าบังคับความสูงคู่กับความกว้างเต็ม ภาพจะถูกยืดและตัวหนังสือจะบิด
   ซึ่งเป็นสาเหตุที่ป้ายแกนของเวอร์ชันก่อนทับกันจนอ่านไม่ออก

   เส้นข้อมูลหนา 2.5 จุด เข้มที่สุดในภาพ
   พื้นที่ใต้เส้นจางมากเพราะมีหน้าที่บอกปริมาณคร่าว ๆ ไม่ใช่ให้อ่านค่า
   เส้นตารางจางกว่าทั้งคู่ เพราะเป็นแค่ไม้บรรทัดช่วยกะระดับ */
svg.กราฟเส้น{width:100%;height:auto;display:block;overflow:visible}
svg.กราฟเส้น .พื้นที่ใต้เส้น{fill:var(--เน้น);opacity:.10}
svg.กราฟเส้น .เส้นกราฟ{fill:none;stroke:var(--เน้น);stroke-width:2.5;
  stroke-linejoin:round;stroke-linecap:round}
svg.กราฟเส้น .จุดกราฟ{fill:var(--การ์ด);stroke:var(--เน้น);stroke-width:2.5;
  transition:r .12s}
svg.กราฟเส้น .จุดกราฟ.ล่าสุด{fill:var(--เน้น)}
svg.กราฟเส้น .จุดกราฟ:hover{r:7}
svg.กราฟเส้น .เส้นอ้างอิง{stroke:var(--เส้น);stroke-width:1}
svg.กราฟเส้น .เส้นอ้างอิง.เส้นฐาน{stroke:var(--เส้นเข้ม)}
svg.กราฟเส้น .ป้ายแกน{fill:var(--จาง);font-size:12px;font-family:inherit}
/* ป้ายค่าใช้สีตัวอักษร ไม่ใช่สีของเส้น เพราะตัวเลขเป็นข้อความที่ต้องอ่าน
   ไม่ใช่สัญลักษณ์ที่ต้องจับคู่กับสีของชุดข้อมูล */
svg.กราฟเส้น .ป้ายค่า{fill:var(--รอง);font-size:12.5px;font-family:inherit}
svg.กราฟเส้น .ป้ายค่า.ล่าสุด{fill:var(--เน้น);font-weight:700}

/* แถบเลือกมุมมองเหนือกราฟ ให้ดูเป็นกลุ่มเดียวกัน ไม่ใช่ปุ่มลอย ๆ */
.แถวเลือก{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px}
.แถวเลือก a{font-size:14px;padding:6px 14px;border-radius:8px;text-decoration:none;
  border:1px solid var(--เส้น);color:var(--รอง);background:var(--การ์ด)}
.แถวเลือก a:hover{background:var(--พื้นหลัง);color:var(--ตัวอักษร)}
.แถวเลือก a.เลือกอยู่{background:var(--เน้น);border-color:var(--เน้น);color:#fff;font-weight:500}

th a.หัวเรียง{color:var(--รอง);text-decoration:none;display:inline-block;white-space:nowrap}
th a.หัวเรียง:hover{color:var(--เน้น)}
th a.หัวเรียง.กำลังเรียง{color:var(--เน้น);font-weight:700}

/* กราฟแท่งแนวนอน วาดด้วย CSS ล้วน ใช้เทียบหมวดที่ชื่อยาว */
.กราฟ{display:grid;grid-template-columns:minmax(110px,auto) 1fr minmax(56px,auto);
  gap:9px 14px;align-items:center;font-size:14px}
.กราฟ .ชื่อแกน{color:var(--รอง);white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.กราฟ .แท่ง{height:18px;border-radius:5px}
.กราฟ .ค่าท้าย{text-align:right;font-variant-numeric:tabular-nums;font-weight:600}
.กราฟ .แท่ง>i{transition:width .2s}

@media (max-width:640px){
  main{padding:20px 16px 48px}
  .การ์ด{padding:18px 16px}
  h1{font-size:21px}
  .ตัวเลข .ค่า{font-size:27px}
}
`;


// ---------------------------------------------------------------------------
//  แถบเมนู
// ---------------------------------------------------------------------------
//  หน้า "ความรู้ที่ยังขาด" ถูกถอดออกจากแถบเมนูเมื่อ 13 กันยายน 2569
//  แล้วถอดออกจากหน้าเว็บทั้งหมดเมื่อ 1 ตุลาคม 2569
//
//  เหตุผลที่ถอดออกทั้งหมด ตัวเลขบนการ์ดนับเฉพาะการค้นที่ไม่เจออะไรเลย
//  ไม่ได้นับการค้นที่เจอเอกสารแต่เป็นเอกสารผิดเรื่อง เลข 0 จึงอ่านได้ว่าฐานความรู้ครบแล้ว
//  ทั้งที่ไม่ได้แปลอย่างนั้น เป็นตัวเลขที่ให้ความมั่นใจเกินกว่าที่มันวัดได้จริง
//
//  การเก็บข้อมูลลงตาราง knowledge_gaps ยังทำงานตามเดิมทุกอย่าง
//  ถอดเฉพาะส่วนที่แสดงผลบนหน้าเว็บ ถ้าอยากดูข้อมูลให้สอบถามจากฐานข้อมูลโดยตรง
const เมนู = [
  ['/', 'ภาพรวม'],
  ['/knowledge', 'ฐานข้อมูล'],
  ['/feedback', 'ความพึงพอใจ'],
  ['/reports', 'รายงานจากผู้ใช้'],
];

function หน้า({ title, active, body }) {
  const ลิงก์ = เมนู
    .map(([u, n]) => `<a href="${u}"${u === active ? ' class="active"' : ''}>${n}</a>`)
    .join('');
  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} · หลังบ้านระบบที่ปรึกษาภาษี</title>
<style>${CSS}</style></head>
<body>
<header><div class="แถบ">
  <span class="ชื่อ">หลังบ้านระบบที่ปรึกษาภาษี</span>
  ${ลิงก์}
  <span class="ขวา"><a href="/logout">ออกจากระบบ</a></span>
</div></header>
<main>${body}</main>
</body></html>`;
}

/** หน้าล็อกอิน แยกออกมาเพราะไม่ควรมีเมนูให้กดตอนยังไม่ได้ยืนยันตัวตน */
function หน้าล็อกอิน(ข้อผิดพลาด) {
  return `<!doctype html>
<html lang="th"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>เข้าสู่ระบบ · หลังบ้านระบบที่ปรึกษาภาษี</title>
<style>${CSS}
body{display:flex;align-items:center;justify-content:center;min-height:100vh}
.กล่อง{width:100%;max-width:380px}</style></head>
<body><div class="กล่อง">
  <div class="การ์ด">
    <h1>เข้าสู่ระบบ</h1>
    <p class="คำอธิบาย">สำหรับผู้ดูแลระบบเท่านั้น</p>
    ${ข้อผิดพลาด ? `<div class="แจ้ง ผิด">${esc(ข้อผิดพลาด)}</div>` : ''}
    <form method="post" action="/login">
      <label>
        <span class="ชื่อช่อง">รหัสผ่าน</span>
        <input type="password" name="password" autofocus required autocomplete="current-password">
      </label>
      <button type="submit">เข้าสู่ระบบ</button>
    </form>
  </div>
  <p class="บันทึกท้าย">
    หน้านี้ไม่แสดงประวัติการสนทนาของผู้ใช้ ไม่ว่ากรณีใด
    บัญชีฐานข้อมูลที่ใช้ถูกเพิกถอนสิทธิ์อ่านตารางบทสนทนาไว้แล้ว
  </p>
</div></body></html>`;
}

module.exports = { esc, เลข, เป็นวันที่, วันที่สั้น, วันที่เต็ม, หน้า, หน้าล็อกอิน };
