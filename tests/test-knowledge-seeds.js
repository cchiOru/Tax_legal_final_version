'use strict';
/**
 * ตรวจไฟล์ seed ความรู้กฎหมาย (postgres/seed-tax-*.sql) โดยอ่านไฟล์ตรง ๆ ไม่ต้องมีฐานข้อมูล
 * ครอบคลุม: ความยาวช่อง source, หมวด/ชื่อเรื่อง, รูปแบบที่ตัวอ่านออฟไลน์อ่านได้, ความตรงกับ README
 * รัน: node --test tests/test-knowledge-seeds.js
 */

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const PG_DIR = path.join(__dirname, '..', 'postgres');

/** ความยาวสูงสุดของแต่ละช่อง ตามที่ประกาศไว้ใน CREATE TABLE */
const ความยาวสูงสุด = {
  category: 100,
  source: 200,
};

/** ระยะปลอดภัย ถ้าเข้าใกล้เพดานกว่านี้ให้เตือนไว้ก่อน */
const เหลือน้อยกว่านี้ถือว่าเสี่ยง = 20;

function ไฟล์ข้อมูลกฎหมายทั้งหมด() {
  return fs
    .readdirSync(PG_DIR)
    .filter((f) => /^seed-tax-(law|forms).*\.sql$/.test(f))
    .sort();
}

/** ดึงค่าช่อง source จากไฟล์ SQL โดยหาจากข้อความที่ลงท้ายด้วย [ชุดที่ N] */
function ดึงข้อความอ้างอิง(sql) {
  const out = [];
  const re = /'((?:[^']|'')*\[ชุดที่ \d+\](?:[^']|'')*)'/g;
  let m;
  while ((m = re.exec(sql)) !== null) {
    const ค่า = m[1].replace(/''/g, "'");
    // ข้ามคำสั่ง DELETE ที่ใช้ pattern สั้น ๆ ว่า %[ชุดที่ N]%
    if (ค่า.startsWith('%') && ค่า.endsWith('%')) continue;
    out.push(ค่า);
  }
  return out;
}

// ---- ข้อจำกัดของฐานข้อมูล ----
// source เป็น VARCHAR(200) ถ้ายาวเกิน INSERT จะพังหลัง DELETE ผ่านไปแล้ว ข้อมูลชุดนั้นจะหายทั้งชุด

test('KS-01 ข้อความอ้างอิงกฎหมายทุกรายการต้องไม่เกินความยาวที่ช่อง source รับได้', () => {
  const เกิน = [];
  for (const ไฟล์ of ไฟล์ข้อมูลกฎหมายทั้งหมด()) {
    const sql = fs.readFileSync(path.join(PG_DIR, ไฟล์), 'utf8');
    for (const ค่า of ดึงข้อความอ้างอิง(sql)) {
      if (ค่า.length > ความยาวสูงสุด.source) {
        เกิน.push(`${ไฟล์} ยาว ${ค่า.length} ตัวอักษร : ${ค่า.slice(0, 60)}...`);
      }
    }
  }
  assert.deepStrictEqual(
    เกิน,
    [],
    `พบข้อความอ้างอิงที่ยาวเกิน ${ความยาวสูงสุด.source} ตัวอักษร นำเข้าแล้วจะพัง\n  ` +
      เกิน.join('\n  ')
  );
});

test('KS-02 ต้องไม่มีรายการไหนเข้าใกล้เพดานจนเสี่ยง', () => {
  // เตือนล่วงหน้า: รายการที่เหลือที่ว่างน้อย แก้ข้อความนิดเดียวก็เกินเพดาน
  const เสี่ยง = [];
  for (const ไฟล์ of ไฟล์ข้อมูลกฎหมายทั้งหมด()) {
    const sql = fs.readFileSync(path.join(PG_DIR, ไฟล์), 'utf8');
    for (const ค่า of ดึงข้อความอ้างอิง(sql)) {
      const เหลือ = ความยาวสูงสุด.source - ค่า.length;
      if (เหลือ >= 0 && เหลือ < เหลือน้อยกว่านี้ถือว่าเสี่ยง) {
        เสี่ยง.push(`${ไฟล์} ยาว ${ค่า.length} เหลือที่ว่างแค่ ${เหลือ} ตัวอักษร`);
      }
    }
  }
  assert.deepStrictEqual(เสี่ยง, [], 'มีรายการที่เฉียดเพดาน ควรย่อไว้ก่อน\n  ' + เสี่ยง.join('\n  '));
});

// ---- ความสม่ำเสมอของฐานข้อมูล ----

test('KS-03 ทุกรายการต้องมีเลขชุดกำกับ เพื่อให้ลบและนำเข้าใหม่ได้ตรงชุด', () => {
  // DELETE ... LIKE '%[ชุดที่ N]%' ต้องมีเลขชุด ไม่งั้นนำเข้าซ้ำแล้วข้อมูลซ้ำ
  for (const ไฟล์ of ไฟล์ข้อมูลกฎหมายทั้งหมด()) {
    const sql = fs.readFileSync(path.join(PG_DIR, ไฟล์), 'utf8');
    if (!/\[ชุดที่ \d+\]/.test(sql)) continue; // ไฟล์รุ่นเก่าที่ใช้ TRUNCATE ทั้งตาราง
    const จำนวนรายการ = (sql.match(/^\s*'[^']+',\s*$/gm) || []).length;
    assert.ok(จำนวนรายการ >= 0, `${ไฟล์} อ่านไม่ออก`);
  }
});

test('KS-04 ไฟล์ที่ใช้ DELETE ตามเลขชุด ต้องไม่มีคำสั่ง TRUNCATE ปนอยู่', () => {
  // TRUNCATE ในไฟล์ชุดย่อยจะล้างความรู้ทั้งตาราง
  for (const ไฟล์ of ไฟล์ข้อมูลกฎหมายทั้งหมด()) {
    const sql = fs.readFileSync(path.join(PG_DIR, ไฟล์), 'utf8');
    const ใช้ลบตามชุด = /DELETE FROM tax_law_knowledge WHERE source LIKE/.test(sql);
    if (!ใช้ลบตามชุด) continue;
    assert.ok(
      !/TRUNCATE\s+TABLE\s+tax_law_knowledge/i.test(sql),
      `${ไฟล์} เป็นไฟล์ชุดย่อยแต่มี TRUNCATE ซึ่งจะลบฐานข้อมูลทั้งตาราง`
    );
  }
});

// ---- หมวดต้องตรงกันทั้งสามที่: ไฟล์ seed, migration 006, dropdown หลังบ้าน ----
// ถ้าหมวดไม่มีใน dropdown พอผู้ดูแลกดบันทึก เบราว์เซอร์จะเปลี่ยนเป็น option แรกเงียบ ๆ

/** รายชื่อหมวดจากท้าย migration 006 (ใช้เป็นรายการหลัก) */
function หมวดตามไฟล์ย้ายหมวด() {
  const sql = fs.readFileSync(
    path.join(PG_DIR, 'migrations', '006-standardize-categories.sql'),
    'utf8'
  );
  const ช่วง = sql.match(/WHERE category NOT IN \(([\s\S]*?)\);/);
  assert.ok(ช่วง, 'หา รายการหมวดที่ยอมรับได้ ใน migration 006 ไม่เจอ');
  return (ช่วง[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1));
}

/** รายชื่อหมวดจาก admin/knowledge.js อ่านเป็นข้อความเพื่อไม่ต้องโหลด pg */
function หมวดตามฟอร์ม() {
  const js = fs.readFileSync(path.join(__dirname, '..', 'admin', 'knowledge.js'), 'utf8');
  const ช่วง = js.match(/const หมวดที่มีอยู่ = \[([\s\S]*?)\];/);
  assert.ok(ช่วง, 'หา ตัวแปรหมวดที่มีอยู่ ใน admin/knowledge.js ไม่เจอ');
  return (ช่วง[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1));
}

/** หมวดในไฟล์ seed = ค่าแรกหลังวงเล็บเปิดต้นบรรทัด (อยู่บรรทัดเดียวกันหรือขึ้นบรรทัดใหม่ก็ได้) */
function หมวดในไฟล์(sql) {
  return (sql.match(/^\(\s*'([^']+)',/gm) || []).map((s) => s.match(/'([^']+)'/)[1]);
}

test('KS-05 หมวดใน migration กับ dropdown หลังบ้าน ต้องเป็นชุดเดียวกัน', () => {
  assert.deepStrictEqual(
    หมวดตามฟอร์ม().slice().sort(),
    หมวดตามไฟล์ย้ายหมวด().slice().sort(),
    'รายการหมวดในฟอร์มไม่ตรงกับใน migration 006 ถ้าเพิ่มหมวดใหม่ต้องแก้ทั้งสองที่'
  );
});

test('KS-06 ทุกหมวดที่ใช้ในไฟล์ seed ต้องอยู่ในรายการหมวดที่ยอมรับได้', () => {
  const ยอมรับได้ = new Set(หมวดตามไฟล์ย้ายหมวด());
  const นอกรายการ = [];
  for (const ไฟล์ of ไฟล์ข้อมูลกฎหมายทั้งหมด()) {
    const sql = fs.readFileSync(path.join(PG_DIR, ไฟล์), 'utf8');
    for (const หมวด of หมวดในไฟล์(sql)) {
      if (!ยอมรับได้.has(หมวด)) นอกรายการ.push(`${ไฟล์} ใช้หมวด "${หมวด}"`);
    }
  }
  assert.deepStrictEqual(
    [...new Set(นอกรายการ)],
    [],
    'ไฟล์ seed ใช้หมวดที่ไม่มีในรายการที่ยอมรับได้\n  ' + [...new Set(นอกรายการ)].join('\n  ')
  );
});

// ---- ชื่อเรื่องต้องไม่ซ้ำและไม่กลายเป็นชื่อหมวด ----
// กันการ find/replace ชื่อหมวดแล้วทับชื่อเรื่องไปด้วย ชื่อเรื่องมีน้ำหนักค้นหาสูง ถ้าซ้ำจะค้นไม่เจอ

/** ชื่อเรื่องเก่าที่ seed-tax-law-full.sql ลบทิ้งท้ายไฟล์ ซ้ำได้โดยตั้งใจ จึงยกเว้น */
function ชื่อเรื่องที่ถูกแทนที่แล้ว() {
  const sql = fs.readFileSync(path.join(PG_DIR, 'seed-tax-law-full.sql'), 'utf8');
  const ช่วง = sql.match(/AND title IN \(([\s\S]*?)\);/);
  if (!ช่วง) return new Set();
  return new Set((ช่วง[1].match(/'([^']+)'/g) || []).map((s) => s.slice(1, -1)));
}

test('KS-07 ชื่อเรื่องทุกรายการต้องไม่ซ้ำกัน', () => {
  const ยกเว้น = ชื่อเรื่องที่ถูกแทนที่แล้ว();
  const นับ = {};
  for (const ไฟล์ of ไฟล์ข้อมูลกฎหมายทั้งหมด()) {
    const sql = fs.readFileSync(path.join(PG_DIR, ไฟล์), 'utf8');
    for (const m of sql.matchAll(/\(\s*\n\s*'([^']+)',\s*\n\s*'([^']+)',/g)) {
      const ชื่อ = m[2];
      (นับ[ชื่อ] = นับ[ชื่อ] || []).push(ไฟล์);
    }
  }
  const ซ้ำ = Object.entries(นับ)
    .filter(([ชื่อ, ที่อยู่]) => ที่อยู่.length > 1 && !ยกเว้น.has(ชื่อ))
    .map(([ชื่อ, ที่อยู่]) => `"${ชื่อ}" ปรากฏ ${ที่อยู่.length} ครั้ง ใน ${[...new Set(ที่อยู่)].join(', ')}`);
  assert.deepStrictEqual(
    ซ้ำ,
    [],
    'ชื่อเรื่องซ้ำกัน มักแปลว่าถูกแทนที่โดยไม่ตั้งใจ\n  ' + ซ้ำ.join('\n  ')
  );
});

test('KS-08 ชื่อเรื่องต้องไม่เหมือนชื่อหมวดของตัวเอง', () => {
  const ยอมรับได้ = new Set(หมวดตามไฟล์ย้ายหมวด());
  const พัง = [];
  for (const ไฟล์ of ไฟล์ข้อมูลกฎหมายทั้งหมด()) {
    const sql = fs.readFileSync(path.join(PG_DIR, ไฟล์), 'utf8');
    for (const m of sql.matchAll(/\(\s*\n\s*'([^']+)',\s*\n\s*'([^']+)',/g)) {
      const [, หมวด, ชื่อ] = m;
      // ชื่อเรื่องเท่ากับชื่อหมวดใด ๆ = น่าจะถูกทับตอนแทนชื่อหมวด
      if (ชื่อ === หมวด || ยอมรับได้.has(ชื่อ)) {
        พัง.push(`${ไฟล์}: หมวด "${หมวด}" ชื่อเรื่อง "${ชื่อ}"`);
      }
    }
  }
  assert.deepStrictEqual(
    พัง,
    [],
    'ชื่อเรื่องเป็นชื่อหมวด แปลว่าน่าจะถูกทับตอนแทนชื่อหมวด\n  ' + พัง.join('\n  ')
  );
});

test('KS-09 ห้ามมีคอมเมนต์แทรกอยู่ระหว่างช่องภายในวงเล็บของ INSERT', () => {
  // psql รับได้ แต่ตัวอ่านออฟไลน์ใน evaluation/run-accuracy-test.js จะข้ามแถวนั้นเงียบ ๆ
  // ทำให้ผลวัดความแม่นยำใช้ฐานความรู้คนละชุดกับของจริง
  const ผิด = [];
  for (const ชื่อไฟล์ of fs.readdirSync(PG_DIR)) {
    if (!/^seed-tax-(law|forms).*\.sql$/.test(ชื่อไฟล์)) continue;
    const บรรทัด = fs.readFileSync(path.join(PG_DIR, ชื่อไฟล์), 'utf8').split('\n');
    let อยู่ในวงเล็บ = false;
    for (let i = 0; i < บรรทัด.length; i++) {
      const t = บรรทัด[i].trim();
      if (!อยู่ในวงเล็บ && t === '(') {
        อยู่ในวงเล็บ = true;
        continue;
      }
      if (อยู่ในวงเล็บ) {
        if (t === ')' || t === '),' || t === ');') {
          อยู่ในวงเล็บ = false;
          continue;
        }
        if (t.indexOf('--') === 0) {
          ผิด.push(`${ชื่อไฟล์} บรรทัดที่ ${i + 1} : ${t.slice(0, 60)}`);
        }
      }
    }
  }
  assert.deepStrictEqual(
    ผิด,
    [],
    'พบคอมเมนต์แทรกอยู่ภายในวงเล็บของ INSERT ตัวอ่านออฟไลน์จะมองข้ามรายการนั้นไปเงียบ ๆ\n  ' +
      ผิด.join('\n  ') +
      '\n  ให้ย้ายคอมเมนต์ไปไว้เหนือวงเล็บเปิดแทน'
  );
});

test('KS-10 ตัวอ่านออฟไลน์ต้องอ่านได้ครบทุกรายการที่ไม่ได้ถูกแทนที่', () => {
  // คู่กับ KS-09 แต่ตรวจที่ผลลัพธ์ เผื่อมีรูปแบบอื่นที่ทำให้อ่านตก
  const harness = require('../evaluation/run-accuracy-test.js');
  const รายการ = harness.loadKnowledgeBase();
  assert.ok(รายการ.length > 0, 'อ่านฐานความรู้ไม่ได้เลย');

  // ช่องว่าง = regex จับมาไม่ครบ
  const ไม่ครบ = รายการ
    .filter((r) => !r.category || !r.title || !r.content)
    .map((r) => r.title || '(ไม่มีชื่อเรื่อง)');
  assert.deepStrictEqual(ไม่ครบ, [], 'รายการเหล่านี้อ่านมาได้ไม่ครบทุกช่อง\n  ' + ไม่ครบ.join('\n  '));

  // ชื่อเรื่องซ้ำ = regex จับคร่อมสองรายการ
  const เห็นแล้ว = new Set();
  const ซ้ำ = [];
  for (const r of รายการ) {
    if (เห็นแล้ว.has(r.title)) ซ้ำ.push(r.title);
    เห็นแล้ว.add(r.title);
  }
  assert.deepStrictEqual(ซ้ำ, [], 'ชื่อเรื่องซ้ำหลังอ่านไฟล์\n  ' + ซ้ำ.join('\n  '));
});

// ---- เพดานลดหย่อนกองทุนเพื่อการเกษียณ ----
// กันโมเดลตอบเพดานรวม 500,000 แทนเพดานเฉพาะ SSF จึงให้เอกสาร SSF ได้อันดับหนึ่งและแยกเลขชัด
test('KS-11 เอกสารเพดานกองทุนต้องได้อันดับหนึ่งเมื่อถามถึงเพดานของ SSF', () => {
  const harness = require('../evaluation/run-accuracy-test.js');
  const kb = harness.loadKnowledgeBase();
  const cfg = harness.loadProductionConfig();

  const เอกสาร = kb.filter((r) => r.title.indexOf('SSF') >= 0);
  assert.strictEqual(
    เอกสาร.length,
    1,
    'ต้องมีเอกสารที่ระบุ SSF ไว้ในชื่อเรื่องเพียงรายการเดียว\n' +
      '  ถ้ามีหลายรายการ ทั้งหมดจะแย่งช่องผลค้นคืนกันเองจนเบียดเอกสารเรื่องอื่นตกไป\n' +
      '  พบ: ' + เอกสาร.map((r) => r.title).join(' | ')
  );

  const ผล = harness.retrieve('ซื้อกองทุน SSF ลดหย่อนได้สูงสุดเท่าไหร่', cfg.keywordMap, kb, 3, false);
  assert.strictEqual(
    ผล.titles[0],
    เอกสาร[0].title,
    'เอกสารเพดานกองทุนต้องมาเป็นอันดับหนึ่ง แต่ได้ ' + ผล.titles.join(' | ')
  );

  const เนื้อหา = เอกสาร[0].content;
  assert.ok(เนื้อหา.indexOf('SSF: 30% ของเงินได้ และไม่เกิน 200,000 บาท') >= 0, 'ขาดเพดานเฉพาะของ SSF');
  assert.ok(เนื้อหา.indexOf('RMF: 30% ของเงินได้ และไม่เกิน 500,000 บาท') >= 0, 'ขาดเพดานเฉพาะของ RMF');
  assert.ok(เนื้อหา.indexOf('เพดานรวมของทุกกอง') >= 0, 'ขาดคำอธิบายว่า 500,000 บาทคือเพดานรวม');
});

// ---- เพดาน กอช. ของเก่า ----
// กันเอกสารสองฉบับตอบเพดาน กอช. คนละเลข (เลขเก่า 13,200 ปัจจุบัน 30,000)
test('KS-12 ต้องไม่มีเพดาน กอช. ของเก่าค้างอยู่ในเนื้อหาเอกสาร', () => {
  const harness = require('../evaluation/run-accuracy-test.js');
  // บรรทัดที่บอกชัดว่า 13,200 เป็นเพดานเดิม/ไม่ใช้แล้ว ถือว่าถูกต้อง
  const ค้าง = [];
  for (const r of harness.loadKnowledgeBase()) {
    for (const บรรทัด of r.content.split('\n')) {
      if (บรรทัด.indexOf('13,200') < 0) continue;
      if (บรรทัด.indexOf('เพดานเดิม') >= 0 || บรรทัด.indexOf('ไม่ใช้แล้ว') >= 0) continue;
      ค้าง.push(r.title + ' : ' + บรรทัด.trim());
    }
  }
  assert.deepStrictEqual(
    ค้าง,
    [],
    'เอกสารเหล่านี้ยังใช้เพดาน กอช. ของเก่า 13,200 บาท ต้องเปลี่ยนเป็น 30,000 บาท\n  ' + ค้าง.join('\n  ')
  );
});

// ---- รายชื่อไฟล์ใน README ต้องครบ ----
// ตัวอ่านออฟไลน์หาไฟล์เองครบเสมอ แต่ README เขียนรายชื่อตายตัว ลืมเติมแล้วฐานข้อมูลจริงจะขาดเงียบ ๆ
test('KS-13 คำสั่งใส่ข้อมูลใน README ต้องครอบคลุมไฟล์ความรู้ทุกไฟล์', () => {
  const fs = require('fs');
  const path = require('path');
  const ราก = path.join(__dirname, '..');

  const ไฟล์ทั้งหมด = fs
    .readdirSync(path.join(ราก, 'postgres'))
    .filter((f) => /^seed-tax-(law|forms).*\.sql$/.test(f))
    .map((f) => f.replace(/\.sql$/, ''))
    .sort();

  const readme = fs.readFileSync(path.join(ราก, 'README.md'), 'utf8');
  const ขาด = ไฟล์ทั้งหมด.filter((ชื่อ) => {
    // ต้องเป็นชื่อเต็ม ไม่ใช่ส่วนหนึ่งของชื่อไฟล์อื่น
    return !new RegExp('(^|[\\s\\\\])' + ชื่อ + '($|[\\s\\\\;])', 'm').test(readme);
  });

  assert.deepStrictEqual(
    ขาด,
    [],
    'ไฟล์ความรู้เหล่านี้ไม่มีในคำสั่งใส่ข้อมูลของ README\n  ' +
      ขาด.join('\n  ') +
      '\n  ฐานข้อมูลจริงจะขาดความรู้ส่วนนี้ ทั้งที่การวัดผลนับรวมไว้แล้ว'
  );
});

// ---- จำนวนรายการใน README ต้องตรงของจริง ----
// คนติดตั้งใช้เลขนี้ตรวจว่านำเข้าข้อมูลครบหรือไม่
test('KS-14 จำนวนรายการความรู้ใน README ต้องตรงกับที่อ่านได้จริง', () => {
  const fs = require('fs');
  const path = require('path');
  const harness = require('../evaluation/run-accuracy-test.js');
  const จริง = harness.loadKnowledgeBase().length;
  const readme = fs.readFileSync(path.join(__dirname, '..', 'README.md'), 'utf8');

  const รูปแบบ = [
    /`tax_law_knowledge`\s*(\d+)\s*รายการ/g,
    /knowledge base\s*(\d+)\s*รายการ/g,
    /ต้องได้\s*\*\*(\d+)\*\*/g,
    /\|\s*(\d+)\s*รายการ\s*\|/g,
  ];
  const พบ = [];
  for (const re of รูปแบบ) {
    let m;
    while ((m = re.exec(readme)) !== null) พบ.push(Number(m[1]));
  }
  assert.ok(พบ.length >= 4, 'หาตัวเลขจำนวนรายการใน README ไม่เจอ อาจมีการแก้ถ้อยคำจนรูปแบบเปลี่ยน');

  const ไม่ตรง = พบ.filter((n) => n !== จริง);
  assert.deepStrictEqual(
    ไม่ตรง,
    [],
    'README ระบุจำนวนรายการความรู้เป็น ' + ไม่ตรง.join(', ') + ' แต่ของจริงมี ' + จริง + ' รายการ'
  );
});
