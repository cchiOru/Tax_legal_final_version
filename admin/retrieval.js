'use strict';
/**
 * จำลองการค้นข้อมูลแบบเดียวกับระบบจริง สำหรับปุ่มทดลองค้น
 * ต้องจำลองเพราะต้องรวมรายการที่ยังไม่บันทึกเข้าไปด้วย
 * ตรรกะต้องตรงกับระบบจริงเสมอ: ค่าคงที่อ่านจากไฟล์เวิร์กโฟลว์ตัวเดียวกัน
 * และ tests/test-admin-retrieval.js เทียบผลกับตัวจำลองในชุดวัดผล
 */

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');

// โหลด ./db ตอนใช้ ชุดทดสอบจึงรันได้โดยไม่ต้องมี pg
function db() {
  return require('./db');
}

function โหลดเวิร์กโฟลว์() {
  return JSON.parse(
    fs.readFileSync(path.join(ROOT, 'n8n', 'workflows', 'tax-advisor-workflow.json'), 'utf8')
  );
}

/**
 * อ่านตารางคำสำคัญจากโหนด Search Tax Knowledge ในเวิร์กโฟลว์จริง
 * (ที่เดียวกับที่ evaluation/run-accuracy-test.js อ่าน)
 */
function โหลดตารางคำสำคัญ() {
  const โหนด = โหลดเวิร์กโฟลว์().nodes.find((n) => n.name === 'Search Tax Knowledge');
  const m = /var map = (\[[\s\S]*?\]); var tbl/.exec(
    โหนด.parameters.options.queryReplacement
  );
  if (!m) throw new Error('อ่านตารางคำสำคัญจากโหนด Search Tax Knowledge ไม่ได้');
  return JSON.parse(m[1]);
}

// ---- รองรับคำสะกดผิด ----
// ต้องตรงกับ KEYWORD_EXPRESSION ใน n8n/build-workflow.py และ retrieve() ใน evaluation/run-accuracy-test.js
const กลุ่มพยัญชนะพ้องเสียง = [
  ['ส', 'ศ', 'ษ', 'ซ'],
  ['พ', 'ภ', 'ผ'],
  ['ท', 'ธ', 'ฑ', 'ฒ', 'ถ', 'ฐ'],
  ['ค', 'ข', 'ฆ', 'ฃ', 'ฅ'],
  ['น', 'ณ'],
  ['ล', 'ฬ'],
  ['ด', 'ฎ'],
  ['ต', 'ฏ'],
  ['ย', 'ญ'],
  ['ช', 'ฌ', 'ฉ'],
  ['บ', 'ป'],
];
const ตารางพ้องเสียง = {};
for (const กลุ่ม of กลุ่มพยัญชนะพ้องเสียง) {
  for (const ตัว of กลุ่ม) ตารางพ้องเสียง[ตัว] = กลุ่ม[0];
}
const ความยาวต่ำสุดที่ปรับรูปได้ = 4;

/** ยุบพยัญชนะพ้องเสียงให้เหลือตัวแทนกลุ่ม โดยไม่แตะวรรณยุกต์ */
function ปรับรูปพ้องเสียง(s) {
  let out = '';
  const t = s || '';
  for (let i = 0; i < t.length; i++) out += ตารางพ้องเสียง[t[i]] || t[i];
  return out;
}

/** แปลงคำถามเป็นรายการคำค้น ด้วยตรรกะเดียวกับระบบจริง */
function หาคำค้น(คำถาม, ตารางคำสำคัญ) {
  const q = String(คำถาม || '').toLowerCase();
  const qn = ปรับรูปพ้องเสียง(q);
  const คำค้น = [];
  for (const [ตัวดัก, คำ] of ตารางคำสำคัญ) {
    let เจอ = q.indexOf(ตัวดัก) >= 0;
    if (!เจอ && ตัวดัก.length >= ความยาวต่ำสุดที่ปรับรูปได้) {
      เจอ = qn.indexOf(ปรับรูปพ้องเสียง(ตัวดัก)) >= 0;
    }
    if (เจอ && คำค้น.indexOf(คำ) < 0) คำค้น.push(คำ);
  }
  return คำค้น.length ? คำค้น : ['ภาษี'];
}

/** อ่านงบความยาวบริบทจากโหนด Build Context */
function โหลดงบบริบท() {
  const code = โหลดเวิร์กโฟลว์().nodes.find((n) => n.name === 'Build Context').parameters.jsCode;
  const m = code.match(/const CONTEXT_BUDGET_EXPLAIN = (\d+);/);
  if (!m) throw new Error('อ่านงบบริบทจากโหนด Build Context ไม่ได้');
  return Number(m[1]);
}

/** ประกอบข้อความบริบทแบบเดียวกับระบบจริง ใช้วัดความยาวให้ตรงกัน */
function ประกอบบริบท(list) {
  return list
    .map(
      (r, i) =>
        `[${i + 1}] หมวด: ${r.category}\nหัวข้อ: ${r.title}\n${r.content}\nแหล่งที่มา: ${r.source}`
    )
    .join('\n\n---\n\n');
}

/**
 * ทดลองค้นด้วยคำถามที่ผู้ดูแลพิมพ์ โดยรวมรายการที่กำลังกรอกอยู่เข้าไปด้วย
 * @param {string} คำถาม     คำถามแบบที่ผู้ใช้น่าจะถาม
 * @param {object} รายการใหม่ ค่าจากฟอร์มที่ยังไม่ได้บันทึก
 */
async function ทดลองค้น(คำถาม, รายการใหม่) {
  const ตารางคำสำคัญ = โหลดตารางคำสำคัญ();
  const งบ = โหลดงบบริบท();

  // 1. แปลงคำถามเป็นคำค้น (รองรับคำสะกดผิดเหมือนระบบจริง)
  const keys = หาคำค้น(คำถาม, ตารางคำสำคัญ);

  // 2. ดึงทุกรายการมาให้คะแนนเอง เพราะมีรายการที่ยังไม่บันทึก
  const เดิม = await db().query(
    `SELECT id, category, title, content, source FROM tax_law_knowledge`
  );

  const ผู้เข้าแข่ง = เดิม.slice();
  // ถ้ากำลังแก้รายการเดิม ให้ใช้ฉบับที่แก้แทนตัวเดิม
  const idที่แก้ = Number(รายการใหม่.id) || null;
  const เหลือ = idที่แก้ ? ผู้เข้าแข่ง.filter((r) => r.id !== idที่แก้) : ผู้เข้าแข่ง;

  เหลือ.push({
    id: idที่แก้ || -1,
    category: รายการใหม่.category || '',
    title: รายการใหม่.title || '',
    content: รายการใหม่.content || '',
    source: รายการใหม่.source || '',
    นี่คือรายการใหม่: true,
  });

  // 3. ให้คะแนนด้วยน้ำหนักเดียวกับ SQL ในระบบจริง: ชื่อเรื่อง x5 หมวด x3 เนื้อหา x1
  const ให้คะแนน = เหลือ
    .map((r) => {
      const t = String(r.title || '').toLowerCase();
      const c = String(r.category || '').toLowerCase();
      const b = String(r.content || '').toLowerCase();
      const คะแนน =
        keys.filter((k) => t.includes(k)).length * 5 +
        keys.filter((k) => c.includes(k)).length * 3 +
        keys.filter((k) => b.includes(k)).length;
      return { ...r, คะแนน };
    })
    .filter((r) => r.คะแนน > 0)
    .sort((a, b) => b.คะแนน - a.คะแนน)
    .slice(0, 3); // ระบบจริงดึงมา 3 รายการสำหรับคำถามเชิงอธิบาย

  // 4. ไล่ตามอันดับ หยิบเฉพาะที่ยังอยู่ในงบ
  const เลือกได้ = [];
  for (const r of ให้คะแนน) {
    const ลอง = เลือกได้.concat([r]);
    if (ประกอบบริบท(ลอง).length <= งบ) เลือกได้.push(r);
  }
  if (!เลือกได้.length && ให้คะแนน.length) เลือกได้.push(ให้คะแนน[0]);

  const idที่ได้เข้า = new Set(เลือกได้.map((r) => r.id));

  return {
    งบ,
    คำค้น: keys,
    รายการ: ให้คะแนน.map((r) => ({
      หัวข้อ: r.title,
      คะแนน: r.คะแนน,
      ความยาว: String(r.content || '').length,
      ได้เข้าบริบท: idที่ได้เข้า.has(r.id),
      นี่คือรายการใหม่: !!r['นี่คือรายการใหม่'],
    })),
  };
}

module.exports = { ทดลองค้น, โหลดตารางคำสำคัญ, โหลดงบบริบท, ประกอบบริบท, หาคำค้น, ปรับรูปพ้องเสียง };
