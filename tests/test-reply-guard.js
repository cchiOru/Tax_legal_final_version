/**
 * ทดสอบโค้ดโหนด "Prepare LINE Reply" โดยดึงโค้ดจริงจาก n8n/workflows/tax-advisor-workflow.json มารัน
 * (ไม่ได้คัดลอกโค้ดมา ผลทดสอบจึงตรงกับสิ่งที่ระบบรันอยู่จริง)
 *
 * รัน: node --test tests/test-reply-guard.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const WORKFLOW = path.join(ROOT, 'n8n', 'workflows', 'tax-advisor-workflow.json');

// ดึงโค้ดของโหนดจากไฟล์เวิร์กโฟลว์จริง
function loadNodeCode(nodeName) {
  const wf = JSON.parse(fs.readFileSync(WORKFLOW, 'utf8'));
  const node = wf.nodes.find((n) => n.name === nodeName);
  if (!node) throw new Error(`ไม่พบโหนดชื่อ "${nodeName}" ในไฟล์เวิร์กโฟลว์`);
  return node.parameters.jsCode;
}

const PREPARE_CODE = loadNodeCode('Prepare LINE Reply');

/**
 * จำลองสภาพแวดล้อม n8n Code node ($input, $, $env) แล้วรันโค้ดจริงของโหนด
 * ผลเครื่องมือ = ผลที่เครื่องมือคืนมา (null = ไม่ได้เรียกเครื่องมือ)
 */
function runPrepareReply({
  output,
  questionCategory = 'คำนวณภาษี',
  error = false,
  upsertFailed = false,
  elapsedMs = 1234,
  ผลเครื่องมือ = null,
}) {
  const nodeData = {
    'Extract LINE Data': {
      replyToken: 'TOKEN-TEST',
      lineUserId: 'U-ผู้ใช้ทดสอบ',
      userMessage: 'คำถามทดสอบ',
      // ใช้จำลองกรณีระบบตอบช้าจน reply token หมดอายุ
      receivedAt: Date.now() - elapsedMs,
    },
    // Upsert User ล้มเหลว: n8n ส่งต่อแค่ฟิลด์ error ไม่มี id
    'Upsert User': upsertFailed ? { error: 'connection refused' } : { id: 99 },
    'Build Context': {
      matchedKnowledge: 'หัวข้อทดสอบ',
      knowledgeHits: 1,
      questionCategory,
    },
  };

  // รูปแบบเดียวกับ LangChain: แต่ละขั้นมี observation เป็นสตริง JSON
  const intermediateSteps =
    ผลเครื่องมือ === null
      ? undefined
      : [{ action: { tool: 'เครื่องมือทดสอบ' }, observation: JSON.stringify(ผลเครื่องมือ) }];

  const $input = { first: () => ({ json: { output, error, intermediateSteps } }) };
  const $ = (name) => {
    if (!(name in nodeData)) throw new Error(`โค้ดเรียกโหนดที่ไม่มีอยู่: ${name}`);
    return { first: () => ({ json: nodeData[name] }) };
  };
  const $env = { ACTIVE_MODEL_NAME: 'model-ทดสอบ' };

  const fn = new Function('$input', '$', '$env', PREPARE_CODE);
  return fn($input, $, $env)[0].json;
}

const DISCLAIMER_MARK = 'กรมสรรพากร สายด่วน 1161';
const LINE_MAX = 2000;

// ---- กลุ่ม 1: ด่านคำตอบผิดรูปแบบ (แบบจำลองพิมพ์ข้อมูลดิบ เช่น JSON ออกมา) ----
test('RG-01 คำตอบที่เป็น JSON ดิบต้องถูกแทนที่ ไม่หลุดถึงผู้ใช้', () => {
  const r = runPrepareReply({ output: '{"taxDue":10000,"monthsLate":3}' });
  assert.ok(!r.answer.includes('taxDue'), 'ข้อมูลดิบต้องไม่ปรากฏในคำตอบ');
  assert.match(r.answer, /ระบบประมวลผลคำถามนี้ไม่สมบูรณ์/);
});

test('RG-02 คำตอบที่ขึ้นต้นด้วยโค้ดบล็อก JSON ต้องถูกจับได้', () => {
  const r = runPrepareReply({ output: '```json\n{"income":{"salary":600000}}\n```' });
  assert.match(r.answer, /ระบบประมวลผลคำถามนี้ไม่สมบูรณ์/);
});

test('RG-03 คำตอบที่ขึ้นต้นด้วยวงเล็บเหลี่ยมต้องถูกจับได้', () => {
  const r = runPrepareReply({ output: '[{"name":"calculate_thai_personal_income_tax"}]' });
  assert.match(r.answer, /ระบบประมวลผลคำถามนี้ไม่สมบูรณ์/);
});

test('RG-04 คำตอบภาษาไทยปกติต้องผ่านด่านไปได้ ไม่ถูกจับผิด', () => {
  const r = runPrepareReply({ output: 'ภาษีที่ต้องชำระคือ 20,600 บาทค่ะ' });
  assert.ok(r.answer.startsWith('ภาษีที่ต้องชำระคือ 20,600 บาท'));
});

test('RG-05 คำตอบที่ "มี" JSON อยู่ตรงกลางแต่ขึ้นต้นด้วยข้อความ ต้องไม่ถูกจับผิด', () => {
  const r = runPrepareReply({ output: 'สรุปผลการคำนวณ {"ภาษี": 20600} ค่ะ' });
  assert.ok(r.answer.startsWith('สรุปผลการคำนวณ'));
});

test('RG-06 คำตอบว่างต้องกลายเป็นข้อความแจ้งข้อผิดพลาด', () => {
  const r = runPrepareReply({ output: '' });
  assert.match(r.answer, /ระบบขัดข้องชั่วคราว/);
});

test('RG-07 กรณี AI Agent ผิดพลาดต้องได้ข้อความแจ้งข้อผิดพลาด', () => {
  const r = runPrepareReply({ output: null, error: true });
  assert.match(r.answer, /ระบบขัดข้องชั่วคราว/);
});

// ---- กลุ่ม 2: คำเตือนต้องไม่ต่อท้ายคำตอบ ----
// คำเตือนย้ายไปแสดงครั้งเดียวตอนผู้ใช้ตอบเรื่องความยินยอม เพราะต่อท้ายทุกคำตอบแล้วรกจอจนผู้ใช้เลิกอ่าน
const IN_SCOPE = ['คำนวณภาษี', 'บทลงโทษ', 'สิทธิ์ลดหย่อน', 'กำหนดยื่นภาษี', 'กฎหมายภาษี'];

for (const category of IN_SCOPE) {
  test(`RG-08 หมวด "${category}" ต้องไม่มีคำเตือนต่อท้ายแล้ว`, () => {
    const r = runPrepareReply({ output: 'คำตอบตัวอย่าง', questionCategory: category });
    assert.ok(
      !r.answer.includes(DISCLAIMER_MARK),
      'คำเตือนถูกย้ายไปแสดงครั้งเดียวตอนเริ่มใช้งานแล้ว ไม่ควรกลับมาต่อท้ายอีก'
    );
  });
}

test('RG-08ก คำเตือนต้องยังอยู่ในข้อความตอบเรื่องความยินยอม', () => {
  // ถ้าลบคำเตือนตรงนี้ด้วย ระบบจะไม่มีคำเตือนเหลือเลย ทั้งที่ผู้ใช้อาจยึดตัวเลขไปยื่นจริง
  const โค้ด = fs.readFileSync(WORKFLOW, 'utf8');
  assert.ok(
    โค้ด.includes(DISCLAIMER_MARK),
    'ต้องมีคำเตือนอยู่ในเวิร์กโฟลว์อย่างน้อยหนึ่งแห่ง คือข้อความตอนตอบเรื่องความยินยอม'
  );
  assert.ok(
    โค้ด.includes('ไม่ใช่คำปรึกษาทางกฎหมายหรือบัญชี'),
    'ต้องบอกด้วยว่านี่ไม่ใช่คำปรึกษาทางกฎหมาย ไม่ใช่แค่ให้เบอร์โทร'
  );
});

test('RG-09 คำถามนอกขอบเขตไม่ต้องมีคำเตือนเรื่องภาษี', () => {
  const r = runPrepareReply({ output: 'ขออภัยค่ะ เรื่องนี้อยู่นอกขอบเขต', questionCategory: 'อื่นๆ' });
  assert.ok(!r.answer.includes(DISCLAIMER_MARK));
});

test('RG-10 ข้อความแจ้งข้อผิดพลาดไม่ต้องมีคำเตือน', () => {
  const r = runPrepareReply({ output: '', questionCategory: 'คำนวณภาษี' });
  assert.ok(!r.answer.includes(DISCLAIMER_MARK));
});

test('RG-11 คำตอบยาวเกินขีดจำกัด ต้องถูกตัดให้อยู่ในขีดจำกัดของไลน์', () => {
  const long = 'ก'.repeat(5000);
  const r = runPrepareReply({ output: long, questionCategory: 'คำนวณภาษี' });
  assert.ok(r.answer.length <= LINE_MAX, `ความยาว ${r.answer.length} ต้องไม่เกิน ${LINE_MAX}`);
});

test('RG-12 คำตอบสั้นต้องไม่ถูกตัดทอน', () => {
  const r = runPrepareReply({ output: 'ภาษี 20,600 บาท', questionCategory: 'คำนวณภาษี' });
  assert.ok(!r.answer.includes('...'), 'คำตอบสั้นต้องไม่มีเครื่องหมายตัดทอน');
  assert.ok(r.answer.startsWith('ภาษี 20,600 บาท'));
});

// ---- กลุ่ม 2ข: ห้ามมี Markdown หลุดถึงผู้ใช้ ----
// LINE ไม่ตีความ Markdown ผู้ใช้จะเห็น ** หรือ ### เป็นตัวอักษรจริง
test('RG-17 ตัวหนา ** ต้องถูกแปลงเป็นข้อความธรรมดา', () => {
  const r = runPrepareReply({ output: 'ภาษีที่ต้องชำระ **2,050 บาท** ค่ะ' });
  assert.ok(!r.answer.includes('**'), 'ต้องไม่เหลือเครื่องหมายดอกจัน');
  assert.ok(r.answer.includes('2,050 บาท'));
});

test('RG-18 หัวข้อ # ## ### ต้องถูกแปลง', () => {
  const r = runPrepareReply({ output: '## สรุปผลการคำนวณ\nภาษี 20,600 บาท' });
  assert.ok(!r.answer.includes('#'));
  assert.ok(r.answer.startsWith('สรุปผลการคำนวณ'));
});

test('RG-19 รายการหัวข้อย่อยต้องกลายเป็นสัญลักษณ์ที่อ่านได้', () => {
  const r = runPrepareReply({ output: '- ค่าลดหย่อนส่วนตัว 60,000\n- ประกันสังคม 9,000' });
  assert.ok(r.answer.includes('• ค่าลดหย่อนส่วนตัว 60,000'));
  assert.ok(!/^-\s/m.test(r.answer));
});

test('RG-20 ตาราง Markdown ต้องแปลงเป็นบรรทัดที่อ่านได้บนมือถือ', () => {
  const md = '| รายการ | จำนวน |\n|---|---|\n| ส่วนตัว | 60,000 |\n| ประกันสังคม | 9,000 |';
  const r = runPrepareReply({ output: md });
  assert.ok(!r.answer.includes('|'), 'ต้องไม่เหลือเส้นตาราง');
  assert.ok(!r.answer.includes('---'));
  assert.ok(r.answer.includes('ส่วนตัว  60,000'));
});

test('RG-21 โค้ดบล็อกและโค้ดในบรรทัดต้องถูกถอดออก', () => {
  const r = runPrepareReply({ output: 'สูตรคือ `เงินได้สุทธิ x อัตรา` ค่ะ' });
  assert.ok(!r.answer.includes('`'));
  assert.ok(r.answer.includes('เงินได้สุทธิ x อัตรา'));
});

test('RG-22 ลิงก์ Markdown ต้องแสดง URL ให้ผู้ใช้กดได้', () => {
  const r = runPrepareReply({ output: 'ดูที่ [กรมสรรพากร](https://www.rd.go.th) ค่ะ' });
  assert.ok(r.answer.includes('https://www.rd.go.th'));
  assert.ok(!r.answer.includes(']('));
});

test('RG-23 เครื่องหมายคูณและดอกจันที่ไม่ใช่ Markdown ต้องไม่ถูกลบผิด', () => {
  const r = runPrepareReply({ output: 'คำนวณจาก 30,000 * 12 = 360,000 บาท' });
  assert.ok(r.answer.includes('30,000 * 12'), 'ดอกจันที่ใช้เป็นเครื่องหมายคูณต้องคงอยู่');
});

test('RG-24 ข้อความแจ้งข้อผิดพลาดต้องไม่ถูกแปลงจนผิดรูป', () => {
  const r = runPrepareReply({ output: '', questionCategory: 'คำนวณภาษี' });
  assert.match(r.answer, /ระบบขัดข้องชั่วคราว/);
  assert.ok(r.answer.includes('⚠️'), 'สัญลักษณ์เตือนต้องยังอยู่');
});

// ---- กลุ่ม 2ค: ตัดความยาวคำตอบด้วยโค้ด ----
// LINE พับข้อความยาวไว้หลัง "ดูเพิ่มเติม" และแบบจำลองไม่ทำตามความยาวที่สั่งไว้
const SOFT_LIMIT = 700;

test('RG-27 คำตอบยาวเกินขีดจำกัดต้องถูกตัดให้สั้นลง', () => {
  const long = Array.from({ length: 40 }, (_, i) => `บรรทัดที่ ${i + 1} เป็นข้อความทดสอบความยาว`).join('\n');
  const r = runPrepareReply({ output: long, questionCategory: 'คำนวณภาษี' });
  const body = r.answer.split('— ข้อมูลนี้')[0];
  assert.ok(body.length < long.length, 'ต้องสั้นลงจากเดิม');
  assert.ok(body.length <= SOFT_LIMIT + 60, `ความยาว ${body.length} ต้องอยู่ในเกณฑ์`);
});

test('RG-28 การตัดต้องเกิดที่ขอบบรรทัด ไม่ตัดกลางประโยค', () => {
  const long = Array.from({ length: 30 }, (_, i) => `รายการที่ ${i + 1} จำนวน ${i * 1000} บาท`).join('\n');
  const r = runPrepareReply({ output: long, questionCategory: 'คำนวณภาษี' });
  const body = r.answer.split('\n\nอยากรู้รายละเอียด')[0];
  const บรรทัด = body.split('\n');
  for (let i = 0; i < บรรทัด.length; i++) {
    const line = บรรทัด[i];
    if (!line.trim()) continue;
    // บรรทัดแรกมีอิโมจิประจำหมวดต่อท้าย (เติมด้วยโค้ด) จึงถอดออกก่อนเทียบ
    const เทียบ = i === 0 ? line.replace(/\s*\p{Extended_Pictographic}$/u, '') : line;
    assert.ok(long.includes(เทียบ), `บรรทัด "${line}" ต้องเป็นบรรทัดที่สมบูรณ์จากต้นฉบับ`);
  }
});

test('RG-29 เมื่อถูกตัดต้องชวนให้ผู้ใช้ถามต่อ', () => {
  const long = 'ก'.repeat(300) + '\n' + 'ข'.repeat(300) + '\n' + 'ค'.repeat(300);
  const r = runPrepareReply({ output: long, questionCategory: 'คำนวณภาษี' });
  assert.match(r.answer, /ถามต่อได้เลย/);
});

test('RG-30 คำตอบสั้นต้องไม่ถูกแตะต้องและไม่มีข้อความชวนถามต่อ', () => {
  const short = 'ภาษีที่ต้องชำระคือ 20,600 บาทค่ะ';
  const r = runPrepareReply({ output: short, questionCategory: 'คำนวณภาษี' });
  assert.ok(r.answer.startsWith(short));
  assert.ok(!r.answer.includes('ถามต่อได้เลย'));
});

test('RG-31 คำตอบยาวมากต้องไม่เกินขีดจำกัดของ LINE', () => {
  const r = runPrepareReply({ output: 'ก'.repeat(9000), questionCategory: 'คำนวณภาษี' });
  assert.ok(!r.answer.includes(DISCLAIMER_MARK), 'ไม่ต่อคำเตือนท้ายคำตอบแล้ว');
  assert.ok(r.answer.length <= LINE_MAX, `ความยาว ${r.answer.length}`);
});

// ---- กลุ่ม 3: โครงสร้างข้อมูลที่ส่งออก ----
test('RG-13 linePayload ต้องมีเฉพาะฟิลด์ที่ LINE API รู้จัก', () => {
  const r = runPrepareReply({ output: 'คำตอบ' });
  assert.deepStrictEqual(Object.keys(r.linePayload).sort(), ['messages', 'replyToken']);
  assert.strictEqual(r.linePayload.messages[0].type, 'text');
  assert.strictEqual(r.linePayload.messages[0].text, r.answer);
});

test('RG-14 ข้อความที่ส่งให้ LINE ต้องไม่เกิน 2000 ตัวอักษรเสมอ', () => {
  for (const category of [...IN_SCOPE, 'อื่นๆ']) {
    const r = runPrepareReply({ output: 'ก'.repeat(9000), questionCategory: category });
    assert.ok(
      r.linePayload.messages[0].text.length <= LINE_MAX,
      `หมวด ${category} ยาว ${r.linePayload.messages[0].text.length} ตัวอักษร`
    );
  }
});

test('RG-15 ต้องบันทึกข้อมูลเชิงวิจัยครบทุกฟิลด์', () => {
  const r = runPrepareReply({ output: 'คำตอบ', questionCategory: 'บทลงโทษ' });
  assert.strictEqual(r.userDbId, 99);
  assert.strictEqual(r.questionCategory, 'บทลงโทษ');
  assert.strictEqual(r.knowledgeHits, 1);
  assert.strictEqual(r.matchedKnowledge, 'หัวข้อทดสอบ');
  assert.strictEqual(r.modelName, 'model-ทดสอบ');
  assert.ok(r.responseTimeMs >= 1234, 'เวลาตอบสนองต้องคำนวณจาก receivedAt');
});

// ---- กลุ่ม 4: ฐานข้อมูลล่ม ผู้ใช้ต้องยังได้คำตอบ ----
// การบันทึกลงฐานข้อมูลเป็นงานรอง ต้องไม่ขวางการตอบคำถาม
test('RG-25 ฐานข้อมูลบันทึกผู้ใช้ล้มเหลว ผู้ใช้ต้องยังได้รับคำตอบ', () => {
  const r = runPrepareReply({ output: 'ภาษีที่ต้องชำระคือ 20,600 บาทค่ะ', upsertFailed: true });
  assert.ok(r.linePayload.messages[0].text.includes('20,600'), 'คำตอบต้องยังส่งถึงผู้ใช้');
  assert.ok(r.linePayload.replyToken, 'ต้องมี replyToken สำหรับตอบกลับ');
});

test('RG-26 ฐานข้อมูลล้มเหลว ต้องยังตอบผู้ใช้ได้ตามปกติ', () => {
  const r = runPrepareReply({ output: 'ภาษี 20,600 บาท', upsertFailed: true });
  assert.ok(r.answer.includes('20,600'), 'ตัวเลขที่ตอบผู้ใช้ต้องยังอยู่ครบ');
  assert.ok(!r.answer.includes(DISCLAIMER_MARK), 'ไม่ต่อคำเตือนท้ายคำตอบแล้ว');
});

test('RG-16 ชื่อแบบจำลองต้องเป็น unknown เมื่อไม่ได้ตั้งค่าตัวแปรสภาพแวดล้อม', () => {
  const fn = new Function('$input', '$', '$env', PREPARE_CODE);
  const out = fn(
    { first: () => ({ json: { output: 'คำตอบ' } }) },
    (name) =>
      ({
        'Extract LINE Data': { first: () => ({ json: { replyToken: 'T', userMessage: 'q', receivedAt: Date.now() } }) },
        'Upsert User': { first: () => ({ json: { id: 1 } }) },
        'Build Context': { first: () => ({ json: { questionCategory: 'อื่นๆ', knowledgeHits: 0, matchedKnowledge: null } }) },
      })[name],
    {}
  );
  assert.strictEqual(out[0].json.modelName, 'unknown');
});

// ---- เกณฑ์ความยาวแยกตามประเภทคำถาม ----
// คำถามคำนวณยาวได้ 700 ตัวอักษร (ต้องแจกแจงขั้นตอน) คำถามอธิบาย 420 ตัวอักษร
// กันไม่ให้กลับไปใช้ค่าเดียวทั้งระบบ และไม่ให้ตัดคำตอบที่สั้นอยู่แล้ว

const LONG_ANSWER = Array.from({ length: 40 }, (_, i) => `บรรทัดที่ ${i + 1} อธิบายเรื่องภาษี`).join('\n');

test('RG-32 คำถามอธิบายต้องถูกตัดสั้นกว่าคำถามคำนวณอย่างชัดเจน', () => {
  const explain = runPrepareReply({ output: LONG_ANSWER, questionCategory: 'สิทธิ์ลดหย่อน' });
  const calc = runPrepareReply({ output: LONG_ANSWER, questionCategory: 'คำนวณภาษี' });

  assert.ok(
    explain.answer.length < calc.answer.length,
    `คำตอบอธิบาย ${explain.answer.length} ต้องสั้นกว่าคำตอบคำนวณ ${calc.answer.length}`
  );
});

test('RG-33 คำตอบประเภทอธิบายต้องไม่เกิน 420 ตัวอักษร ไม่นับคำเตือนและข้อความชวนถามต่อ', () => {
  for (const category of ['สิทธิ์ลดหย่อน', 'กำหนดยื่นภาษี', 'กฎหมายภาษี']) {
    const r = runPrepareReply({ output: LONG_ANSWER, questionCategory: category });
    const body = r.answer.split('\n\nอยากรู้รายละเอียดเพิ่ม')[0];
    assert.ok(body.length <= 420, `หมวด ${category} ได้ ${body.length} ตัวอักษร`);
  }
});

test('RG-34 คำถามคำนวณต้องยังยาวได้ถึง 700 ตัวอักษร เพื่อให้แจกแจงขั้นตอนครบ', () => {
  for (const category of ['คำนวณภาษี', 'บทลงโทษ']) {
    const r = runPrepareReply({ output: LONG_ANSWER, questionCategory: category });
    const body = r.answer.split('\n\nอยากรู้รายละเอียดเพิ่ม')[0];
    assert.ok(body.length > 420, `หมวด ${category} ต้องยาวเกิน 420 แต่ได้ ${body.length}`);
    assert.ok(body.length <= 700, `หมวด ${category} ต้องไม่เกิน 700 แต่ได้ ${body.length}`);
  }
});

test('RG-35 คำตอบอธิบายที่สั้นอยู่แล้วต้องไม่ถูกแตะต้อง', () => {
  const short = 'ค่าลดหย่อนส่วนตัวหักได้ 60,000 บาทค่ะ ตามมาตรา 47(1)(ก)';
  const r = runPrepareReply({ output: short, questionCategory: 'สิทธิ์ลดหย่อน' });

  assert.ok(r.answer.startsWith(short), 'ข้อความเดิมต้องอยู่ครบ ไม่ถูกตัด');
  assert.ok(!r.answer.includes('อยากรู้รายละเอียดเพิ่ม'), 'ไม่ควรต่อข้อความชวนถามต่อ เพราะไม่ได้ถูกตัด');
});

test('RG-36 คำตอบที่ถูกตัดต้องบอกผู้ใช้ว่าถามต่อได้ ไม่ใช่จบห้วน ๆ', () => {
  const r = runPrepareReply({ output: LONG_ANSWER, questionCategory: 'สิทธิ์ลดหย่อน' });
  assert.ok(r.answer.includes('ถามต่อได้เลยค่ะ'));
});

// ---- บังคับคำลงท้าย ค่ะ ตามบุคลิกบอท (คุณภาษี เป็นผู้หญิง) ----
// สั่งในคำสั่งระบบแล้วแต่แบบจำลองยังหลุด ครับ บางครั้ง จึงแก้ด้วยโค้ด

test('RG-37 คำตอบต้องไม่มีคำว่า ครับ หลงเหลือ', () => {
  const r = runPrepareReply({
    output: 'ใช่ครับ เงินเพิ่มมีเพดานสูงสุดตามมาตรา 27 ครับ',
    questionCategory: 'บทลงโทษ',
  });
  assert.ok(!r.answer.includes('ครับ'), `ยังพบคำว่า ครับ ในคำตอบ: ${r.answer}`);
  assert.ok(r.answer.includes('ค่ะ'));
});

test('RG-38 แทนที่ ครับ แล้วต้องไม่เกิด ค่ะ ซ้อนกัน', () => {
  const r = runPrepareReply({ output: 'ขออภัยครับๆ', questionCategory: 'อื่นๆ' });
  assert.ok(!r.answer.includes('ค่ะๆ'), `พบคำลงท้ายซ้อนกัน: ${r.answer}`);
});

test('RG-39 คำตอบที่ใช้ ค่ะ อยู่แล้วต้องไม่ถูกแก้', () => {
  const original = 'ค่าลดหย่อนส่วนตัวหักได้ 60,000 บาทค่ะ';
  const r = runPrepareReply({ output: original, questionCategory: 'สิทธิ์ลดหย่อน' });
  assert.ok(r.answer.startsWith(original));
});

// ---- บรรทัด "คำนวณจาก" ต้องเติมด้วยโค้ด (แบบจำลองไม่ยกมาเองแม้สั่งไว้) ----
// ให้เห็นว่าระบบตีความโจทย์อย่างไร (เช่น บุตรสอง = 2 คน) และเห็นเมื่อแบบจำลองส่งค่าผิดช่อง

function runWithSteps(output, steps, questionCategory = 'คำนวณภาษี') {
  const fn = new Function('$input', '$', '$env', PREPARE_CODE);
  return fn(
    { first: () => ({ json: { output, intermediateSteps: steps } }) },
    (name) =>
      ({
        'Extract LINE Data': {
          first: () => ({ json: { replyToken: 'T', userMessage: 'q', receivedAt: Date.now() } }),
        },
        'Upsert User': { first: () => ({ json: { id: 1, consent_status: 'granted' } }) },
        'Build Context': {
          first: () => ({ json: { questionCategory, knowledgeHits: 2, matchedKnowledge: 'x' } }),
        },
      })[name],
    {}
  )[0].json;
}

const STEP = [
  {
    observation: JSON.stringify({
      สำเร็จ: true,
      คำนวณจาก: 'เงินเดือน 600,000 บาท · ค่าลดหย่อนบุตร 2 คน 60,000 บาท',
      สรุป: { ภาษีที่ต้องชำระ: 15500 },
    }),
  },
];

test('RG-40 ต้องเติมบรรทัดคำนวณจากให้เอง เมื่อแบบจำลองไม่ยกมา', () => {
  const r = runWithSteps('ภาษีที่ต้องชำระคือ 15,500 บาทค่ะ', STEP);
  assert.ok(r.answer.startsWith('คำนวณจาก '), `ไม่ได้เติมบรรทัดให้: ${r.answer.slice(0, 60)}`);
  assert.ok(r.answer.includes('บุตร 2 คน'), 'ต้องเห็นการตีความจำนวนบุตร');
  assert.ok(r.answer.includes('15,500'), 'คำตอบเดิมต้องยังอยู่ครบ');
});

test('RG-41 ถ้าแบบจำลองยกมาเองแล้ว ต้องไม่เติมซ้ำเป็นสองบรรทัด', () => {
  const r = runWithSteps('คำนวณจาก เงินเดือน 600,000 บาท\nภาษีที่ต้องชำระคือ 15,500 บาทค่ะ', STEP);
  const count = (r.answer.match(/คำนวณจาก/g) || []).length;
  assert.strictEqual(count, 1, `พบบรรทัดคำนวณจาก ${count} ครั้ง`);
});

test('RG-42 คำถามที่ไม่ได้เรียกเครื่องคำนวณ ต้องไม่มีบรรทัดนี้', () => {
  const r = runWithSteps('ค่าลดหย่อนส่วนตัวหักได้ 60,000 บาทค่ะ', [], 'สิทธิ์ลดหย่อน');
  assert.ok(!r.answer.includes('คำนวณจาก'));
});

test('RG-43 ข้อมูลขั้นตอนกลางผิดรูปแบบ ต้องไม่ทำให้ระบบพัง', () => {
  // n8n อาจเปลี่ยนโครงสร้างในเวอร์ชันใหม่ ระบบต้องยังตอบผู้ใช้ได้เสมอ
  for (const steps of [undefined, null, 'ไม่ใช่อาร์เรย์', [{}], [{ observation: 'ไม่ใช่ JSON' }]]) {
    const r = runWithSteps('ภาษีที่ต้องชำระคือ 15,500 บาทค่ะ', steps);
    assert.ok(r.answer.includes('15,500'), `พังเมื่อขั้นตอนกลางเป็น ${JSON.stringify(steps)}`);
  }
});

test('RG-44 ข้อความแจ้งข้อผิดพลาดต้องไม่ถูกเติมบรรทัดคำนวณจาก', () => {
  const r = runWithSteps('', STEP);
  assert.ok(!r.answer.includes('คำนวณจาก'), 'ไม่มีการคำนวณเกิดขึ้น จึงไม่ควรมีบรรทัดนี้');
});

// ---- reply token หมดอายุ ต้องสลับไปส่งด้วย Push API ----
// reply token ใช้ได้ราว 60 วินาที ถ้าหมดแล้ว LINE จะปฏิเสธและผู้ใช้ไม่ได้รับอะไรเลย
// แบบจำลองช้าเป็นครั้งคราวโดยควบคุมไม่ได้ จึงต้องมีทางสำรอง

const wfJson = () => JSON.parse(fs.readFileSync(WORKFLOW, 'utf8'));
const findNode = (name) => wfJson().nodes.find((n) => n.name === name);

test('RG-45 คำตอบที่ตอบทันเวลา ต้องเลือกส่งด้วย Reply API ซึ่งใช้ฟรี', () => {
  const r = runPrepareReply({ output: 'คำตอบทดสอบ', elapsedMs: 2000 });
  assert.strictEqual(r.useReplyToken, true);
  assert.strictEqual(r.linePayload.replyToken, 'TOKEN-TEST');
});

test('RG-46 คำตอบที่ช้าจน token หมดอายุ ต้องเปลี่ยนไปใช้ Push API', () => {
  const r = runPrepareReply({ output: 'คำตอบทดสอบ', elapsedMs: 65000 });
  assert.strictEqual(r.useReplyToken, false, 'ช้า 65 วินาทีแล้วยังจะใช้ reply token อยู่');
  assert.strictEqual(r.pushPayload.to, 'U-ผู้ใช้ทดสอบ', 'ต้องส่งเข้าห้องแชทของผู้ใช้คนที่ถาม');
});

test('RG-47 เกณฑ์เวลาต้องเผื่อไว้ก่อนถึง 60 วินาที ไม่ใช่ตั้งชิดเส้นพอดี', () => {
  // เผื่อเวลาเครือข่ายและโหนดถัดไป ถ้าตั้งชิด 60 วินาทีพอดีอาจส่งไม่ทัน
  const ก่อนเส้น = runPrepareReply({ output: 'คำตอบ', elapsedMs: 55000 });
  assert.strictEqual(ก่อนเส้น.useReplyToken, false, 'ที่ 55 วินาทีควรเผื่อไว้แล้ว');
});

test('RG-48 ทั้งสองช่องทางต้องส่งข้อความเดียวกัน ผู้ใช้ต้องไม่ได้คำตอบที่ต่างกัน', () => {
  const เร็ว = runPrepareReply({ output: 'คำตอบทดสอบ', elapsedMs: 2000 });
  const ช้า = runPrepareReply({ output: 'คำตอบทดสอบ', elapsedMs: 65000 });
  assert.strictEqual(เร็ว.linePayload.messages[0].text, เร็ว.pushPayload.messages[0].text);
  assert.strictEqual(ช้า.linePayload.messages[0].text, ช้า.pushPayload.messages[0].text);
});

test('RG-49 เวิร์กโฟลว์ต้องมีด่านตัดสินใจและปลายทางครบทั้งสองทาง', () => {
  const conn = wfJson().connections;
  assert.ok(findNode('Check Reply Token'), 'ไม่พบโหนด Check Reply Token');
  assert.ok(findNode('Push to LINE'), 'ไม่พบโหนด Push to LINE');

  const branches = conn['Check Reply Token'].main;
  assert.strictEqual(branches[0][0].node, 'Reply to LINE', 'ทางจริงต้องไป Reply API');
  assert.strictEqual(branches[1][0].node, 'Push to LINE', 'ทางเท็จต้องไป Push API');
});

test('RG-50 Push API ต้องยิงไปที่ปลายทางของตัวเอง ไม่ใช่ปลายทางของ Reply', () => {
  const push = findNode('Push to LINE');
  assert.ok(/\/message\/push$/.test(push.parameters.url), `ปลายทางผิด: ${push.parameters.url}`);
  assert.ok(
    push.parameters.jsonBody.includes('pushPayload'),
    'Push API ต้องใช้ pushPayload ไม่ใช่ linePayload ที่มี replyToken อยู่ข้างใน'
  );
});

test('RG-51 การบันทึกบทสนทนาต้องเกิดขึ้นไม่ว่าจะส่งทางไหน', () => {
  // ถ้าต่อ Log Conversation หลังด่านตัดสินใจ จะบันทึกได้แค่ทางเดียว และข้อมูลกรณีตอบช้าจะหาย
  const targets = JSON.parse(fs.readFileSync(WORKFLOW, 'utf8')).connections['Prepare LINE Reply']
    .main[0].map((x) => x.node);
  assert.ok(targets.includes('Log Conversation'), 'ต้องบันทึกจากจุดก่อนแยกทาง');
  assert.ok(targets.includes('Check Reply Token'));
});


// ---- ด่านกันแบบจำลองเขียนทับตัวเลขจากเครื่องคำนวณ ----
// ข้อมูลตัวอย่างมาจากผลวัดจริง: เครื่องคำนวณได้ 3,500 บาท แต่แบบจำลองตอบ 0 บาท "ได้รับยกเว้น"
// คำสั่งระบบห้ามไว้แล้วแต่ไม่ได้ผล จึงตรวจด้วยโค้ดหลังแบบจำลองตอบ

const ผลค่าเช่า400000 = {
  สำเร็จ: true,
  ปีภาษี: 2567,
  คำนวณจาก: '40(5) ค่าเช่า (building) 400,000 บาท',
  สรุป: {
    เงินได้พึงประเมินรวม: 400000,
    หักค่าใช้จ่าย: 120000,
    หักค่าลดหย่อน: 60000,
    หักเงินบริจาค: 0,
    เงินได้สุทธิ: 220000,
    ภาษีที่ต้องชำระ: 3500,
    ภาษีหักณที่จ่าย: 0,
    ต้องชำระเพิ่ม: 3500,
  },
};

const คำตอบผิดจริงจากการวัดผล =
  'ภาษีที่ต้องชำระคือ 0 บาทค่ะ เนื่องจากได้รับยกเว้นภาษีตามมาตรา 48(2) แห่งประมวลรัษฎากร ' +
  'คำนวณจาก 40(5) ค่าเช่า (building) 400,000 บาท - เงินได้รวม 400,000 บาท - ' +
  'หักค่าใช้จ่าย 120,000 บาท - หักค่าลดหย่อน 60,000 บาท - เงินได้สุทธิ 220,000 บาท - ' +
  'ภาษีที่ต้องชำระ 0 บาท (ได้รับยกเว้น) 🏠';

test('RG-52 คำตอบที่ทิ้งตัวเลขจากเครื่องคำนวณ ต้องถูกเขียนใหม่จากผลของเครื่องมือ', () => {
  const r = runPrepareReply({
    output: คำตอบผิดจริงจากการวัดผล,
    ผลเครื่องมือ: ผลค่าเช่า400000,
  });
  assert.strictEqual(r['ด่านตัวเลขทำงาน'], true, 'ด่านต้องจับได้ว่าคำตอบไม่มีตัวเลขของเครื่องมือ');
  assert.ok(r.answer.includes('3,500'), 'คำตอบใหม่ต้องมีตัวเลขจริงจากเครื่องคำนวณ');
});

test('RG-53 เหตุผลทางกฎหมายที่แบบจำลองแต่งขึ้น ต้องหายไปพร้อมกับตัวเลขผิด', () => {
  // ต้องลบเหตุผลที่แต่งขึ้นด้วย ไม่งั้นจะได้ "3,500 บาท เนื่องจากได้รับยกเว้น" ซึ่งขัดกันเอง
  const r = runPrepareReply({
    output: คำตอบผิดจริงจากการวัดผล,
    ผลเครื่องมือ: ผลค่าเช่า400000,
  });
  assert.ok(!r.answer.includes('48(2)'), 'ข้ออ้างทางกฎหมายที่ไม่ถูกต้องต้องไม่หลงเหลือ');
  assert.ok(!r.answer.includes('ยกเว้น'), 'คำว่ายกเว้นต้องไม่หลงเหลืออยู่ในคำตอบ');
});

test('RG-54 คำตอบที่ถูกต้องอยู่แล้ว ต้องไม่ถูกด่านแตะต้อง', () => {
  // ข้อสำคัญที่สุดของกลุ่ม: ด่านที่ทำงานพร่ำเพรื่อจะทำลายคำตอบที่ดี
  const ดีอยู่แล้ว = 'ภาษีที่ต้องชำระคือ 3,500 บาทค่ะ คำนวณจากค่าเช่า 400,000 บาท';
  const r = runPrepareReply({ output: ดีอยู่แล้ว, ผลเครื่องมือ: ผลค่าเช่า400000 });
  assert.notStrictEqual(r['ด่านตัวเลขทำงาน'], true, 'ด่านไม่ควรทำงานกับคำตอบที่ถูกต้อง');
  assert.ok(r.answer.startsWith(ดีอยู่แล้ว), 'คำตอบเดิมต้องถูกส่งต่อโดยไม่ถูกดัดแปลง');
});

test('RG-55 ตัวเลขที่เขียนแบบไม่มีลูกน้ำ ต้องนับว่าตรงกัน', () => {
  const r = runPrepareReply({
    output: 'ภาษีที่ต้องชำระคือ 3500 บาทค่ะ',
    ผลเครื่องมือ: ผลค่าเช่า400000,
  });
  assert.notStrictEqual(r['ด่านตัวเลขทำงาน'], true, '3500 กับ 3,500 คือจำนวนเดียวกัน');
});

test('RG-56 คำถามที่ไม่ได้เรียกเครื่องคำนวณ ด่านต้องไม่ทำงาน', () => {
  const r = runPrepareReply({ output: 'ยื่นภาษีได้ถึงวันที่ 31 มีนาคม ค่ะ' });
  assert.notStrictEqual(r['ด่านตัวเลขทำงาน'], true);
  assert.ok(r.answer.startsWith('ยื่นภาษีได้ถึงวันที่ 31 มีนาคม'));
});

test('RG-57 ด่านต้องครอบคลุมเครื่องคำนวณค่าปรับด้วย ไม่ใช่เฉพาะเครื่องคำนวณภาษี', () => {
  const ผลค่าปรับ = {
    สำเร็จ: true,
    สรุป: {
      ภาษีที่ต้องชำระ: 10000,
      เงินเพิ่ม: 450,
      ค่าปรับ: 2000,
      รวมที่ต้องชำระเพิ่ม: 2450,
      รวมทั้งสิ้นพร้อมภาษี: 12450,
    },
  };
  const r = runPrepareReply({
    output: 'ไม่ต้องเสียค่าปรับค่ะ เพราะยื่นล่าช้าไม่เกินกำหนด',
    ผลเครื่องมือ: ผลค่าปรับ,
  });
  assert.strictEqual(r['ด่านตัวเลขทำงาน'], true);
  assert.ok(r.answer.includes('2,450'), 'ต้องแสดงยอดที่ต้องชำระเพิ่มจริง');
});

test('RG-58 คำตอบที่ถูกเขียนใหม่ ต้องยังมีข้อความกำกับตามเงื่อนไขงานวิจัย', () => {
  const r = runPrepareReply({
    output: คำตอบผิดจริงจากการวัดผล,
    ผลเครื่องมือ: ผลค่าเช่า400000,
  });
  assert.ok(!r.answer.includes(DISCLAIMER_MARK), 'ไม่ต่อคำเตือนท้ายคำตอบแล้ว');
  assert.ok(r.answer.length <= LINE_MAX);
});

test('RG-59 ด่านต้องไม่กลบข้อความแจ้งข้อผิดพลาดของระบบ', () => {
  // แบบจำลองล้มเหลวแต่เครื่องมือสำเร็จ: ห้ามเอาผลเครื่องมือมาสร้างคำตอบทับข้อความขัดข้อง
  const r = runPrepareReply({ output: '', ผลเครื่องมือ: ผลค่าเช่า400000 });
  assert.match(r.answer, /ระบบขัดข้องชั่วคราว/);
});

test('RG-60 ผลเครื่องมือที่อ่านไม่ออก ต้องไม่ทำให้โหนดทั้งโหนดล้มเหลว', () => {
  // ถ้าด่านโยน error ผู้ใช้จะไม่ได้คำตอบเลย ซึ่งแย่กว่าได้คำตอบที่ยังไม่ผ่านด่าน
  const code = loadNodeCode('Prepare LINE Reply');
  const $input = {
    first: () => ({
      json: { output: 'คำตอบปกติค่ะ', intermediateSteps: [{ observation: 'ไม่ใช่ JSON เลย' }] },
    }),
  };
  const $ = (name) =>
    ({
      first: () => ({
        json: {
          'Extract LINE Data': { replyToken: 'T', lineUserId: 'U', userMessage: 'x', receivedAt: Date.now() },
          'Upsert User': { id: 1 },
          'Build Context': { matchedKnowledge: 'x', knowledgeHits: 1, questionCategory: 'ทั่วไป' },
        }[name],
      }),
    });
  assert.doesNotThrow(() => new Function('$input', '$', '$env', code)($input, $, {}));
});

// ---- กันข้อความภายในของด่านหลุดถึงผู้ใช้ และอิโมจิที่บังคับด้วยโค้ด ----
// เคยพบแบบจำลองคัดลอกคำสั่ง "ให้เรียกเครื่องมือใหม่" ของด่านไปตอบผู้ใช้ตรง ๆ

test('RG-61 คำสั่งภายในของด่าน ห้ามหลุดไปถึงผู้ใช้', () => {
  // ข้อความจริงจากไฟล์ผลวัด ไม่ได้แต่งขึ้น
  const ที่หลุดจริง =
    'เรียกเครื่องมือนี้ใหม่อีกครั้ง โดยย้ายช่องที่ระบุไว้ไปอยู่ในชั้นที่ถูกต้อง ' +
    'ห้ามตอบผู้ใช้ด้วยตัวเลขใด ๆ ก่อนที่จะเรียกใหม่และได้ผลลัพธ์ที่สำเร็จ';
  const r = runPrepareReply({ output: ที่หลุดจริง, questionCategory: 'คำนวณภาษี' });

  assert.ok(
    r.answer.indexOf('เรียกเครื่องมือ') < 0,
    'ต้องไม่เหลือคำสั่งภายในอยู่ในคำตอบเลย'
  );
  assert.ok(
    r.answer.indexOf('ห้ามตอบผู้ใช้') < 0,
    'วลีที่เขียนไว้คุยกับแบบจำลอง ห้ามโผล่ให้คนอ่าน'
  );
  assert.match(r.answer, /ขอโทษ/, 'ต้องแทนด้วยข้อความขอโทษที่คนอ่านรู้เรื่อง');
  assert.match(r.answer, /รายงานปัญหา/, 'และต้องบอกทางออกให้ผู้ใช้ไปต่อได้');
});

test('RG-62 ข้อความปฏิเสธของด่านอื่น ต้องถูกดักด้วยเหมือนกัน', () => {
  for (const ข้อความภายใน of [
    'ข้อมูลนำเข้าวางผิดชั้น ระบบจึงยังไม่คำนวณให้',
    'ข้อมูลนำเข้าผิดชนิด ระบบจึงยังไม่คำนวณให้',
    'ช่อง profession ใน income ได้รับค่า "medical" ซึ่งเครื่องคำนวณอ่านไม่ได้',
  ]) {
    const r = runPrepareReply({ output: ข้อความภายใน, questionCategory: 'คำนวณภาษี' });
    assert.match(r.answer, /ขอโทษ/, `ยังหลุด: ${ข้อความภายใน.slice(0, 30)}`);
  }
});

test('RG-63 คำตอบปกติที่บังเอิญมีคำใกล้เคียง ต้องไม่ถูกดักผิด', () => {
  // ดักเฉพาะวลีที่ไม่มีในคำตอบภาษีปกติ ถ้าดักกว้างไปจะกลืนคำตอบดีทิ้ง
  const คำตอบปกติ = [
    'ภาษีที่ต้องชำระคือ 20,600 บาทค่ะ',
    'สิ่งที่ต้องทำคือยื่นแบบ ภ.ง.ด.90 ภายใน 31 มีนาคม ค่ะ',
    'ถ้ามีข้อผิดพลาดในแบบที่ยื่นไปแล้ว ยื่นเพิ่มเติมได้ค่ะ',
    'ค่าลดหย่อนส่วนตัวหักได้ 60,000 บาทค่ะ',
  ];
  for (const ข้อความ of คำตอบปกติ) {
    const r = runPrepareReply({ output: ข้อความ, questionCategory: 'สิทธิ์ลดหย่อน' });
    assert.ok(
      r.answer.indexOf('ยังประมวลคำถามนี้ไม่สำเร็จ') < 0,
      `คำตอบปกติถูกดักผิด: ${ข้อความ}`
    );
  }
});

test('RG-64 ทุกคำตอบต้องมีอิโมจิ และต้องอยู่บรรทัดแรกเท่านั้น', () => {
  const r = runPrepareReply({
    output: 'ภาษีที่ต้องชำระคือ 20,600 บาทค่ะ\n- เงินได้รวม 600,000 บาท\n- หักค่าใช้จ่าย 100,000 บาท',
    questionCategory: 'คำนวณภาษี',
  });
  const บรรทัด = r.answer.split('\n');
  const นับ = (s) => (s.match(/\p{Extended_Pictographic}/gu) || []).length;

  assert.strictEqual(นับ(บรรทัด[0]), 1, 'บรรทัดแรกต้องมีอิโมจิหนึ่งตัว');
  for (let i = 1; i < บรรทัด.length; i++) {
    assert.strictEqual(
      นับ(บรรทัด[i]),
      0,
      `บรรทัดที่ ${i + 1} ต้องสะอาด เพราะเป็นบรรทัดที่ผู้ใช้ใช้อ่านเทียบยอด`
    );
  }
});

test('RG-65 ถ้าแบบจำลองใส่อิโมจิมาเองแล้ว ต้องไม่ใส่ซ้ำ', () => {
  const r = runPrepareReply({
    output: 'ภาษีที่ต้องชำระคือ 20,600 บาทค่ะ 🎯',
    questionCategory: 'คำนวณภาษี',
  });
  const นับ = (r.answer.match(/\p{Extended_Pictographic}/gu) || []).length;
  assert.strictEqual(นับ, 1, 'ต้องเหลืออิโมจิตัวเดียว ไม่ใช่สองตัวติดกัน');
});

test('RG-66 หมวดบทลงโทษต้องไม่ใช้อิโมจิที่สื่ออารมณ์สนุก', () => {
  // ผู้ถามเรื่องค่าปรับกำลังเครียด อิโมจิยิ้มจะอ่านเหมือนเยาะเย้ย
  const r = runPrepareReply({
    output: 'เงินเพิ่มและค่าปรับรวม 2,450 บาทค่ะ',
    questionCategory: 'บทลงโทษ',
  });
  const ห้ามใช้ = ['😊', '😄', '🎉', '👍', '😁', '🥳', '😂'];
  for (const e of ห้ามใช้) {
    assert.ok(r.answer.indexOf(e) < 0, `หมวดบทลงโทษห้ามใช้ ${e}`);
  }
  assert.ok(
    (r.answer.match(/\p{Extended_Pictographic}/gu) || []).length === 1,
    'แต่ยังต้องมีอิโมจิกลาง ๆ หนึ่งตัว'
  );
});
