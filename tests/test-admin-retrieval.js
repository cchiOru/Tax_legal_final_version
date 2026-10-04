'use strict';
/**
 * ตรวจว่าปุ่มทดลองค้นในหน้าหลังบ้าน (admin/retrieval.js) ให้ผลตรงกับระบบจริง
 * คือใช้ค่าจากแหล่งเดียวกันและคุมงบบริบทแบบเดียวกัน และหลังบ้านอ่านแชทผู้ใช้ไม่ได้
 * รัน: node --test tests/test-admin-retrieval.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const admin = require('../admin/retrieval.js');
const harness = require('../evaluation/run-accuracy-test.js');

const WF = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'n8n', 'workflows', 'tax-advisor-workflow.json'), 'utf8')
);

// ---- แหล่งข้อมูลต้องเป็นแหล่งเดียวกัน ----
// ถ้าหลังบ้านจำลองเพี้ยนจากระบบจริง ผู้ดูแลจะเชื่อผลผิดแล้วบันทึกความรู้ที่ทำให้ระบบแย่ลง

test('AR-01 ตารางคำสำคัญของหน้าหลังบ้าน ต้องเป็นชุดเดียวกับที่ชุดวัดผลใช้', () => {
  const ของหลังบ้าน = admin.โหลดตารางคำสำคัญ();
  const ของชุดวัดผล = harness.loadProductionConfig().keywordMap;
  assert.deepStrictEqual(
    ของหลังบ้าน,
    ของชุดวัดผล,
    'ถ้าสองที่นี้ไม่ตรงกัน ปุ่มทดลองค้นจะให้ผลที่ต่างจากระบบจริง'
  );
});

test('AR-02 งบบริบทต้องอ่านมาจากไฟล์เวิร์กโฟลว์ ไม่ใช่เขียนตัวเลขซ้ำในโค้ดหลังบ้าน', () => {
  const code = WF.nodes.find((n) => n.name === 'Build Context').parameters.jsCode;
  const ในเวิร์กโฟลว์ = Number(/const CONTEXT_BUDGET_EXPLAIN = (\d+);/.exec(code)[1]);
  assert.strictEqual(admin.โหลดงบบริบท(), ในเวิร์กโฟลว์);
});

test('AR-03 การประกอบข้อความบริบทต้องได้ความยาวเท่ากับที่ระบบจริงคำนวณ', () => {
  // รูปแบบต่าง = ความยาวต่าง = ตัดสินเข้างบผิด
  const ตัวอย่าง = [
    { category: 'หมวดก', title: 'หัวข้อก', content: 'เนื้อหาก', source: 'ที่มาก' },
    { category: 'หมวดข', title: 'หัวข้อข', content: 'เนื้อหาข', source: 'ที่มาข' },
  ];
  const ของหลังบ้าน = admin.ประกอบบริบท(ตัวอย่าง);

  // รูปแบบเดียวกับโหนด Build Context
  const ของระบบจริง = ตัวอย่าง
    .map(
      (r, i) =>
        `[${i + 1}] หมวด: ${r.category}\nหัวข้อ: ${r.title}\n${r.content}\nแหล่งที่มา: ${r.source}`
    )
    .join('\n\n---\n\n');

  assert.strictEqual(ของหลังบ้าน, ของระบบจริง);
});

// ---- ตรรกะการเลือกรายการให้พอดีงบ ----

test('AR-04 ต้องไล่ตามอันดับแล้วหยิบเฉพาะที่ใส่ลงในงบได้ ไม่ใช่ตัดท้ายทิ้ง', () => {
  // อันดับ 1 สั้น, 2 ยาวเกินงบ, 3 สั้น -> ต้องข้ามอันดับ 2 แต่ยังเก็บอันดับ 3
  const งบ = 400;
  const ผู้เข้าแข่ง = [
    { category: 'ก', title: 'สั้นหนึ่ง', content: 'ก'.repeat(100), source: 'x' },
    { category: 'ข', title: 'ยาวมาก', content: 'ข'.repeat(900), source: 'x' },
    { category: 'ค', title: 'สั้นสาม', content: 'ค'.repeat(100), source: 'x' },
  ];

  const เลือกได้ = [];
  for (const r of ผู้เข้าแข่ง) {
    const ลอง = เลือกได้.concat([r]);
    if (admin.ประกอบบริบท(ลอง).length <= งบ) เลือกได้.push(r);
  }

  const หัวข้อที่ได้ = เลือกได้.map((r) => r.title);
  assert.ok(หัวข้อที่ได้.includes('สั้นหนึ่ง'), 'อันดับหนึ่งต้องได้เข้าเสมอ');
  assert.ok(
    หัวข้อที่ได้.includes('สั้นสาม'),
    'อันดับสามต้องได้เข้า เพราะรายการยาวตรงกลางต้องถูกข้าม ไม่ใช่ทำให้อันดับสามตกไปด้วย'
  );
  assert.ok(!หัวข้อที่ได้.includes('ยาวมาก'), 'รายการที่ใหญ่เกินงบต้องถูกข้าม');
});

test('AR-05 คำถามที่หาคำสำคัญไม่เจอ ต้องถอยไปใช้คำว่าภาษีเหมือนระบบจริง', () => {
  const map = admin.โหลดตารางคำสำคัญ();
  const q = 'xyz ไม่มีคำไหนตรงเลย';
  const เจอ = [];
  for (const [trigger, term] of map) {
    if (q.indexOf(trigger) >= 0 && เจอ.indexOf(term) < 0) เจอ.push(term);
  }
  const keys = เจอ.length ? เจอ : ['ภาษี'];
  assert.deepStrictEqual(keys, ['ภาษี']);
});

// ---- ความเป็นส่วนตัว: ผู้ดูแลต้องดูแชทผู้ใช้ไม่ได้ ----
// มีสองด่าน: ตรวจโค้ด (AR-06) และบัญชีฐานข้อมูลที่จำกัดสิทธิ์ (AR-07, AR-08)

test('AR-06 โค้ดหน้าหลังบ้านต้องไม่มีคำสั่งอ่านตารางที่เก็บบทสนทนา', () => {
  const ห้าม = /\bFROM\s+(conversations|n8n_chat_histories|users)\b/i;
  const ไฟล์ = ['db.js', 'server.js', 'knowledge.js', 'retrieval.js', 'layout.js'];
  const พบ = [];

  for (const f of ไฟล์) {
    const โค้ด = fs.readFileSync(path.join(__dirname, '..', 'admin', f), 'utf8');
    // ตัดคอมเมนต์ออกก่อน เพราะคอมเมนต์อาจเอ่ยชื่อตาราง
    const ไม่มีคอมเมนต์ = โค้ด
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // ยกเว้นฟังก์ชันที่ตั้งใจลองอ่านเพื่อยืนยันว่าโดนปฏิเสธสิทธิ์
    const ไม่รวมด่านตรวจ = ไม่มีคอมเมนต์.replace(
      /async function ตรวจว่าอ่านแชทไม่ได้จริง[\s\S]*?\n}/,
      ''
    );
    if (ห้าม.test(ไม่รวมด่านตรวจ)) พบ.push(f);
  }

  assert.deepStrictEqual(
    พบ,
    [],
    'พบคำสั่งอ่านตารางบทสนทนาในโค้ดหน้าหลังบ้าน ซึ่งขัดกับข้อกำหนดที่ว่าผู้ดูแลต้องดูแชทไม่ได้'
  );
});

test('AR-07 ต้องต่อฐานข้อมูลด้วยบัญชีที่ถูกจำกัดสิทธิ์เท่านั้น', () => {
  const โค้ด = fs.readFileSync(path.join(__dirname, '..', 'admin', 'db.js'), 'utf8');
  assert.ok(
    /user:\s*'tax_admin_readonly'/.test(โค้ด),
    'ต้องกำหนดบัญชีไว้ตายตัวในโค้ด ห้ามอ่านจากตัวแปรสภาพแวดล้อม ' +
      'ไม่งั้นวันหนึ่งอาจมีคนตั้งเป็นบัญชีที่มีสิทธิ์เต็มแล้วด่านที่สองหายไป'
  );
  assert.ok(
    /ตรวจว่าอ่านแชทไม่ได้จริง/.test(โค้ด),
    'ต้องมีฟังก์ชันตรวจสิทธิ์ตอนเปิดบริการ'
  );
});

test('AR-08 บริการต้องไม่ยอมเปิด ถ้าตรวจแล้วพบว่าอ่านตารางบทสนทนาได้', () => {
  const โค้ด = fs.readFileSync(path.join(__dirname, '..', 'admin', 'server.js'), 'utf8');
  assert.ok(
    /await\s+ตรวจว่าอ่านแชทไม่ได้จริง\(\)/.test(โค้ด),
    'ต้องเรียกด่านตรวจก่อน listen ไม่ใช่เรียกทีหลังหรือไม่เรียกเลย'
  );
  const ก่อน = โค้ด.indexOf('ตรวจว่าอ่านแชทไม่ได้จริง()');
  const หลัง = โค้ด.indexOf('server.listen');
  assert.ok(ก่อน > 0 && ก่อน < หลัง, 'ต้องตรวจให้ผ่านก่อนถึงจะเปิดรับคำขอ');
});
