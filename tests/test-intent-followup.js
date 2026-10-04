'use strict';
/**
 * ตรวจการจำแนกเจตนา (n8n/intent-rules.json) โดยเฉพาะคำถามต่อเนื่อง เช่น "แล้วถ้ามีบุตร 2 คนล่ะ"
 * หลังคำถามคำนวณ ต้องยังบังคับเรียกเครื่องคำนวณ ตรวจตรรกะตรง ๆ ไม่เรียกแบบจำลองภาษา
 * รัน: node --test tests/test-intent-followup.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const RULES = JSON.parse(
  fs.readFileSync(path.join(__dirname, '..', 'n8n', 'intent-rules.json'), 'utf8')
);

/**
 * จำลองตรรกะจำแนกหมวดของโหนด Build Context
 * @param {string} question    ข้อความที่ผู้ใช้พิมพ์
 * @param {string} lastCategory หมวดของคำถามก่อนหน้าของผู้ใช้คนเดียวกัน
 */
function classify(question, lastCategory = '') {
  const q = (question || '').toLowerCase();
  let category = 'อื่นๆ';
  const hasDigit = /[0-9]/.test(q);

  // ตัวเลขที่เป็นอายุล้วน ๆ ไม่ควรทำให้คำถามกลายเป็นหมวดคำนวณ
  const digitsAreAgeOnly = !/[0-9๐-๙]/.test(q.replace(/[0-9๐-๙,]+\s*ปี/g, ''));
  const moneyWords = RULES.incomeWords.concat(['บาท']);
  const looksLikeAgeQuestion =
    hasDigit && digitsAreAgeOnly && !moneyWords.some((w) => q.indexOf(w) >= 0);

  for (const rule of RULES.intentRules) {
    if (rule.requireDigit && (!hasDigit || looksLikeAgeQuestion)) continue;
    if (rule.keywords.some((k) => q.indexOf(k) >= 0)) {
      category = rule.category;
      break;
    }
  }

  if (category === 'อื่นๆ' && hasDigit && RULES.incomeWords.some((k) => q.indexOf(k) >= 0)) {
    category = 'คำนวณภาษี';
  }
  if (category === 'อื่นๆ' && q.indexOf('ภาษี') >= 0) category = 'กฎหมายภาษี';

  // คำถามต่อเนื่อง: ก่อนหน้าเป็นหมวดคำนวณ + มีคำต่อยอด + มีตัวแปรคำนวณ
  if (
    RULES.calcCategories.indexOf(lastCategory) >= 0 &&
    RULES.calcCategories.indexOf(category) < 0 &&
    RULES.followupMarkers.some((m) => q.indexOf(m) >= 0) &&
    RULES.calcVariableWords.some((w) => q.indexOf(w) >= 0)
  ) {
    category = 'คำนวณภาษี';
  }
  return category;
}

const ต้องเรียกเครื่องคำนวณ = (c) => RULES.calcCategories.indexOf(c) >= 0;

// ---- คำถามต่อยอดต้องบังคับเรียกเครื่องคำนวณ ----

test('IF-01 คำถามตั้งต้นเรื่องคำนวณต้องถูกบังคับให้เรียกเครื่องคำนวณ', () => {
  const c = classify('เงินเดือน 50,000 บาทต่อเดือน ประกันสังคม 9,000 บาท ต้องเสียภาษีเท่าไหร่');
  assert.strictEqual(c, 'คำนวณภาษี');
  assert.ok(ต้องเรียกเครื่องคำนวณ(c));
});

test('IF-02 คำถามต่อยอดที่เคยตอบผิด ต้องถูกบังคับให้เรียกเครื่องคำนวณ', () => {
  const c = classify('แล้วถ้ามีบุตร 2 คนล่ะ', 'คำนวณภาษี');
  assert.ok(
    ต้องเรียกเครื่องคำนวณ(c),
    `ได้หมวด ${c} ซึ่งไม่บังคับเรียกเครื่องคำนวณ นี่คือบั๊กเดิมที่ทำให้ตอบ 13,400 แทน 14,600`
  );
});

test('IF-03 คำถามต่อยอดแบบอื่นก็ต้องถูกบังคับเหมือนกัน', () => {
  const ถามต่อ = [
    'แล้วถ้ามีคู่สมรสไม่มีรายได้ล่ะ',
    'ถ้าซื้อ RMF 100,000 บาทล่ะ',
    'แล้วถ้าเพิ่มประกันชีวิต 50,000 ล่ะ',
    'สมมติมีบิดามารดา 2 คนด้วย',
    'เปลี่ยนเป็นเงินเดือน 80,000 ล่ะ',
  ];
  for (const q of ถามต่อ) {
    const c = classify(q, 'คำนวณภาษี');
    assert.ok(ต้องเรียกเครื่องคำนวณ(c), `"${q}" ได้หมวด ${c}`);
  }
});

test('IF-04 คำถามต่อยอดหลังคำถามบทลงโทษก็ต้องถูกบังคับ', () => {
  const c = classify('แล้วถ้ายื่นช้า 12 เดือนล่ะ', 'บทลงโทษ');
  assert.ok(ต้องเรียกเครื่องคำนวณ(c));
});

// ---- ต้องไม่กระทบคำถามเชิงความรู้ ----
// กันกฎดักกว้างเกินจนคำถามความรู้ถูกบังคับเรียกเครื่องคำนวณโดยไม่จำเป็น

test('IF-05 คำถามความรู้ที่มีคำเดียวกันแต่ไม่ใช่คำถามต่อเนื่อง ต้องไม่ถูกเปลี่ยนหมวด', () => {
  const ความรู้ = [
    ['ค่าลดหย่อนบุตรได้เท่าไหร่', 'สิทธิ์ลดหย่อน'],
    ['ซื้อกองทุน SSF ลดหย่อนได้สูงสุดเท่าไหร่', 'สิทธิ์ลดหย่อน'],
    ['ประกันสังคมลดหย่อนได้เท่าไหร่', 'สิทธิ์ลดหย่อน'],
    ['คู่สมรสไม่มีรายได้ลดหย่อนได้เท่าไหร่', 'สิทธิ์ลดหย่อน'],
  ];
  for (const [q, คาดหวัง] of ความรู้) {
    assert.strictEqual(classify(q, ''), คาดหวัง, `"${q}" ถูกจัดหมวดผิด`);
  }
});

test('IF-06 คำถามความรู้ต้องไม่ถูกเปลี่ยนหมวด แม้คำถามก่อนหน้าจะเป็นการคำนวณ', () => {
  // ไม่มีคำต่อยอด จึงเป็นการเปลี่ยนเรื่อง ไม่ใช่คำถามต่อเนื่อง
  const c = classify('ค่าลดหย่อนบุตรได้เท่าไหร่', 'คำนวณภาษี');
  assert.strictEqual(c, 'สิทธิ์ลดหย่อน');
});

test('IF-07 คำถามที่มีคำต่อยอดแต่ไม่มีตัวแปรคำนวณ ต้องไม่ถูกเปลี่ยนหมวด', () => {
  const c = classify('แล้วถ้ายื่นผ่านเว็บไซต์ล่ะ', 'คำนวณภาษี');
  assert.ok(!ต้องเรียกเครื่องคำนวณ(c), `ได้หมวด ${c} ซึ่งไม่ควรบังคับเรียกเครื่องคำนวณ`);
});

test('IF-08 ไม่มีบทสนทนาก่อนหน้า ต้องจำแนกตามข้อความปัจจุบันเท่านั้น', () => {
  // เช่นผู้ใช้ที่ไม่ยินยอมซึ่งไม่มีประวัติ
  const c = classify('แล้วถ้ามีบุตร 2 คนล่ะ', '');
  assert.strictEqual(c, 'สิทธิ์ลดหย่อน');
});

// ---- ชุดคำถามทดสอบเดิมต้องไม่เปลี่ยนหมวด ----

test('IF-09 คำถามทั้ง 115 ข้อในชุดทดสอบต้องได้หมวดเดิมทุกข้อ', () => {
  const ds = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'evaluation', 'test-questions-official.json'), 'utf8')
  );
  let เปลี่ยน = 0;
  for (const q of ds.questions) {
    const ไม่มีบริบท = classify(q.question, '');
    const มีบริบท = classify(q.question, 'คำนวณภาษี');
    if (ไม่มีบริบท !== มีบริบท) {
      เปลี่ยน++;
      console.log(`    ${q.id} "${q.question}" : ${ไม่มีบริบท} -> ${มีบริบท}`);
    }
  }
  assert.strictEqual(
    เปลี่ยน,
    0,
    'มีคำถามที่หมวดเปลี่ยนเมื่อมีบริบทก่อนหน้า แปลว่ากฎดักกว้างเกินไป'
  );
});
