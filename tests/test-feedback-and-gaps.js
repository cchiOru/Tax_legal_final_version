'use strict';
/**
 * ทดสอบโหนดในเวิร์กโฟลว์ n8n ที่ป้อนข้อมูลให้หน้าหลังบ้าน (knowledge_gaps, answer_feedback, รายงาน)
 * และตัวดักข้อความก่อนเรียกแบบจำลอง (คำทักทาย, คำถามกว้าง, ปุ่ม Rich Menu, อิโมจิ)
 * ไม่ได้รัน SQL จริง ส่วนนั้นตรวจด้วย postgres/ตรวจ-เส้นทางข้อมูลหลังบ้าน.sql
 * รัน: node --test tests/test-feedback-and-gaps.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WORKFLOW = path.join(ROOT, 'n8n', 'workflows', 'tax-advisor-workflow.json');
const wf = JSON.parse(fs.readFileSync(WORKFLOW, 'utf8'));

function โหนด(ชื่อ) {
  const n = wf.nodes.find((x) => x.name === ชื่อ);
  assert.ok(n, `ไม่พบโหนดชื่อ "${ชื่อ}" ในไฟล์เวิร์กโฟลว์`);
  return n;
}

function ปลายทางของ(ชื่อ, สาย = 0) {
  const c = wf.connections[ชื่อ];
  if (!c || !c.main || !c.main[สาย]) return [];
  return c.main[สาย].map((x) => x.node);
}

// ---- เส้นทางที่ 1: บันทึกคำที่ค้นไม่เจอ (knowledge_gaps) ----

test('FG-01 ต้องมีโหนดบันทึกคำที่ค้นไม่เจอ และต่อจากโหนดเตรียมคำตอบ', () => {
  const n = โหนด('Log Knowledge Gap');
  assert.strictEqual(n.type, 'n8n-nodes-base.postgres');
  assert.ok(
    ปลายทางของ('Prepare LINE Reply').includes('Log Knowledge Gap'),
    'โหนดนี้ต้องต่อจาก Prepare LINE Reply ขนานกับการบันทึกบทสนทนา'
  );
  assert.strictEqual(
    n.onError,
    'continueRegularOutput',
    'บันทึกไม่สำเร็จต้องไม่กระทบการตอบผู้ใช้'
  );
});

test('FG-02 คำสั่งบันทึกต้องไม่แทรกแถวเมื่อไม่มีคำที่ค้นไม่เจอ', () => {
  const sql = โหนด('Log Knowledge Gap').parameters.query;
  assert.match(sql, /WHERE \$1::varchar IS NOT NULL/,
    'ต้องมีเงื่อนไขกันไม่ให้แทรกแถวว่างเมื่อค้นเจอข้อมูลแล้ว');
  // ค่าเป็น null ล้วน PostgreSQL เดาชนิดไม่ได้ ต้องระบุชนิดไว้
  assert.match(sql, /\$1::varchar/, 'ต้องระบุชนิดข้อมูลของพารามิเตอร์');
  assert.match(sql, /ON CONFLICT \(keyword\) DO UPDATE/,
    'คำเดิมที่เจอซ้ำต้องเพิ่มตัวนับ ไม่ใช่แทรกแถวใหม่');
  assert.match(sql, /hit_count\s*=\s*knowledge_gaps\.hit_count \+ 1/);
});

test('FG-03 คำสั่งบันทึกช่องว่าง ต้องไม่แตะข้อมูลที่ระบุตัวผู้ใช้', () => {
  const n = โหนด('Log Knowledge Gap');
  const ทั้งโหนด = JSON.stringify(n);
  for (const ต้องห้าม of ['user_id', 'lineUserId', 'userMessage', 'line_user_id']) {
    assert.ok(
      !ทั้งโหนด.includes(ต้องห้าม),
      `โหนดนี้ต้องไม่อ้างถึง ${ต้องห้าม} เพราะจะทำให้ย้อนกลับไปหาว่าใครถามได้`
    );
  }
});

test('FG-04 คำที่ค้นไม่เจอต้องเป็นคำเดี่ยว ไม่ใช่ประโยคที่ผู้ใช้พิมพ์', () => {
  // ตรวจที่ต้นทาง (Build Context) ถ้าส่งทั้งประโยคมา ตารางจะกลายเป็นที่เก็บข้อความผู้ใช้
  const code = โหนด('Build Context').parameters.jsCode;
  assert.match(code, /missingKeyword = พบ\[0\] \|\| null/,
    'ต้องเลือกคำสำคัญคำเดียวจากรายการที่ดักได้ ไม่ใช่ส่งข้อความของผู้ใช้');
  assert.ok(
    !/missingKeyword\s*=\s*question/.test(code),
    'ห้ามกำหนดคำที่ค้นไม่เจอเป็นข้อความที่ผู้ใช้พิมพ์'
  );
});

// ---- เส้นทางที่ 2: ปุ่มให้คะแนนคำตอบ (answer_feedback) และปุ่มรายงาน ----

/** รันโค้ดของโหนดแกะข้อมูลปุ่ม โดยจำลองสภาพแวดล้อมของ n8n */
function รันแกะข้อมูลปุ่ม(ข้อมูลปุ่ม, replyToken = 'TOKEN-FB') {
  const code = โหนด('Parse Feedback').parameters.jsCode;
  const $input = {
    first: () => ({
      json: { body: { events: [{ type: 'postback', replyToken, postback: { data: ข้อมูลปุ่ม } }] } },
    }),
  };
  const fn = new Function('$input', code);
  return fn($input)[0].json;
}

test('FG-05 เส้นทางปุ่มต้องแยกจากเส้นทางความยินยอม', () => {
  assert.deepStrictEqual(
    ปลายทางของ('Filter: Postback Event'),
    ['Check Postback Type'],
    'ทุก postback ต้องผ่านตัวแยกชนิดก่อน ไม่ใช่วิ่งเข้าบันทึกความยินยอมตรง ๆ'
  );
  assert.deepStrictEqual(ปลายทางของ('Check Postback Type', 0), ['Parse Feedback']);
  // ทางเท็จต้องผ่านตัวแยกปุ่มรายงานก่อน แล้วปุ่มยินยอมเป็นทางเท็จของชั้นนั้น
  assert.deepStrictEqual(ปลายทางของ('Check Postback Type', 1), ['Check Report Postback']);
  assert.deepStrictEqual(ปลายทางของ('Check Report Postback', 1), ['Save Consent']);
  assert.deepStrictEqual(ปลายทางของ('Parse Feedback'), ['Save Feedback']);
  assert.deepStrictEqual(ปลายทางของ('Save Feedback'), ['Send Feedback Thanks']);
});

test('FG-26 ปุ่มรายงาน ต้องแยกออกจากปุ่มยินยอมแล้วไปบันทึกโดยตรง', () => {
  assert.deepStrictEqual(
    ปลายทางของ('Check Report Postback', 0),
    ['Save Report'],
    'ปุ่มรายงานต้องถูกแยกออกจากปุ่มยินยอมแล้วไปบันทึกทันที'
  );
  assert.deepStrictEqual(
    ปลายทางของ('Check Report Postback', 1),
    ['Save Consent'],
    'ทางเท็จต้องเป็นปุ่มตอบเรื่องความยินยอม'
  );
  assert.deepStrictEqual(ปลายทางของ('Save Report'), ['Send Report Result']);
});
test('FG-27 คำสั่งบันทึกรายงาน ต้องบันทึกได้แม้ผู้ใช้ไม่ยินยอมให้เก็บประวัติ', () => {
  const q = โหนด('Save Report').parameters.query;
  // ถ้า INSERT ... SELECT จาก conversations ตรง ๆ ผู้ใช้ที่ไม่ยินยอม (ไม่มีประวัติ) รายงานจะหายเงียบ
  assert.ok(/LEFT JOIN LATERAL/i.test(q), 'ต้องใช้ LEFT JOIN LATERAL เพื่อให้ได้หนึ่งแถวเสมอ');
  assert.ok(
    /WHERE \$2::text IN \('not_match', 'cannot', 'wrong_info'\)/.test(q),
    'ต้องกรองค่าที่ไม่ได้มาจากปุ่มของระบบเอง เพราะข้อมูลใน postback มาจากฝั่งผู้ใช้'
  );
});

test('FG-28 ต้องไม่เหลือร่องรอยของโหมดคุยกับแอดมินในเวิร์กโฟลว์', () => {
  // โหมดนี้ถอดออกแล้ว ถ้าเพิ่มกลับโดยไม่มีทางออก ผู้ใช้จะติดค้างในโหมดนั้น
  for (const ชื่อ of [
    'Check Support Postback',
    'Start Human Support',
    'Read Human Support',
    'Is Human Support Active',
  ]) {
    assert.strictEqual(
      wf.nodes.find((n) => n.name === ชื่อ),
      undefined,
      `โหนด ${ชื่อ} ถูกถอดออกไปแล้ว ไม่ควรกลับมา`
    );
  }
  const ดิบ = JSON.stringify(wf);
  assert.ok(ดิบ.indexOf('support=') < 0, 'ต้องไม่เหลือปุ่มหรือเงื่อนไขที่ใช้คำขึ้นต้น support=');
  assert.ok(ดิบ.indexOf('human_support_until') < 0, 'ต้องไม่มีโหนดไหนอ่านหรือเขียนคอลัมน์นี้อีก');
});
test('FG-06 เงื่อนไขแยกชนิดปุ่ม ต้องดูจากคำขึ้นต้นของข้อมูล', () => {
  const c = โหนด('Check Postback Type').parameters.conditions.conditions[0];
  assert.strictEqual(c.rightValue, 'fb=');
  assert.strictEqual(c.operator.operation, 'startsWith');
  // ห้ามใช้ contains: ข้อมูลปุ่มยินยอมที่บังเอิญมี fb= จะหลุดเข้ามา
  assert.notStrictEqual(c.operator.operation, 'contains');
});

/** รันโค้ดโหนดเตรียมคำตอบ โดยกำหนดได้ว่ารอบนี้ถึงเวลาถามความเห็นหรือยัง */
function รันเตรียมคำตอบ(ถึงรอบถาม) {
  const code = โหนด('Prepare LINE Reply').parameters.jsCode;
  const ข้อมูลโหนด = {
    'Extract LINE Data': {
      replyToken: 'T', lineUserId: 'U1', userMessage: 'ลดหย่อนบุตร', receivedAt: Date.now() - 1000,
    },
    'Upsert User': { id: 9, ask_feedback: ถึงรอบถาม },
    'Build Context': { matchedKnowledge: 'x', knowledgeHits: 2, questionCategory: 'สิทธิ์ลดหย่อน' },
  };
  const เข้าถึงโหนด = (ชื่อ) => ({ first: () => ({ json: ข้อมูลโหนด[ชื่อ] }) });
  const $input = {
    first: () => ({
      json: {
        output:
          'ลดหย่อนบุตรคนละ 30,000 บาทต่อปีค่ะ ' +
          'ข้อมูลนี้เป็นคำแนะนำเบื้องต้น ควรตรวจสอบกับกรมสรรพากรอีกครั้ง',
      },
    }),
  };
  return new Function('$input', '$', '$env', code)($input, เข้าถึงโหนด, {})[0].json;
}

test('FG-07 ถึงรอบถามความเห็น ปุ่มต้องแนบทั้งทางReply และทาง push', () => {
  const r = รันเตรียมคำตอบ(true);
  const ทางReply = r.linePayload.messages[0];
  assert.ok(ทางReply.quickReply, 'ไม่มีปุ่มในข้อความที่ส่งทางReply');
  assert.deepStrictEqual(
    r.pushPayload.messages[0],
    ทางReply,
    'ข้อความที่ส่งสองทางต้องเหมือนกันทุกประการ'
  );
  const ป้าย = ทางReply.quickReply.items.map((i) => i.action.label);
  assert.deepStrictEqual(ป้าย, ['ตรงคำถาม', 'ยังไม่ตรง']);
});

test('FG-07ก ยังไม่ถึงรอบ ต้องไม่มีคีย์ quickReply เลย ไม่ใช่ใส่เป็นค่าว่าง', () => {
  // quickReply เป็น null LINE จะปฏิเสธทั้งข้อความ ผู้ใช้จะไม่ได้คำตอบ
  for (const กรณี of [false, undefined]) {
    const m = รันเตรียมคำตอบ(กรณี).linePayload.messages[0];
    assert.ok(
      !Object.prototype.hasOwnProperty.call(m, 'quickReply'),
      `กรณี ask_feedback = ${กรณี} ยังมีคีย์ quickReply ติดมาด้วย`
    );
    assert.ok(m.text && m.text.length > 0, 'คำตอบต้องยังส่งถึงผู้ใช้ตามปกติ');
  }
});

test('FG-07ข ยังไม่ได้รัน migration 008 ต้องไม่ถามความเห็น แทนที่จะถามทุกครั้ง', () => {
  // ยังไม่มีคอลัมน์ ask_feedback ค่าจะเป็น undefined ต้องตีความว่าไม่ถาม
  const code = โหนด('Prepare LINE Reply').parameters.jsCode;
  assert.match(
    code,
    /ask_feedback === true/,
    'ต้องเทียบกับค่าจริงแบบเข้มงวด ไม่ใช่ใช้ค่าความจริงโดยปริยาย'
  );
});

test('FG-08 ป้ายปุ่มต้องไม่เกิน 20 ตัวอักษรตามข้อจำกัดของ LINE', () => {
  const code = โหนด('Prepare LINE Reply').parameters.jsCode;
  for (const m of code.matchAll(/label: '([^']+)'/g)) {
    assert.ok(m[1].length <= 20, `ป้าย "${m[1]}" ยาว ${m[1].length} ตัวอักษร เกินที่ LINE รับได้`);
  }
});

test('FG-09 แกะข้อมูลปุ่มได้ถูกต้องเมื่อค่าครบ', () => {
  const r = รันแกะข้อมูลปุ่ม('fb=1&c=2&h=3&t=2100');
  assert.strictEqual(r['ตรงคำถาม'], true);
  assert.strictEqual(r['จำนวนที่ค้นเจอ'], 3);
  assert.strictEqual(r['เวลาที่ใช้ตอบ'], 2100);
  assert.strictEqual(r.replyToken, 'TOKEN-FB');
  assert.ok(r['หมวด'], 'ต้องแปลลำดับหมวดกลับเป็นชื่อหมวดได้');
});

test('FG-10 กดว่ายังไม่ตรง ต้องบันทึกเป็นเท็จ ไม่ใช่ค่าว่าง', () => {
  const r = รันแกะข้อมูลปุ่ม('fb=0&c=0&h=0&t=800');
  assert.strictEqual(r['ตรงคำถาม'], false);
  assert.strictEqual(r['จำนวนที่ค้นเจอ'], 0, 'ค้นไม่เจอเลยคือศูนย์ ซึ่งเป็นข้อมูลที่ต้องเก็บ');
});

test('FG-11 ข้อมูลปุ่มที่ผิดรูป ต้องไม่ทำให้พัง และต้องไม่บันทึกตัวเลขมั่ว', () => {
  // ข้อมูลมาจากฝั่งผู้ใช้ อาจถูกแก้หรือส่งมั่วได้เสมอ
  const กรณี = ['fb=1', 'fb=1&c=999&h=abc&t=-5', 'fb=x', '', 'fb=1&c=-1&h=&t='];
  for (const ข้อมูล of กรณี) {
    const r = รันแกะข้อมูลปุ่ม(ข้อมูล);
    assert.ok(typeof r['ตรงคำถาม'] === 'boolean', `${ข้อมูล} ต้องได้ค่าจริงหรือเท็จเสมอ`);
    for (const ช่อง of ['จำนวนที่ค้นเจอ', 'เวลาที่ใช้ตอบ']) {
      const v = r[ช่อง];
      assert.ok(
        v === null || (Number.isFinite(v) && v >= 0),
        `${ข้อมูล} ช่อง ${ช่อง} ได้ค่า ${v} ซึ่งไม่ควรเกิดขึ้น`
      );
    }
  }
  // ลำดับหมวดนอกช่วง ต้องกลายเป็นค่าว่าง ไม่ใช่ชื่อหมวดผิด ๆ
  assert.strictEqual(รันแกะข้อมูลปุ่ม('fb=1&c=999').หมวด, null);
  assert.strictEqual(รันแกะข้อมูลปุ่ม('fb=1&c=-1').หมวด, null);
});

test('FG-12 รายชื่อหมวดฝั่งส่งกับฝั่งรับ ต้องเป็นชุดเดียวกันและเรียงเหมือนกัน', () => {
  // ถ้าสองฝั่งเรียงต่างกัน คะแนนจะถูกบันทึกผิดหมวดโดยไม่มีอะไรฟ้อง
  const ดึง = (ชื่อโหนด) => {
    const m = โหนด(ชื่อโหนด).parameters.jsCode.match(/const FEEDBACK_CATEGORIES = (\[[^\]]*\]);/);
    assert.ok(m, `หา FEEDBACK_CATEGORIES ในโหนด ${ชื่อโหนด} ไม่เจอ`);
    return JSON.parse(m[1]);
  };
  const ฝั่งส่ง = ดึง('Prepare LINE Reply');
  const ฝั่งรับ = ดึง('Parse Feedback');
  assert.deepStrictEqual(ฝั่งรับ, ฝั่งส่ง);
  assert.ok(ฝั่งส่ง.includes('อื่นๆ'), 'ต้องมีหมวดตั้งต้นสำหรับคำถามที่จำแนกไม่เข้าเกณฑ์ไหน');
});

test('FG-13 ทุกหมวดที่โหนด Build Context ตั้งได้ ต้องอยู่ในรายการหมวดของปุ่ม', () => {
  // หมวดที่ไม่อยู่ในรายการ indexOf จะได้ -1 คะแนนหมวดนั้นจะเป็นค่าว่างเงียบ ๆ
  const m = โหนด('Prepare LINE Reply').parameters.jsCode.match(
    /const FEEDBACK_CATEGORIES = (\[[^\]]*\]);/
  );
  const รายการ = JSON.parse(m[1]);
  const code = โหนด('Build Context').parameters.jsCode;
  const ที่ตั้งได้ = new Set();
  for (const x of code.matchAll(/questionCategory = '([^']+)'/g)) ที่ตั้งได้.add(x[1]);
  const กฎ = code.match(/const INTENT_RULES = (\[[\s\S]*?\]);/);
  if (กฎ) for (const r of JSON.parse(กฎ[1])) ที่ตั้งได้.add(r.category);

  const ขาด = [...ที่ตั้งได้].filter((c) => !รายการ.includes(c));
  assert.deepStrictEqual(ขาด, [], 'มีหมวดที่ระบบตั้งได้จริงแต่ไม่อยู่ในรายการของปุ่ม');
});

test('FG-14 การบันทึกคะแนนต้องไม่แตะข้อมูลที่ระบุตัวผู้ใช้และไม่เก็บคำตอบ', () => {
  const n = โหนด('Save Feedback');
  // ตัดชื่อตาราง answer_feedback ออกก่อน ไม่งั้นคำว่า answer จะถูกนับเป็นการละเมิด
  const ทั้งโหนด = JSON.stringify(n).split('answer_feedback').join('«ตาราง»');
  for (const ต้องห้าม of ['user_id', 'lineUserId', 'userMessage', 'answer', 'line_user_id']) {
    assert.ok(!ทั้งโหนด.includes(ต้องห้าม), `โหนดบันทึกคะแนนต้องไม่อ้างถึง ${ต้องห้าม}`);
  }
  assert.match(
    n.parameters.query,
    /INSERT INTO answer_feedback\s*\n?\s*\(is_helpful, category, knowledge_hits, response_time_ms\)/,
    'ต้องบันทึกเฉพาะสี่ช่องนี้เท่านั้น'
  );
  // โค้ดที่แกะข้อมูลปุ่มก็ต้องไม่แตะรหัสผู้ใช้ที่ติดมากับเหตุการณ์
  assert.ok(
    !โหนด('Parse Feedback').parameters.jsCode.includes('source'),
    'โหนดแกะข้อมูลปุ่มต้องไม่อ่านฟิลด์ source ซึ่งมีรหัสผู้ใช้อยู่'
  );
});

test('FG-15 ข้อมูลที่แนบไปกับปุ่ม ต้องไม่ยาวเกินที่ LINE รับได้', () => {
  // LINE จำกัด postback 300 ตัวอักษร จึงส่งลำดับหมวดเป็นตัวเลขแทนชื่อภาษาไทย
  const LINE_POSTBACK_MAX = 300;
  const ยาวสุด = 'fb=0&c=99&h=999&t=' + '9'.repeat(9);
  assert.ok(
    ยาวสุด.length <= LINE_POSTBACK_MAX,
    `ข้อมูลปุ่มกรณียาวที่สุดคือ ${ยาวสุด.length} ตัวอักษร`
  );
  const code = โหนด('Prepare LINE Reply').parameters.jsCode;
  assert.match(code, /'&c=' \+ เลขหมวด/, 'ต้องส่งลำดับหมวดเป็นตัวเลข ไม่ใช่ชื่อหมวด');
});

// ---- เส้นทางที่ 3: ดักคำทักทายก่อนเรียกแบบจำลองภาษา ----
// คำทักทายไม่ต้องค้นฐานข้อมูลหรือเรียกแบบจำลอง แต่ต้องไม่ดักคำถามจริงผิด

/** รันโค้ดของโหนดดักคำทักทาย โดยจำลองสภาพแวดล้อมของ n8n */
function รันดักคำทักทาย(ข้อความ) {
  const code = โหนด('Check Small Talk').parameters.jsCode;
  const เข้าถึงโหนด = () => ({
    first: () => ({ json: { userMessage: ข้อความ, replyToken: 'TOKEN-ST' } }),
  });
  return new Function('$json', '$', code)({}, เข้าถึงโหนด)[0].json;
}

test('FG-16 คำทักทายและคำขอบคุณ ต้องถูกดักไว้ทุกแบบ', () => {
  const ต้องดักได้ = [
    'สวัสดีคับ', 'สวัสดีครับ', 'สวัสดีค่ะ', 'หวัดดี', 'ดีครับ',
    'Hello', 'hi', 'ฮัลโหล',
    'ขอบคุณครับ', 'ขอบคุณมากค่ะ', 'ขอบใจ', 'thank you',
    'บายครับ', 'ลาก่อน', 'ทดสอบ', 'อยู่ไหมครับ',
  ];
  const หลุด = ต้องดักได้.filter((m) => !รันดักคำทักทาย(m)['เป็นคำทักทาย']);
  assert.deepStrictEqual(หลุด, [], 'ข้อความเหล่านี้ควรถูกดัก แต่หลุดไปเรียกแบบจำลอง');
});

test('FG-17 คำถามภาษีจริงทั้ง 115 ข้อ ต้องไม่ถูกดักแม้แต่ข้อเดียว', () => {
  const ดิบ = require(path.join(ROOT, 'evaluation', 'test-questions-official.json'));
  const คำถาม = Array.isArray(ดิบ) ? ดิบ : Object.values(ดิบ).find(Array.isArray);
  assert.ok(คำถาม && คำถาม.length >= 100, 'อ่านชุดคำถามทางการไม่ได้');

  const ถูกดัก = คำถาม
    .filter((q) => รันดักคำทักทาย(q.question)['เป็นคำทักทาย'])
    .map((q) => `${q.id} ${q.question}`);
  assert.deepStrictEqual(
    ถูกดัก,
    [],
    'คำถามจริงถูกดักเป็นคำทักทาย ผู้ใช้จะไม่ได้คำตอบ\n  ' + ถูกดัก.join('\n  ')
  );
});

test('FG-18 ทักทายแล้วถามต่อในประโยคเดียว ต้องไม่ถูกดัก', () => {
  // คนไทยมักทักทายนำหน้าคำถาม ต้องส่งไปตอบตามปกติ
  const ต้องผ่านไปตอบ = [
    'สวัสดีครับ ลดหย่อนบุตรเท่าไหร่',
    'ขอบคุณครับ แล้วคู่สมรสล่ะ',
    'สวัสดี 2567 ยื่นเมื่อไหร่',
    'หวัดดีครับ อยากถามเรื่องประกันสังคม',
  ];
  const โดนดัก = ต้องผ่านไปตอบ.filter((m) => รันดักคำทักทาย(m)['เป็นคำทักทาย']);
  assert.deepStrictEqual(โดนดัก, [], 'ประโยคที่มีคำถามอยู่ด้วย ต้องถูกส่งไปตอบตามปกติ');
});

test('FG-19 คำทักทายต้องถูกดักก่อนทุกขั้นตอนที่มีค่าใช้จ่าย', () => {
  // ต้องดักก่อน Get LINE Profile / Upsert User เพราะตัวนับรอบถามความเห็นอยู่ใน Upsert User
  // ถ้าดักทีหลัง คำทักทายจะกินรอบถามความเห็นไปทั้งที่ไม่ได้ตอบอะไร
  assert.deepStrictEqual(
    ปลายทางของ('Check Consent Command', 1),
    ['Check Small Talk'],
    'ข้อความปกติต้องเข้าตัวดักคำทักทายโดยตรง'
  );
  assert.deepStrictEqual(ปลายทางของ('Check Small Talk'), ['Is Small Talk']);
  assert.deepStrictEqual(ปลายทางของ('Is Small Talk', 0), ['Send Small Talk Reply']);
  assert.deepStrictEqual(ปลายทางของ('Is Small Talk', 1), ['Get LINE Profile']);

  // ทางของคำทักทายต้องจบที่การส่งข้อความ ไม่ไหลต่อไปที่ไหนอีก
  assert.deepStrictEqual(ปลายทางของ('Send Small Talk Reply'), [],
    'ตอบคำทักทายแล้วต้องจบ ไม่ไหลต่อไปส่วนที่เสียโทเคน');
});

test('FG-19ก คำทักทายต้องไม่ไปแตะตัวนับรอบถามความเห็น', () => {
  // ตัวนับอยู่ใน Upsert User เส้นทางคำทักทายจึงต้องไม่ผ่านโหนดนั้นเลย
  const ที่เยี่ยม = new Set();
  const เดิน = (ชื่อ) => {
    if (ที่เยี่ยม.has(ชื่อ)) return;
    ที่เยี่ยม.add(ชื่อ);
    const c = wf.connections[ชื่อ];
    if (!c || !c.main) return;
    for (const สาย of c.main) for (const ป of สาย || []) เดิน(ป.node);
  };
  เดิน('Send Small Talk Reply');

  for (const ต้องไม่ผ่าน of ['Upsert User', 'Get LINE Profile', 'Search Tax Knowledge',
                             'AI Agent (Tax Advisor)', 'AI Agent (No Memory)']) {
    assert.ok(
      !ที่เยี่ยม.has(ต้องไม่ผ่าน),
      `เส้นทางคำทักทายไม่ควรไปถึงโหนด ${ต้องไม่ผ่าน}`
    );
  }
});

test('FG-20 ป้ายบนปุ่มตัวอย่างคำถาม ต้องไม่เกิน 20 ตัวอักษรตามข้อจำกัดของ LINE', () => {
  const r = รันดักคำทักทาย('สวัสดี');
  const items = r.linePayload.messages[0].quickReply.items;
  assert.ok(items.length >= 3, 'ควรมีตัวอย่างคำถามอย่างน้อยสามข้อ');
  for (const i of items) {
    assert.ok(
      i.action.label.length <= 20,
      `ป้าย "${i.action.label}" ยาว ${i.action.label.length} ตัวอักษร`
    );
    // ป้ายสั้นได้ แต่ข้อความที่ส่งจริงต้องเป็นคำถามเต็มที่ระบบตอบได้
    assert.ok(i.action.text.length >= i.action.label.length);
  }
});

test('FG-21 คำอำลากับคำทักทาย ต้องตอบคนละอย่าง', () => {
  const ทัก = รันดักคำทักทาย('สวัสดีครับ').linePayload.messages[0].text;
  const ลา = รันดักคำทักทาย('ขอบคุณครับ').linePayload.messages[0].text;
  assert.notStrictEqual(ทัก, ลา, 'ตอบคนบอกลาว่า ถามได้เลย จะดูไม่เข้าใจภาษาคน');
  assert.ok(ทัก.includes('คุณภาษี'), 'ข้อความทักทายควรแนะนำตัว');
});

test('FG-22 คำถามในปุ่มตัวอย่าง ห้ามมีตัวเลขที่เป็นข้อมูลส่วนตัวของผู้ใช้', () => {
  // ปุ่มที่มีตัวเลข (เช่น "เงินเดือน 30,000 บาท") ทำให้ระบบคำนวณจากข้อมูลที่ผู้ใช้ไม่เคยบอก
  const items = รันดักคำทักทาย('สวัสดี').linePayload.messages[0].quickReply.items;
  for (const i of items) {
    assert.ok(
      !/[0-9๐-๙]/.test(i.action.text),
      `ปุ่ม "${i.action.label}" ส่งคำถามที่มีตัวเลข "${i.action.text}" ` +
        'ซึ่งเป็นการสมมติข้อมูลของผู้ใช้'
    );
  }
});

// ---- ดักคำถามที่กว้างเกินกว่าระบบจะตอบได้ ----
// เช่น "สรุปกฎหมายภาษีทุกมาตรา" ฐานความรู้ตอบไม่ได้ แบบจำลองจะเติมจากความจำเอง
// แต่ดักเกินอันตรายกว่าไม่ดัก

test('FG-18 คำถามที่กว้างเกินกว่าจะตอบได้ ต้องถูกดักไว้', () => {
  const ต้องดักได้ = [
    'ช่วยสรุปกฎหมายภาษีทุกมาตราให้หน่อย',
    'อธิบายภาษีให้ฟังหน่อย',
    'ภาษีคืออะไร',
    'ขอสรุปภาษีทุกประเภท',
    'เล่าเรื่องภาษีทั้งหมดให้ฟัง',
    'อยากรู้เรื่องภาษีทุกอย่าง',
  ];
  const หลุด = ต้องดักได้.filter((s) => !รันดักคำทักทาย(s)['เป็นคำถามกว้างเกิน']);
  assert.deepStrictEqual(
    หลุด,
    [],
    'คำถามกว้างต่อไปนี้ไม่ถูกดัก จะถูกส่งไปให้แบบจำลองเติมเนื้อหาจากความจำ\n  ' +
      หลุด.join('\n  ')
  );
});

test('FG-19 คำถามทางการทุกข้อในชุดทดสอบ ต้องไม่ถูกดักว่ากว้างเกิน', () => {
  // สำคัญที่สุดในกลุ่ม: ดักเกินทำให้บอทปฏิเสธคำถามที่ตอบได้
  const ดิบ = require(path.join(ROOT, 'evaluation', 'test-questions-official.json'));
  const คำถาม = ดิบ.questions || ดิบ;
  assert.ok(คำถาม && คำถาม.length >= 100, 'อ่านชุดคำถามทางการไม่ได้');

  const ถูกดัก = คำถาม
    .filter((q) => รันดักคำทักทาย(q.question)['ตอบด้วยข้อความสำเร็จรูป'])
    .map((q) => `${q.id} "${q.question.slice(0, 50)}"`);
  assert.deepStrictEqual(
    ถูกดัก,
    [],
    'คำถามทางการต่อไปนี้ถูกดักไว้ ทั้งที่ระบบตอบได้\n  ' + ถูกดัก.join('\n  ')
  );
});

test('FG-20 คำถามที่ระบบตอบได้ดี ต้องไม่ถูกดักแม้จะมีคำว่าอะไรบ้าง', () => {
  // กันไม่ให้ชุดคำดักขยายจนกินคำถามรูปแบบ "มีอะไรบ้าง" ซึ่งตอบได้ปกติ
  const ต้องไม่ถูกดัก = [
    'ค่าลดหย่อนภาษีมีอะไรบ้าง',
    'ลดหย่อนบุตรได้เท่าไหร่',
    'ยื่นภาษีได้ถึงวันไหน',
    'เงินได้เท่าไหร่ถึงต้องยื่นภาษี',
    'ต้องเตรียมเอกสารอะไรบ้างตอนยื่นภาษี',
    'เงินได้พึงประเมินมีกี่ประเภท',
  ];
  const ถูกดัก = ต้องไม่ถูกดัก.filter(
    (s) => รันดักคำทักทาย(s)['ตอบด้วยข้อความสำเร็จรูป']
  );
  assert.deepStrictEqual(ถูกดัก, [], 'คำถามที่ตอบได้ถูกดัก\n  ' + ถูกดัก.join('\n  '));
});

test('FG-21 ข้อความปฏิเสธต้องมีทางออกให้ผู้ใช้เสมอ', () => {
  // ปฏิเสธเฉย ๆ ผู้ใช้จะไปต่อไม่ถูก ต้องเสนอหัวข้อที่ถามได้
  const r = รันดักคำทักทาย('ช่วยสรุปกฎหมายภาษีทุกมาตราให้หน่อย');
  const ข้อความ = r.linePayload.messages[0];
  assert.ok(ข้อความ.quickReply, 'ข้อความปฏิเสธต้องมีปุ่มให้กดต่อ');
  assert.ok(
    ข้อความ.quickReply.items.length >= 3,
    'ควรเสนอหัวข้อให้เลือกอย่างน้อย 3 หัวข้อ'
  );
  assert.ok(
    /เจาะจง/.test(ข้อความ.text),
    'ข้อความควรบอกให้ผู้ใช้ถามเจาะจงขึ้น ไม่ใช่ปฏิเสธเฉย ๆ'
  );
});

test('FG-22 ปุ่มในข้อความปฏิเสธ ต้องไม่มีตัวเลขที่เป็นข้อมูลของผู้ใช้', () => {
  // กฎเดียวกับปุ่มตอนทักทาย: ห้ามสมมติตัวเลขของผู้ใช้
  const r = รันดักคำทักทาย('ภาษีคืออะไร');
  for (const it of r.linePayload.messages[0].quickReply.items) {
    assert.ok(
      !/[0-9๐-๙]/.test(it.action.text),
      `ปุ่ม "${it.action.label}" มีตัวเลขอยู่ในคำถาม: ${it.action.text}`
    );
    assert.ok(
      it.action.label.length <= 20,
      `ป้ายปุ่ม "${it.action.label}" ยาวเกิน 20 ตัวอักษรที่ไลน์รองรับ`
    );
  }
});

test('FG-23 โหนดตัดสินใจต้องใช้ธงรวม ไม่ใช่ธงคำทักทายอย่างเดียว', () => {
  // ถ้าดูแค่ธงคำทักทาย คำถามกว้างจะไม่ถูกส่งไปทางตอบสำเร็จรูป
  const เงื่อนไข = โหนด('Is Small Talk').parameters.conditions.conditions[0].leftValue;
  assert.ok(
    เงื่อนไข.indexOf('ตอบด้วยข้อความสำเร็จรูป') >= 0,
    `โหนด Is Small Talk ยังใช้เงื่อนไข ${เงื่อนไข} ซึ่งไม่ครอบคลุมคำถามกว้าง`
  );
});

test('FG-24 คำถามคำนวณที่มีคำว่ารวมทั้งหมด ต้องไม่ถูกดักว่ากว้างเกิน', () => {
  // "ทั้งหมด" ในคำถามคำนวณแปลว่ายอดรวม ไม่ใช่ขอภาพรวมทุกเรื่อง
  // ถ้าดัก ผู้ใช้จะได้ปุ่มแนะนำแทนคำตอบ
  const ต้องไม่ถูกดัก = [
    'ภาษีค้าง 120,000 บาท ยื่นช้าไป 1 ปีเต็ม ต้องจ่ายเพิ่มทั้งหมดเท่าไหร่',
    'เงินเดือน 50,000 บาท มีค่าลดหย่อนทั้งหมด 190,000 บาท เสียภาษีเท่าไหร่',
    'รายได้ทั้งหมด 800,000 บาทต่อปี ต้องเสียภาษีเท่าไหร่',
    'ผมมีรายได้ 3 แสนบาท รวมทั้งหมดต้องยื่นภาษีไหม',
  ];
  const ถูกดัก = ต้องไม่ถูกดัก.filter((s) => รันดักคำทักทาย(s)['เป็นคำถามกว้างเกิน']);
  assert.deepStrictEqual(
    ถูกดัก,
    [],
    'คำถามคำนวณต่อไปนี้ถูกดักว่ากว้างเกิน ทั้งที่มีจำนวนเงินระบุชัด\n  ' + ถูกดัก.join('\n  ')
  );
});

test('FG-25 คำถามกว้างจริงที่ไม่มีจำนวนเงิน ต้องยังถูกดักได้เหมือนเดิม', () => {
  // คู่กับ FG-24 กันไม่ให้การแก้ด่านหลวมจนไม่ดักอะไรเลย
  const ต้องดักได้ = [
    'สรุปกฎหมายภาษีทั้งหมดให้หน่อย',
    'อธิบายภาษีทุกประเภทในประเทศไทย',
    'เล่าเรื่องภาษีให้ฟังทั้งหมด',
  ];
  const หลุด = ต้องดักได้.filter((s) => !รันดักคำทักทาย(s)['เป็นคำถามกว้างเกิน']);
  assert.deepStrictEqual(หลุด, [], 'คำถามกว้างต่อไปนี้หลุดด่านไป\n  ' + หลุด.join('\n  '));
});

// ---- ปุ่ม Rich Menu 6 ปุ่ม ----
// ข้อความบนปุ่มต้องตรงกับตัวดักในเวิร์กโฟลว์ ไม่งั้นปุ่มจะกลายเป็นคำถามธรรมดาและเสียโทเคน

/** รันโค้ดโหนดดักคำทักทายด้วยข้อความที่กำหนด */
function รันตัวดัก(ข้อความ) {
  const code = โหนด('Check Small Talk').parameters.jsCode;
  const $ = () => ({ first: () => ({ json: { userMessage: ข้อความ, replyToken: 'T' } }) });
  return new Function('$', code)($)[0].json;
}

test('FG-29 ปุ่มคำถามที่พบบ่อย ต้องตอบด้วยข้อความสำเร็จรูปพร้อมปุ่มให้เลือก', () => {
  const r = รันตัวดัก('คำถามที่พบบ่อย');
  assert.strictEqual(r['เป็นคำขอดูคำถามพบบ่อย'], true);
  assert.strictEqual(r['ตอบด้วยข้อความสำเร็จรูป'], true, 'ต้องไม่เรียกแบบจำลอง');
  const ปุ่ม = r.linePayload.messages[0].quickReply.items;
  assert.ok(ปุ่ม.length >= 6, 'ต้องมีตัวเลือกอย่างน้อย 6 ปุ่ม');
  assert.ok(ปุ่ม.every((i) => i.action.type === 'message'), 'ปุ่มชุดนี้เป็นชนิดส่งข้อความ');
});

test('FG-30 ปุ่มขั้นตอนการยื่น ต้องถามกลับก่อนว่าจะยื่นทางไหน', () => {
  const r = รันตัวดัก('ขั้นตอนการยื่น');
  assert.strictEqual(r['เป็นคำขอดูขั้นตอนยื่น'], true);
  assert.strictEqual(r['ตอบด้วยข้อความสำเร็จรูป'], true);
  const ปุ่ม = r.linePayload.messages[0].quickReply.items;
  assert.strictEqual(ปุ่ม.length, 2, 'ยื่นออนไลน์กับยื่นที่สำนักงาน สองทางเท่านั้น');
  const ป้าย = ปุ่ม.map((i) => i.action.label);
  assert.deepStrictEqual(ป้าย, ['ยื่นออนไลน์', 'ยื่นที่สำนักงาน']);
});

test('FG-31 ปุ่มแหล่งข้อมูล ต้องส่งลิงก์กรมสรรพากร และต้องไม่ผ่านแบบจำลอง', () => {
  const r = รันตัวดัก('แหล่งข้อมูลกฎหมายภาษี');
  assert.strictEqual(r['เป็นคำขอแหล่งข้อมูล'], true);
  assert.strictEqual(r['ตอบด้วยข้อความสำเร็จรูป'], true);
  const ข้อความ = r.linePayload.messages[0].text;
  // ตอบสำเร็จรูปเพราะแบบจำลองอาจแต่งลิงก์ปลอมที่ผู้ใช้แยกไม่ออก
  assert.ok(ข้อความ.includes('https://www.rd.go.th/'), 'ต้องมีลิงก์เว็บกรมสรรพากร');
  assert.ok(ข้อความ.includes('1161'), 'ต้องมีเบอร์สายด่วนไว้ให้ถามกรณีซับซ้อน');
});

test('FG-32 ปุ่มรายงาน ต้องใช้ปุ่มชนิดบันทึก ไม่ใช่ปุ่มส่งข้อความ', () => {
  const r = รันตัวดัก('รายงานปัญหา');
  assert.strictEqual(r['เป็นคำขอรายงาน'], true);
  const ปุ่ม = r.linePayload.messages[0].quickReply.items;
  assert.ok(
    ปุ่ม.every((i) => i.action.type === 'postback'),
    'ถ้าใช้ปุ่มส่งข้อความ ระบบจะเอาไปค้นฐานความรู้แล้วตอบเรื่องภาษี ซึ่งไม่ใช่สิ่งที่ผู้ใช้ต้องการ'
  );
  const ข้อมูล = ปุ่ม.map((i) => i.action.data).sort();
  assert.deepStrictEqual(ข้อมูล, [
    'report=cannot',
    'report=not_match',
    'report=wrong_info',
  ]);
});

test('FG-33 ป้ายบนปุ่มทุกชนิด ต้องไม่เกิน 20 ตัวอักษรตามที่ไลน์กำหนด', () => {
  for (const ข้อความ of ['คำถามที่พบบ่อย', 'ขั้นตอนการยื่น', 'รายงานปัญหา']) {
    const msg = รันตัวดัก(ข้อความ).linePayload.messages[0];
    for (const i of (msg.quickReply || { items: [] }).items) {
      assert.ok(
        i.action.label.length <= 20,
        `ป้าย "${i.action.label}" ยาว ${i.action.label.length} ตัวอักษร ไลน์จะปฏิเสธทั้งข้อความ`
      );
    }
  }
});

test('FG-34 ข้อความบนปุ่ม Rich Menu ต้องตรงกับตัวดักในเวิร์กโฟลว์', () => {
  // สำคัญที่สุดในกลุ่ม: line/setup-rich-menu.py กับตัวดักอยู่คนละไฟล์ แก้ที่เดียวจะไม่มีอะไรเตือน
  const สคริปต์ = fs.readFileSync(path.join(ROOT, 'line', 'setup-rich-menu.py'), 'utf8');
  const ข้อความบนปุ่ม = [...สคริปต์.matchAll(/"text":\s*"([^"]+)"/g)].map((m) => m[1]);

  assert.strictEqual(ข้อความบนปุ่ม.length, 6, 'Rich Menu ต้องมี 6 ปุ่มพอดี');

  const ต้องตอบสำเร็จรูป = ['คำถามที่พบบ่อย', 'ขั้นตอนการยื่น', 'แหล่งข้อมูลกฎหมายภาษี', 'รายงานปัญหา'];
  for (const ข้อความ of ต้องตอบสำเร็จรูป) {
    assert.ok(
      ข้อความบนปุ่ม.includes(ข้อความ),
      `ไม่พบปุ่มที่ส่งข้อความว่า "${ข้อความ}" ในไฟล์ setup-rich-menu.py`
    );
    assert.strictEqual(
      รันตัวดัก(ข้อความ)['ตอบด้วยข้อความสำเร็จรูป'],
      true,
      `ปุ่ม "${ข้อความ}" หลุดตัวดักไปหาแบบจำลอง ซึ่งเสียโทเคนฟรีทุกครั้งที่มีคนกด`
    );
  }
});

test('FG-35 ปุ่มสองปุ่มแรกต้องเป็นคำถามจริง ไม่ใช่ปุ่มตอบสำเร็จรูป', () => {
  // ปุ่มคำนวณภาษีและค่าลดหย่อนต้องผ่านเข้าระบบปกติ เพราะคำตอบขึ้นกับข้อมูลผู้ใช้
  const สคริปต์ = fs.readFileSync(path.join(ROOT, 'line', 'setup-rich-menu.py'), 'utf8');
  const ข้อความบนปุ่ม = [...สคริปต์.matchAll(/"text":\s*"([^"]+)"/g)].map((m) => m[1]);

  for (const ข้อความ of ข้อความบนปุ่ม.slice(0, 2)) {
    const r = รันตัวดัก(ข้อความ);
    assert.strictEqual(
      r['ตอบด้วยข้อความสำเร็จรูป'],
      false,
      `ปุ่ม "${ข้อความ}" ถูกตัวดักกลืนไป ผู้ใช้จะไม่ได้คำตอบที่คำนวณจากข้อมูลของตัวเอง`
    );
  }
});

test('FG-36 คำถามภาษีจริง ต้องไม่ถูกตัวดักชุดใหม่กลืน', () => {
  // ตัวดักเมนูต้องไม่กลืนคำถามจริง ไม่งั้นผู้ใช้จะได้เมนูแทนคำตอบ
  const คำถามจริง = [
    'ลดหย่อนบุตรได้เท่าไหร่',
    'เงินเดือน 50,000 ต้องเสียภาษีเท่าไหร่',
    'ยื่นภาษีล่าช้าต้องเสียค่าปรับเท่าไหร่',
    'ขั้นตอนการยื่นภาษีออนไลน์ทำอย่างไร',
    'มาตรา 40 เขียนว่าอะไร',
  ];
  for (const q of คำถามจริง) {
    assert.strictEqual(
      รันตัวดัก(q)['ตอบด้วยข้อความสำเร็จรูป'],
      false,
      `คำถามจริง "${q}" ถูกตัวดักกลืนไป ผู้ใช้จะได้เมนูแทนคำตอบ`
    );
  }
});

test('FG-37 ปุ่มในเมนูขั้นตอนการยื่น ต้องไม่วนกลับมาเปิดเมนูเดิม', () => {
  // ข้อความปุ่ม "ยื่นออนไลน์" มีคำว่า "ขั้นตอนการยื่น" อยู่ ถ้าไม่ระวังจะเปิดเมนูเดิมวนไม่รู้จบ
  const เมนู = รันตัวดัก('ขั้นตอนการยื่น');
  const ข้อความของปุ่ม = เมนู.linePayload.messages[0].quickReply.items.map((i) => i.action.text);

  for (const ข้อความ of ข้อความของปุ่ม) {
    const r = รันตัวดัก(ข้อความ);
    assert.strictEqual(
      r['เป็นคำขอดูขั้นตอนยื่น'],
      false,
      `กดปุ่ม "${ข้อความ}" แล้วได้เมนูเดิมกลับมา ผู้ใช้จะติดวนอยู่ตรงนี้`
    );
    assert.strictEqual(
      r['ตอบด้วยข้อความสำเร็จรูป'],
      false,
      `ปุ่ม "${ข้อความ}" ต้องผ่านไปให้แบบจำลองตอบ เพราะผู้ใช้บอกวิธีที่ต้องการมาแล้ว`
    );
  }
});

test('FG-38 ปุ่มในเมนูคำถามที่พบบ่อย ต้องไม่วนกลับมาเปิดเมนูใดเมนูหนึ่ง', () => {
  // ตรวจแบบเดียวกันกับเมนูคำถามที่พบบ่อย กันตัวดักใหม่ไปชนกับข้อความปุ่ม
  const เมนู = รันตัวดัก('คำถามที่พบบ่อย');
  const ข้อความของปุ่ม = เมนู.linePayload.messages[0].quickReply.items.map((i) => i.action.text);

  for (const ข้อความ of ข้อความของปุ่ม) {
    assert.strictEqual(
      รันตัวดัก(ข้อความ)['ตอบด้วยข้อความสำเร็จรูป'],
      false,
      `กดปุ่ม "${ข้อความ}" แล้วได้เมนูกลับมาแทนคำตอบ`
    );
  }
});

test('FG-39 ข้อความสั้นจากปุ่มเมนู ต้องถูกขยายเป็นคำถามเต็มก่อนค้นฐานความรู้', () => {
  // ปุ่มส่งข้อความสั้นให้กล่องแชทอ่านง่าย แล้วโหนด Extract LINE Data ขยายเป็นคำถามเต็ม
  const นิพจน์ = โหนด('Extract LINE Data').parameters.assignments.assignments.find(
    (a) => a.name === 'userMessage'
  ).value;

  const สคริปต์ = fs.readFileSync(path.join(ROOT, 'line', 'setup-rich-menu.py'), 'utf8');
  const ข้อความบนปุ่ม = [...สคริปต์.matchAll(/"text":\s*"([^"]+)"/g)].map((m) => m[1]);

  for (const สั้น of ['คำนวณภาษี', 'ค่าลดหย่อน']) {
    assert.ok(
      ข้อความบนปุ่ม.includes(สั้น),
      `ปุ่มต้องส่งข้อความสั้นว่า "${สั้น}" เพื่อให้กล่องแชทฝั่งผู้ใช้อ่านง่าย`
    );
    assert.ok(
      นิพจน์.includes(`"${สั้น}":`),
      `ต้องมีรายการขยายของ "${สั้น}" ไม่งั้นแบบจำลองจะได้คำถามสั้นเกินกว่าจะตอบได้ตรง`
    );
  }

  // ต้องเทียบทั้งประโยค ถ้าค้นบางส่วน คำถามจริงที่มีคำเหล่านี้จะถูกเขียนทับ
  assert.ok(
    นิพจน์.includes(".trim()]"),
    'ต้องใช้การเทียบทั้งประโยคด้วยการอ้างคีย์ ไม่ใช่ indexOf หรือ includes'
  );
  assert.ok(
    !/indexOf|includes|replace\(/.test(นิพจน์),
    'ห้ามใช้การค้นหาคำบางส่วนในนิพจน์นี้'
  );
});

test('FG-40 ข้อความอื่นที่ไม่ได้มาจากปุ่ม ต้องผ่านไปโดยไม่ถูกแก้', () => {
  const นิพจน์ = โหนด('Extract LINE Data').parameters.assignments.assignments.find(
    (a) => a.name === 'userMessage'
  ).value;
  assert.ok(
    นิพจน์.includes('|| $json.body.events[0].message.text'),
    'ต้องมีทางถอยกลับไปใช้ข้อความเดิมเสมอ เมื่อไม่ตรงกับรายการใดเลย'
  );
});

// ---- น้ำเสียงของข้อความสำเร็จรูป (อิโมจิ) ----
// ข้อความตายตัวในโค้ดต้องมีอิโมจิ 1–2 ตัว: ไม่มีเลยดูแข็งเหมือนเครื่อง เกินสองดูเหมือนโฆษณา
const นับอิโมจิ = (s) => (String(s).match(/\p{Extended_Pictographic}/gu) || []).length;

test('FG-41 ข้อความสำเร็จรูปทุกชุด ต้องมีอิโมจิ 1 ถึง 2 ตัว', () => {
  const กรณีที่ต้องตรวจ = [
    ['สวัสดี', 'คำทักทาย'],
    ['ขอบคุณ', 'คำขอบคุณและอำลา'],
    ['คำถามที่พบบ่อย', 'เมนูคำถามที่พบบ่อย'],
    ['ขั้นตอนการยื่น', 'เมนูขั้นตอนการยื่น'],
    ['แหล่งข้อมูลกฎหมายภาษี', 'เมนูแหล่งข้อมูล'],
    ['รายงานปัญหา', 'เมนูรายงานปัญหา'],
  ];

  for (const [ข้อความเข้า, ชื่อกรณี] of กรณีที่ต้องตรวจ) {
    const r = รันตัวดัก(ข้อความเข้า);
    assert.strictEqual(
      r['ตอบด้วยข้อความสำเร็จรูป'],
      true,
      `"${ข้อความเข้า}" ต้องตอบด้วยข้อความสำเร็จรูป ไม่งั้นข้อนี้ตรวจผิดตัว`
    );
    const ข้อความออก = r.linePayload.messages[0].text;
    const จำนวน = นับอิโมจิ(ข้อความออก);
    assert.ok(จำนวน >= 1, `${ชื่อกรณี} ไม่มีอิโมจิเลย อ่านแล้วเหมือนข้อความจากเครื่อง`);
    assert.ok(จำนวน <= 2, `${ชื่อกรณี} มีอิโมจิ ${จำนวน} ตัว เกินเพดานสองตัว`);
  }
});

test('FG-42 การใส่อิโมจิต้องบังคับด้วยโค้ด ไม่ใช่สั่งในคำสั่งระบบ', () => {
  // สั่งในคำสั่งระบบแล้วแบบจำลองทำตามไม่สม่ำเสมอ และคำสั่งที่ยาวขึ้นทำให้เรียกเครื่องมือน้อยลง
  // จึงบังคับด้วยโค้ดใน Prepare LINE Reply แทน
  const คำสั่ง = โหนด('AI Agent (Tax Advisor)').parameters.options.systemMessage;
  const โค้ด = โหนด('Prepare LINE Reply').parameters.jsCode;

  // คำสั่งระบบเก็บแค่เพดานจำนวน ห้ามกลับไปสั่งตำแหน่ง
  assert.ok(
    คำสั่ง.includes('ไม่เกิน 2 ตัว'),
    'คำสั่งระบบยังต้องมีเพดานไว้ กันแบบจำลองใส่อิโมจิรัว'
  );
  assert.ok(
    !/ท้ายประโยคที่เป็นคำตอบ/.test(คำสั่ง),
    'ห้ามย้ายกฎเรื่องตำแหน่งกลับเข้าคำสั่งระบบ ให้บังคับในโค้ดแทน'
  );
  assert.ok(
    คำสั่ง.length <= 4200,
    `คำสั่งระบบยาว ${คำสั่ง.length} ตัวอักษร เกินจุดที่วัดแล้วว่าเริ่มไม่เรียกเครื่องมือ`
  );

  // โค้ดต้องมีอิโมจิครบทุกหมวดที่ระบบจำแนกได้จริง
  const กฎ = JSON.parse(
    fs.readFileSync(path.join(ROOT, 'n8n', 'intent-rules.json'), 'utf8')
  );
  const หมวดทั้งหมด = กฎ.intentRules.map((r) => r.category).concat(['อื่นๆ']);
  for (const หมวด of หมวดทั้งหมด) {
    assert.ok(
      โค้ด.indexOf(`'${หมวด}':`) >= 0,
      `หมวด ${หมวด} ยังไม่มีอิโมจิกำกับในโค้ด คำตอบหมวดนี้จะไม่มีอิโมจิเลย`
    );
  }

  // ใส่ที่บรรทัดแรกเท่านั้น บรรทัดไล่ตัวเลขต้องสะอาด
  assert.ok(
    /บรรทัด\[0\][\s\S]{0,120}อิโมจิที่จะใส่/.test(โค้ด),
    'ต้องต่อท้ายบรรทัดแรกเท่านั้น'
  );
  // ถ้าแบบจำลองใส่มาเองแล้วต้องไม่ใส่ซ้ำ
  assert.ok(
    /มีอิโมจิอยู่แล้ว/.test(โค้ด),
    'ต้องตรวจก่อนว่ามีอิโมจิอยู่แล้วหรือยัง ไม่งั้นจะได้สองตัวติดกัน'
  );
});