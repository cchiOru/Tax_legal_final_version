'use strict';
/**
 * ทดสอบเครื่องคำนวณภาษีเงินได้บุคคลธรรมดาและค่าปรับยื่นล่าช้า (n8n/tools/tax-calculator.js)
 * รวมถึงด่านตรวจข้อมูลนำเข้าจากแบบจำลองก่อนคำนวณ
 * รัน: node --test tests/test-tax-calculator.js  (Node.js 18 ขึ้นไป)
 */

const test = require('node:test');
const assert = require('node:assert');
const {
  calculateThaiPIT,
  calcProgressiveTax,
  calculateLatePenalty,
  socialSecurityRule,
  SOCIAL_SECURITY_CAP_BY_YEAR,
  TAX_YEAR,
  ตรวจที่มาของค่าลดหย่อน,
  ตรวจความสอดคล้องของประเภทเงินได้,
  ปฏิเสธเพราะประเภทเงินได้ขัดแย้ง,
  ตรวจคีย์วางผิดชั้น,
  ปฏิเสธเพราะคีย์วางผิดชั้น,
  ชั้นที่ถูกของคีย์,
  ตรวจค่าผิดชนิด,
  ปฏิเสธเพราะค่าผิดชนิด,
  ชนิดที่ถูกของช่อง,
  ผนวกผลด่าน,
  คำบ่งชี้ค่าลดหย่อน,
} = require('../n8n/tools/tax-calculator');

// ---- กลุ่มที่ 1: ตัวอย่างอ้างอิง (ตัวเลขเดียวกับตัวอย่างใน postgres/seed-tax-law.sql) ----

test('TC-01 เงินเดือน 600,000 โสด ประกันสังคม 9,000 → ภาษี 20,600 บาท', () => {
  const r = calculateThaiPIT({
    income: { salary: 600000 },
    allowances: { socialSecurity: 9000 },
  });

  assert.strictEqual(r.สำเร็จ, true);
  assert.strictEqual(r.สรุป.หักค่าใช้จ่าย, 100000, 'ค่าใช้จ่ายต้องติดเพดาน 100,000 บาท');
  assert.strictEqual(r.สรุป.เงินได้หลังหักค่าใช้จ่าย, 500000);
  assert.strictEqual(r.สรุป.หักค่าลดหย่อน, 69000, 'ส่วนตัว 60,000 + ประกันสังคม 9,000');
  assert.strictEqual(r.สรุป.เงินได้สุทธิ, 431000);
  assert.strictEqual(r.สรุป.ภาษีที่ต้องชำระ, 20600);
});

test('TC-02 กรณีเดียวกับ TC-01 แต่ซื้อ RMF 100,000 → ภาษี 10,600 บาท (ประหยัด 10,000)', () => {
  const r = calculateThaiPIT({
    income: { salary: 600000 },
    allowances: { socialSecurity: 9000, rmf: 100000 },
  });

  assert.strictEqual(r.สรุป.เงินได้สุทธิ, 331000);
  assert.strictEqual(r.สรุป.ภาษีที่ต้องชำระ, 10600);
});

// ---- กลุ่มที่ 2: ขอบเขตขั้นบันไดภาษี ----

test('TC-03 เงินได้สุทธิ 150,000 บาท → ได้รับยกเว้น ภาษี 0 บาท', () => {
  assert.strictEqual(calcProgressiveTax(150000).tax, 0);
});

test('TC-04 เงินได้สุทธิ 150,001 บาท → เสียภาษีเฉพาะส่วนที่เกิน (0.05 บาท)', () => {
  assert.strictEqual(calcProgressiveTax(150001).tax, 0.05);
});

test('TC-05 เงินได้สุทธิ 300,000 บาท → ภาษี 7,500 บาท', () => {
  assert.strictEqual(calcProgressiveTax(300000).tax, 7500);
});

test('TC-06 เงินได้สุทธิ 1,000,000 บาท → ภาษี 115,000 บาท', () => {
  // 7,500 + 20,000 + 37,500 + 50,000
  assert.strictEqual(calcProgressiveTax(1000000).tax, 115000);
});

test('TC-07 เงินได้สุทธิ 5,000,000 บาท → ภาษี 1,265,000 บาท', () => {
  // 115,000 + 250,000 + 900,000
  assert.strictEqual(calcProgressiveTax(5000000).tax, 1265000);
});

test('TC-08 เงินได้สุทธิ 6,000,000 บาท → เข้าขั้น 35% ภาษี 1,615,000 บาท', () => {
  assert.strictEqual(calcProgressiveTax(6000000).tax, 1615000);
});

test('TC-09 เงินได้สุทธิ 0 บาท → ภาษี 0 บาท', () => {
  assert.strictEqual(calcProgressiveTax(0).tax, 0);
});

// ---- กลุ่มที่ 3: เพดานหักค่าใช้จ่าย (มาตรา 42 ทวิ) ----

test('TC-10 เงินเดือน 100,000 → หักค่าใช้จ่ายได้ 50% (50,000) ยังไม่ติดเพดาน', () => {
  const r = calculateThaiPIT({ income: { salary: 100000 } });
  assert.strictEqual(r.สรุป.หักค่าใช้จ่าย, 50000);
});

test('TC-11 เงินเดือน 40(1) 150,000 + รับจ้าง 40(2) 150,000 → เพดานรวม 100,000 ไม่ใช่ 200,000', () => {
  const r = calculateThaiPIT({ income: { salary: 150000, hire: 150000 } });
  assert.strictEqual(r.สรุป.หักค่าใช้จ่าย, 100000, 'มาตรา 42 ทวิ กำหนดให้ 40(1)+40(2) รวมกันไม่เกิน 100,000');
});

test('TC-12 เงินได้ 40(8) ธุรกิจ 1,000,000 → หักเหมา 60% = 600,000 ไม่มีเพดาน', () => {
  const r = calculateThaiPIT({ income: { business: 1000000 } });
  assert.strictEqual(r.สรุป.หักค่าใช้จ่าย, 600000);
});

test('TC-13 เงินได้ 40(6) แพทย์ หักได้ 60% ส่วนวิชาชีพอื่นหักได้ 30%', () => {
  const medical = calculateThaiPIT({ income: { profession: 1000000 }, options: { professionType: 'medical' } });
  const other = calculateThaiPIT({ income: { profession: 1000000 } });
  assert.strictEqual(medical.สรุป.หักค่าใช้จ่าย, 600000);
  assert.strictEqual(other.สรุป.หักค่าใช้จ่าย, 300000);
});

test('TC-14 เงินได้ 40(4) ดอกเบี้ย/เงินปันผล หักค่าใช้จ่ายไม่ได้', () => {
  const r = calculateThaiPIT({ income: { interestDividend: 500000 } });
  assert.strictEqual(r.สรุป.หักค่าใช้จ่าย, 0);
});

// ---- กลุ่มที่ 4: เพดานค่าลดหย่อน (มาตรา 47) ----

test('TC-15 RMF ต้องไม่เกิน 30% ของเงินได้', () => {
  // เงินได้ 500,000 → RMF หักได้สูงสุด 150,000 แม้ผู้ใช้ซื้อ 400,000
  const r = calculateThaiPIT({ income: { salary: 500000 }, allowances: { rmf: 400000 } });
  const rmf = r.รายละเอียดค่าลดหย่อน.find((d) => d.รายการ === 'กองทุน RMF');
  assert.strictEqual(rmf.จำนวน, 150000);
});

test('TC-16 SSF ต้องไม่เกิน 200,000 บาท แม้ 30% ของเงินได้จะสูงกว่า', () => {
  const r = calculateThaiPIT({ income: { salary: 3000000 }, allowances: { ssf: 500000 } });
  const ssf = r.รายละเอียดค่าลดหย่อน.find((d) => d.รายการ === 'กองทุน SSF');
  assert.strictEqual(ssf.จำนวน, 200000);
});

test('TC-17 กองทุนเพื่อการเกษียณรวมกันต้องไม่เกิน 500,000 บาท', () => {
  const r = calculateThaiPIT({
    income: { salary: 5000000 },
    allowances: { rmf: 500000, ssf: 200000, pvd: 500000 },
  });
  const retirementLabels = ['กองทุน RMF', 'กองทุน SSF', 'กองทุนสำรองเลี้ยงชีพ/กบข.'];
  const sum = r.รายละเอียดค่าลดหย่อน
    .filter((d) => retirementLabels.includes(d.รายการ))
    .reduce((s, d) => s + d.จำนวน, 0);
  assert.ok(Math.abs(sum - 500000) < 0.05, `รวมกองทุนเกษียณต้องเท่ากับ 500,000 แต่ได้ ${sum}`);
  assert.ok(Array.isArray(r.หมายเหตุเพิ่มเติม) && r.หมายเหตุเพิ่มเติม.length > 0, 'ต้องมีหมายเหตุแจ้งว่าถูกปรับลดตามเพดาน');
});

test('TC-18 ประกันชีวิต + ประกันสุขภาพ รวมกันไม่เกิน 100,000 บาท', () => {
  const r = calculateThaiPIT({
    income: { salary: 1000000 },
    allowances: { lifeInsurance: 100000, healthInsurance: 25000 },
  });
  const item = r.รายละเอียดค่าลดหย่อน.find((d) => d.รายการ === 'เบี้ยประกันชีวิตและประกันสุขภาพตนเอง');
  assert.strictEqual(item.จำนวน, 100000);
});

test('TC-19 ประกันสังคมหักได้ไม่เกิน 9,000 บาท', () => {
  const r = calculateThaiPIT({ income: { salary: 1000000 }, allowances: { socialSecurity: 20000 } });
  const sso = r.รายละเอียดค่าลดหย่อน.find((d) => d.รายการ === 'เงินสมทบกองทุนประกันสังคม');
  assert.strictEqual(sso.จำนวน, 9000);
});

test('TC-20 ค่าลดหย่อนบิดามารดา นับได้สูงสุด 4 คน', () => {
  const r = calculateThaiPIT({ income: { salary: 1000000 }, allowances: { parents: 6 } });
  const item = r.รายละเอียดค่าลดหย่อน.find((d) => String(d.รายการ).startsWith('ค่าลดหย่อนบิดามารดา'));
  assert.strictEqual(item.จำนวน, 120000, 'สูงสุด 4 คน × 30,000 บาท');
});

test('TC-21 ครอบครัว: คู่สมรส + บุตร 2 คน ลดหย่อนได้ถูกต้อง', () => {
  const r = calculateThaiPIT({
    income: { salary: 1200000 },
    allowances: { spouse: true, children: 2 },
  });
  // ส่วนตัว 60,000 + คู่สมรส 60,000 + บุตร 2 คน 60,000 = 180,000
  assert.strictEqual(r.สรุป.หักค่าลดหย่อน, 180000);
});

// ---- กลุ่มที่ 5: เงินบริจาค (เพดาน 10% ของฐาน) ----

test('TC-22 บริจาคเพื่อการศึกษา หักได้ 2 เท่า แต่ไม่เกิน 10% ของฐาน', () => {
  const r = calculateThaiPIT({
    income: { salary: 1000000 },
    allowances: { donationEducation: 30000 },
  });
  // ฐาน 1,000,000 - 100,000 - 60,000 = 840,000 → เพดาน 84,000; บริจาค 30,000 × 2 = 60,000
  assert.strictEqual(r.สรุป.หักเงินบริจาค, 60000);
});

test('TC-23 บริจาคเกินเพดาน 10% ต้องถูกตัดให้เหลือเท่าเพดาน', () => {
  const r = calculateThaiPIT({
    income: { salary: 1000000 },
    allowances: { donationGeneral: 500000 },
  });
  assert.strictEqual(r.สรุป.หักเงินบริจาค, 84000, 'เพดาน 10% ของ 840,000');
});

// ---- กลุ่มที่ 6: ภาษีขั้นต่ำตามมาตรา 48(2) ----

test('TC-24 เงินเดือนล้วน (40(1)) ไม่ต้องคำนวณภาษีขั้นต่ำ 0.5%', () => {
  const r = calculateThaiPIT({ income: { salary: 5000000 } });
  assert.strictEqual(r.หมายเหตุมาตรา48_2, undefined, 'เงินได้ 40(1) ไม่อยู่ในบังคับมาตรา 48(2)');
});

test('TC-25 เงินได้ 40(8) สูงแต่ค่าลดหย่อนมาก → ภาษีขั้นต่ำ 0.5% มีผลบังคับ', () => {
  // ทดสอบแค่ว่ามีการตรวจมาตรา 48(2)
  const r = calculateThaiPIT({ income: { business: 10000000 } });
  assert.ok(typeof r.หมายเหตุมาตรา48_2 === 'string', 'ต้องมีการตรวจสอบมาตรา 48(2)');
});

test('TC-26 เงินได้ 40(2) 130,000 บาท → ภาษีขั้นต่ำ 650 บาท ไม่เกิน 5,000 จึงไม่ใช้วิธีนี้', () => {
  const r = calculateThaiPIT({ income: { hire: 130000 } });
  assert.ok(String(r.หมายเหตุมาตรา48_2).includes('ไม่ต้องใช้วิธีนี้'));
  assert.strictEqual(r.สรุป.ภาษีที่ต้องชำระ, 0);
});

test('TC-26ก หมายเหตุมาตรา 48(2) ต้องปิดท้ายด้วยยอดที่ต้องชำระจริงเสมอ', () => {
  // แบบจำลองอ่านหมายเหตุนี้ตรง ๆ ถ้าไม่บอกยอดจริง อาจเข้าใจว่า "ยกเว้น" = ภาษี 0 บาท
  const กรณีทดสอบ = [
    { ชื่อ: 'ค่าเช่า 400,000 (ต่ำกว่าเกณฑ์ยกเว้นวิธี)', ข้อมูล: { income: { rent: 400000 } } },
    { ชื่อ: 'รับจ้าง 130,000', ข้อมูล: { income: { hire: 130000 } } },
    { ชื่อ: 'ธุรกิจ 10,000,000', ข้อมูล: { income: { business: 10000000 } } },
    { ชื่อ: 'ธุรกิจ 3,000,000', ข้อมูล: { income: { business: 3000000 } } },
  ];

  for (const { ชื่อ, ข้อมูล } of กรณีทดสอบ) {
    const r = calculateThaiPIT(ข้อมูล);
    const หมายเหตุ = r.หมายเหตุมาตรา48_2;
    if (!หมายเหตุ) continue;

    assert.ok(
      หมายเหตุ.includes('ยอดที่ต้องชำระคือ'),
      `${ชื่อ}: หมายเหตุต้องระบุยอดที่ต้องชำระจริง ไม่ปล่อยให้ตีความเอง\n  ได้: ${หมายเหตุ}`
    );

    const ยอดจริง = r.สรุป.ภาษีที่ต้องชำระ.toLocaleString('en-US');
    assert.ok(
      หมายเหตุ.includes(ยอดจริง),
      `${ชื่อ}: ยอดในหมายเหตุต้องตรงกับ สรุป.ภาษีที่ต้องชำระ (${ยอดจริง})\n  ได้: ${หมายเหตุ}`
    );
  }
});

test('TC-26ข คำว่า "ได้รับยกเว้น" ต้องไม่ปรากฏลอยๆ ในหมายเหตุมาตรา 48(2)', () => {
  // "ยกเว้น" ข้างจำนวนเงินชวนเข้าใจว่าไม่ต้องเสียภาษี ถ้าใช้ต้องบอกว่ายกเว้นเฉพาะวิธีคำนวณ
  const r = calculateThaiPIT({ income: { rent: 400000 }, options: { rentType: 'building' } });
  const หมายเหตุ = r.หมายเหตุมาตรา48_2;
  assert.ok(หมายเหตุ.includes('3,500'), 'ต้องบอกยอดจริง 3,500 บาท');
  if (หมายเหตุ.includes('ยกเว้น')) {
    assert.ok(
      หมายเหตุ.includes('ยกเว้นเฉพาะวิธีคำนวณ'),
      `ถ้าใช้คำว่ายกเว้น ต้องขยายความให้ชัด\n  ได้: ${หมายเหตุ}`
    );
  }
});

// ---- กลุ่มที่ 7: ภาษีหัก ณ ที่จ่าย และการขอคืน ----

test('TC-27 ถูกหัก ณ ที่จ่ายมากกว่าภาษีที่ต้องเสีย → ขอคืนภาษีได้', () => {
  const r = calculateThaiPIT({
    income: { salary: 600000 },
    allowances: { socialSecurity: 9000 },
    withholdingTax: 30000,
  });
  assert.strictEqual(r.สรุป.ขอคืนภาษีได้, 9400, '30,000 - 20,600');
  assert.strictEqual(r.สรุป.ต้องชำระเพิ่ม, undefined);
});

test('TC-28 ถูกหัก ณ ที่จ่ายน้อยกว่าภาษีที่ต้องเสีย → ต้องชำระเพิ่ม', () => {
  const r = calculateThaiPIT({
    income: { salary: 600000 },
    allowances: { socialSecurity: 9000 },
    withholdingTax: 10000,
  });
  assert.strictEqual(r.สรุป.ต้องชำระเพิ่ม, 10600);
});

// ---- กลุ่มที่ 8: ข้อมูลนำเข้าไม่สมบูรณ์ต้องไม่ทำให้ระบบล่ม ----

test('TC-29 ไม่ส่งข้อมูลเงินได้ → ต้องคืนข้อความแจ้งข้อผิดพลาด ไม่ throw', () => {
  const r = calculateThaiPIT({});
  assert.strictEqual(r.สำเร็จ, false);
  assert.ok(typeof r.ข้อผิดพลาด === 'string');
});

test('TC-30 ส่งค่าติดลบหรือค่าที่ไม่ใช่ตัวเลข → ต้องไม่ทำให้ระบบล่ม', () => {
  const r = calculateThaiPIT({
    income: { salary: 600000, hire: -50000, business: 'abc' },
    allowances: { socialSecurity: null, rmf: undefined, children: -3 },
  });
  assert.strictEqual(r.สำเร็จ, true);
  assert.strictEqual(r.สรุป.เงินได้พึงประเมินรวม, 600000, 'ค่าติดลบและค่าที่ไม่ใช่ตัวเลขต้องถูกปัดเป็น 0');
});

test('TC-31 เงินได้ต่ำกว่าเกณฑ์ → ภาษี 0 บาท และไม่ติดลบ', () => {
  const r = calculateThaiPIT({ income: { salary: 200000 } });
  assert.strictEqual(r.สรุป.ภาษีที่ต้องชำระ, 0);
  assert.ok(r.สรุป.เงินได้สุทธิ >= 0);
});

test('TC-32 ผลลัพธ์ต้องมีคำเตือนให้ตรวจสอบกับกรมสรรพากรเสมอ', () => {
  const r = calculateThaiPIT({ income: { salary: 600000 } });
  assert.ok(String(r.คำเตือน).includes('กรมสรรพากร'));
});

// ---- กลุ่มที่ 9: เงินเพิ่มและค่าปรับยื่นล่าช้า (มาตรา 27 และ 35) ----

test('TC-33 ยื่นช้า 3 เดือน ภาษีค้าง 10,000 บาท → เงินเพิ่ม 450 ค่าปรับ 2,000 รวม 2,450 บาท', () => {
  const r = calculateLatePenalty({ taxDue: 10000, monthsLate: 3 });
  assert.strictEqual(r.สำเร็จ, true);
  assert.strictEqual(r.สรุป.เงินเพิ่ม, 450);
  assert.strictEqual(r.สรุป.ค่าปรับ, 2000);
  assert.strictEqual(r.สรุป.รวมที่ต้องชำระเพิ่ม, 2450);
});

test('TC-34 เงินเพิ่มต้องไม่เกินจำนวนภาษีที่ต้องเสีย (เพดานตามมาตรา 27)', () => {
  // 1.5% x 100 เดือน = 150% ของภาษี ต้องถูกจำกัดเหลือ 100%
  const r = calculateLatePenalty({ taxDue: 10000, monthsLate: 100 });
  assert.strictEqual(r.สรุป.เงินเพิ่ม, 10000, 'เงินเพิ่มต้องไม่เกินภาษีที่ต้องเสีย');
  assert.ok(typeof r.หมายเหตุ === 'string', 'ต้องมีหมายเหตุแจ้งว่าถูกจำกัดตามเพดาน');
});

test('TC-35 ยื่นเกินกำหนดไม่เกิน 7 วัน → ค่าปรับ 1,000 บาท', () => {
  const r = calculateLatePenalty({ taxDue: 5000, daysLate: 5 });
  assert.strictEqual(r.สรุป.ค่าปรับ, 1000);
  assert.strictEqual(r.สรุป.เงินเพิ่ม, 75, '5 วันนับเป็น 1 เดือน: 5,000 x 1.5% = 75');
});

test('TC-36 ยื่นเกินกำหนดเกิน 7 วัน → ค่าปรับ 2,000 บาท', () => {
  const r = calculateLatePenalty({ taxDue: 5000, daysLate: 20 });
  assert.strictEqual(r.สรุป.ค่าปรับ, 2000);
});

test('TC-37 เศษของเดือนต้องนับเป็นหนึ่งเดือนเต็ม', () => {
  const r = calculateLatePenalty({ taxDue: 10000, monthsLate: 2.1 });
  assert.strictEqual(r.สรุป.เงินเพิ่ม, 450, '2.1 เดือนต้องปัดขึ้นเป็น 3 เดือน');
});

test('TC-38 ไม่มีภาษีค้างชำระ → เงินเพิ่ม 0 แต่ยังต้องเสียค่าปรับจากการไม่ยื่นแบบ', () => {
  const r = calculateLatePenalty({ taxDue: 0, monthsLate: 2 });
  assert.strictEqual(r.สรุป.เงินเพิ่ม, 0);
  assert.strictEqual(r.สรุป.ค่าปรับ, 2000);
});

test('TC-39 ไม่ระบุระยะเวลาที่ล่าช้า → ต้องคืนข้อความแจ้งข้อผิดพลาด ไม่ throw', () => {
  const r = calculateLatePenalty({ taxDue: 10000 });
  assert.strictEqual(r.สำเร็จ, false);
  assert.ok(typeof r.ข้อผิดพลาด === 'string');
});

test('TC-40 ผลการคำนวณค่าปรับต้องอ้างอิงมาตรากฎหมายและมีคำเตือน', () => {
  const r = calculateLatePenalty({ taxDue: 10000, monthsLate: 1 });
  assert.ok(String(r.ฐานอ้างอิง).includes('มาตรา 27'));
  assert.ok(String(r.คำเตือน).includes('1161'));
});

// ---- ประโยคสำเร็จรูปสำหรับตอบเรื่องยื่นล่าช้า ----
// คำถามตีความได้ทั้ง "เสียเพิ่มเท่าไหร่" และ "เสียทั้งสิ้นเท่าไหร่" ประโยคจึงต้องมีครบทั้งสองยอด

test('TC-41 ประโยคสำหรับตอบผู้ใช้ต้องมีครบทั้งยอดที่เสียเพิ่มและยอดรวมพร้อมภาษี', () => {
  const r = calculateLatePenalty({ taxDue: 8000, monthsLate: 80 });
  const s = String(r.คำตอบที่ควรใช้ตอบผู้ใช้);

  assert.strictEqual(r.สรุป.รวมที่ต้องชำระเพิ่ม, 10000, 'เงินเพิ่ม 8,000 (ชนเพดาน) + ค่าปรับ 2,000');
  assert.strictEqual(r.สรุป.รวมทั้งสิ้นพร้อมภาษี, 18000);

  assert.ok(s.includes('10,000'), 'ต้องมียอดที่ต้องเสียเพิ่ม');
  assert.ok(s.includes('18,000'), 'ต้องมียอดรวมพร้อมภาษี');
  assert.ok(s.includes('8,000'), 'ต้องมีทั้งเงินเพิ่มและภาษีค้าง');
  assert.ok(s.includes('2,000'), 'ต้องมีค่าปรับ');
});

test('TC-42 ประโยคสำหรับตอบผู้ใช้ต้องแยกคำว่าเงินเพิ่มกับค่าปรับให้ผู้ใช้เข้าใจ', () => {
  const r = calculateLatePenalty({ taxDue: 10000, monthsLate: 3 });
  const s = String(r.คำตอบที่ควรใช้ตอบผู้ใช้);

  assert.ok(s.includes('เงินเพิ่ม'));
  assert.ok(s.includes('ค่าปรับ'));
  assert.ok(s.includes('ทั้งสิ้น'), 'ต้องบอกยอดรวมสุดท้ายให้ชัด');
  assert.ok(s.includes('450'), 'เงินเพิ่ม 10,000 x 1.5% x 3 = 450');
});

test('TC-43 กรณีไม่มีภาษีค้าง ประโยคสำหรับตอบผู้ใช้ต้องยังใช้งานได้ ไม่ใช่ค่าว่าง', () => {
  const r = calculateLatePenalty({ taxDue: 0, monthsLate: 2 });
  const s = String(r.คำตอบที่ควรใช้ตอบผู้ใช้);

  assert.ok(s.length > 20);
  assert.ok(s.includes('2,000'), 'ยังต้องเสียค่าปรับจากการไม่ยื่นแบบ');
});

// ---- เพดานประกันสังคมที่เปลี่ยนตามปีภาษี ----
// เพดานมาจากกฎหมายประกันสังคมและปรับขั้นบันไดตั้งแต่ปี 2569 กันไม่ให้ค้างที่ค่าเดิม

test('TC-44 เพดานประกันสังคมต้องเลือกตามปีภาษีให้ถูกช่วง', () => {
  const ที่คาดหวัง = [
    [2566, 9000],
    [2567, 9000],
    [2568, 9000],
    [2569, 10500],
    [2571, 10500],
    [2572, 12000],
    [2574, 12000],
    [2575, 13800],
    [2580, 13800],
  ];
  for (const [ปี, เพดาน] of ที่คาดหวัง) {
    assert.strictEqual(
      socialSecurityRule(ปี).เพดานต่อปี,
      เพดาน,
      `ปีภาษี ${ปี} ควรได้เพดาน ${เพดาน} บาท`
    );
  }
});

test('TC-45 เพดานต่อปีต้องเท่ากับเงินสมทบต่อเดือนคูณสิบสองเสมอ', () => {
  // จับการแก้ตัวเลขในตารางไม่ครบทุกช่อง
  for (const r of SOCIAL_SECURITY_CAP_BY_YEAR) {
    assert.strictEqual(
      r.เพดานต่อปี,
      r.สมทบต่อเดือน * 12,
      `ช่วงปี ${r['ตั้งแต่ปีภาษี']} ตัวเลขไม่สอดคล้องกัน`
    );
  }
});

test('TC-46 เงินสมทบต่อเดือนต้องเท่ากับร้อยละ 5 ของฐานค่าจ้างขั้นสูง', () => {
  // อัตราร้อยละ 5 ตามกฎหมายประกันสังคม ถ้าไม่ตรงแปลว่ากรอกตารางผิด
  for (const r of SOCIAL_SECURITY_CAP_BY_YEAR) {
    assert.strictEqual(
      r.สมทบต่อเดือน,
      r.ฐานค่าจ้างต่อเดือน * 0.05,
      `ช่วงปี ${r['ตั้งแต่ปีภาษี']} ฐานค่าจ้างกับเงินสมทบไม่สอดคล้องกัน`
    );
  }
});

test('TC-47 เครื่องคำนวณต้องตัดเงินสมทบส่วนที่เกินเพดานของปีภาษีที่ใช้อยู่', () => {
  const เพดาน = socialSecurityRule(TAX_YEAR).เพดานต่อปี;
  const r = calculateThaiPIT({
    income: { salary: 600000 },
    allowances: { socialSecurity: 10000 },
  });

  const รายการ = r.รายละเอียดค่าลดหย่อน.find((d) => d.รายการ.includes('ประกันสังคม'));
  assert.ok(รายการ, 'ไม่พบรายการค่าลดหย่อนประกันสังคมในผลลัพธ์');
  assert.strictEqual(
    รายการ.จำนวน,
    เพดาน,
    `จ่ายจริง 10,000 บาท ต้องใช้สิทธิได้เท่าเพดาน ${เพดาน} บาทเท่านั้น`
  );
});

test('TC-48 หมายเหตุของรายการประกันสังคมต้องบอกปีภาษีกำกับไว้ด้วย', () => {
  // เพดานที่ไม่มีปีภาษีกำกับทำให้ตอบผิดเมื่อข้ามปี
  const r = calculateThaiPIT({
    income: { salary: 600000 },
    allowances: { socialSecurity: 9000 },
  });
  const รายการ = r.รายละเอียดค่าลดหย่อน.find((d) => d.รายการ.includes('ประกันสังคม'));
  assert.ok(
    String(รายการ.หมายเหตุ).includes(String(TAX_YEAR)),
    `หมายเหตุต้องระบุปีภาษี แต่ได้ "${รายการ.หมายเหตุ}"`
  );
});

// ---- ด่านตรวจที่มาของค่าลดหย่อน ----
// ต้องตัดค่าลดหย่อนที่แบบจำลองเติมเองโดยผู้ใช้ไม่ได้เอ่ยถึง (เช่น ประกันสังคม 9,000)
// และต้องไม่ตัดรายการที่ผู้ใช้บอกมาจริง ซึ่งเสียหายหนักกว่า

test('TC-51 ตัดค่าลดหย่อนที่ผู้ใช้ไม่ได้เอ่ยถึงออก (ข้อมูลจริงจากข้อ RMF กับประกันบำนาญ)', () => {
  const คำถาม =
    'เงินเดือนปีละ 1,500,000 บาท ซื้อ RMF 300,000 บาท และประกันบำนาญอีก 300,000 บาท โสด ภาษีเท่าไหร่';
  const ที่แบบจำลองส่งมา = {
    income: { salary: 1500000 },
    allowances: { rmf: 300000, socialSecurity: 9000, pensionInsurance: 300000 },
  };
  const ผล = ตรวจที่มาของค่าลดหย่อน(ที่แบบจำลองส่งมา, คำถาม);

  // เทียบเฉพาะช่องกับค่า ช่องอื่นในผลเป็นแค่ข้อมูลช่วยวินิจฉัย
  assert.deepStrictEqual(
    ผล['ตัดออก'].map((x) => ({ ช่อง: x['ช่อง'], ค่า: x['ค่า'] })),
    [{ ช่อง: 'socialSecurity', ค่า: 9000 }],
    'ต้องตัดประกันสังคมที่ผู้ใช้ไม่ได้พูดถึงออก'
  );
  assert.strictEqual(ผล['ข้อมูล'].allowances.rmf, 300000, 'RMF ที่ผู้ใช้บอกมาต้องอยู่ครบ');
  assert.strictEqual(
    ผล['ข้อมูล'].allowances.pensionInsurance,
    300000,
    'ประกันบำนาญที่ผู้ใช้บอกมาต้องอยู่ครบ'
  );
});

test('TC-52 ผลลัพธ์หลังผ่านด่าน ต้องได้ตัวเลขตรงกับที่คำนวณโดยไม่มีค่าที่ถูกเติมเอง', () => {
  const คำถาม =
    'เงินเดือนปีละ 1,500,000 บาท ซื้อ RMF 300,000 บาท และประกันบำนาญอีก 300,000 บาท โสด ภาษีเท่าไหร่';
  const มีของแถม = {
    income: { salary: 1500000 },
    allowances: { rmf: 300000, socialSecurity: 9000, pensionInsurance: 300000 },
  };
  const สะอาด = {
    income: { salary: 1500000 },
    allowances: { rmf: 300000, pensionInsurance: 300000 },
  };
  const หลังด่าน = calculateThaiPIT(ตรวจที่มาของค่าลดหย่อน(มีของแถม, คำถาม)['ข้อมูล']);
  const ที่ถูกต้อง = calculateThaiPIT(สะอาด);
  assert.strictEqual(
    หลังด่าน['สรุป']['ภาษีที่ต้องชำระ'],
    ที่ถูกต้อง['สรุป']['ภาษีที่ต้องชำระ'],
    'ผ่านด่านแล้วต้องได้ตัวเลขเดียวกับการส่งข้อมูลที่สะอาดตั้งแต่ต้น'
  );
  assert.notStrictEqual(
    calculateThaiPIT(มีของแถม)['สรุป']['ภาษีที่ต้องชำระ'],
    ที่ถูกต้อง['สรุป']['ภาษีที่ต้องชำระ'],
    'ถ้าไม่มีด่านแล้วตัวเลขเท่ากัน แปลว่าข้อทดสอบนี้ไม่ได้ทดสอบอะไรเลย'
  );
});

test('TC-53 ห้ามตัดรายการที่ผู้ใช้บอกมาจริง', () => {
  const กรณี = [
    ['เงินเดือน 30,000 บาทต่อเดือน จ่ายประกันสังคมทั้งปี 9,000 บาท โสด', { socialSecurity: 9000 }],
    ['เงินเดือนปีละ 900,000 บาท จ่ายเบี้ยประกันชีวิต 150,000 บาท', { lifeInsurance: 150000 }],
    ['เงินเดือนปีละ 800,000 บาท เลี้ยงดูบิดามารดาอายุเกิน 60 ปี', { parents: 2 }],
    ['เงินเดือน 50,000 ต่อเดือน มีลูก 2 คน', { children: 2 }],
    ['มีคู่สมรสไม่มีรายได้ เงินเดือนปีละ 600,000', { spouse: true }],
    ['ซื้อ SSF 200,000 บาท เงินเดือนปีละ 1,000,000', { ssf: 200000 }],
    ['ผ่อนบ้าน ดอกเบี้ย 80,000 บาท เงินเดือนปีละ 700,000', { homeLoanInterest: 80000 }],
    ['บริจาคให้โรงพยาบาลรัฐ 50,000 บาท', { donationEducation: 50000 }],
    ['จ่ายกองทุนสำรองเลี้ยงชีพ 50,000 บาท', { pvd: 50000 }],
    ['อุปการะคนพิการ 1 คน', { disabledCare: 1 }],
  ];
  const ตัดผิด = [];
  for (const [คำถาม, allowances] of กรณี) {
    const ผล = ตรวจที่มาของค่าลดหย่อน({ income: { salary: 1 }, allowances }, คำถาม);
    if (ผล['ตัดออก'].length > 0) {
      ตัดผิด.push(`${คำถาม} -> ตัด ${ผล['ตัดออก'].map((x) => x['ช่อง']).join(', ')}`);
    }
  }
  assert.deepStrictEqual(
    ตัดผิด,
    [],
    'ด่านตัดรายการที่ผู้ใช้บอกมาจริงทิ้ง ซึ่งทำให้ภาษีสูงเกินความจริง\n  ' + ตัดผิด.join('\n  ')
  );
});

test('TC-54 ทุกช่องค่าลดหย่อนในสคีมาต้องมีรายการคำกำกับ', () => {
  // ช่องใหม่ที่ลืมเติมรายการคำ จะหลุดผ่านด่านเงียบ ๆ
  const fs = require('node:fs');
  const path = require('node:path');
  const wf = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', 'n8n', 'workflows', 'tax-advisor-workflow.json'),
      'utf8'
    )
  );
  const โหนด = wf.nodes.find((n) => n.name === 'Tax Calculator Tool');
  assert.ok(โหนด, 'ไม่พบโหนด Tax Calculator Tool');
  const สคีมา = JSON.parse(โหนด.parameters.inputSchema);
  const ช่องทั้งหมด = Object.keys(สคีมา.properties.allowances.properties);
  const ขาด = ช่องทั้งหมด.filter((k) => !คำบ่งชี้ค่าลดหย่อน[k]);
  assert.deepStrictEqual(
    ขาด,
    [],
    'ช่องค่าลดหย่อนต่อไปนี้ไม่มีรายการคำใน คำบ่งชี้ค่าลดหย่อน จึงไม่ถูกตรวจเลย\n  ' + ขาด.join(', ')
  );
});

test('TC-55 ไม่มีข้อความผู้ใช้ให้เทียบ ต้องปล่อยผ่านทั้งหมด', () => {
  // ตรวจไม่ได้ต้องไม่ตัด ไม่งั้นคำตอบผิดโดยไม่รู้สาเหตุ
  const p = { income: { salary: 500000 }, allowances: { socialSecurity: 9000 } };
  for (const ข้อความ of ['', null, undefined, 123]) {
    const ผล = ตรวจที่มาของค่าลดหย่อน(p, ข้อความ);
    assert.deepStrictEqual(ผล['ตัดออก'], [], `ต้องไม่ตัดอะไรเมื่อข้อความเป็น ${String(ข้อความ)}`);
    assert.strictEqual(ผล['ข้อมูล'], p, 'ต้องคืนข้อมูลเดิมโดยไม่แตะต้อง');
  }
});

test('TC-56 ค่าที่เป็นศูนย์หรือเท็จ ต้องปล่อยผ่านไม่นับเป็นการตัด', () => {
  const ผล = ตรวจที่มาของค่าลดหย่อน(
    { income: { salary: 500000 }, allowances: { socialSecurity: 0, spouse: false } },
    'เงินเดือนปีละ 500,000 บาท'
  );
  assert.deepStrictEqual(ผล['ตัดออก'], [], 'ค่าศูนย์กับเท็จไม่มีผลต่อการคำนวณ ไม่ต้องตัด');
});

test('TC-57 ไม่มีช่อง allowances เลย ต้องไม่พังและไม่ตัดอะไร', () => {
  const p = { income: { salary: 500000 } };
  const ผล = ตรวจที่มาของค่าลดหย่อน(p, 'เงินเดือนปีละ 500,000 บาท');
  assert.deepStrictEqual(ผล['ตัดออก'], []);
  assert.strictEqual(ผล['ข้อมูล'], p);
});

test('TC-58 ด่านต้องไม่แตะช่องเงินได้ เพราะค่าที่คำนวณมาจะไม่ปรากฏในข้อความ', () => {
  // เงินได้มักถูกคำนวณต่อ (30,000/เดือน → 360,000) ถ้าตรวจฝั่งนี้จะตัดค่าที่ถูกทิ้ง
  const p = { income: { salary: 360000, business: 200000 }, allowances: {} };
  const ผล = ตรวจที่มาของค่าลดหย่อน(p, 'เงินเดือน 30,000 บาทต่อเดือน');
  assert.deepStrictEqual(ผล['ตัดออก'], []);
  assert.deepStrictEqual(ผล['ข้อมูล'].income, p.income, 'ช่องเงินได้ต้องไม่ถูกแตะต้อง');
});

test('TC-59 โหนดเครื่องคำนวณในเวิร์กโฟลว์ต้องเรียกด่านจริง และข้ามเมื่อเป็นคำถามต่อเนื่อง', () => {
  // ตรวจโค้ดที่รันจริงในโหนด เพราะเทสต์ข้างบนทดสอบแค่ตัวฟังก์ชัน
  const fs = require('node:fs');
  const path = require('node:path');
  const wf = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', 'n8n', 'workflows', 'tax-advisor-workflow.json'),
      'utf8'
    )
  );
  const โค้ด = wf.nodes.find((n) => n.name === 'Tax Calculator Tool').parameters.jsCode;

  assert.ok(
    โค้ด.indexOf('ตรวจที่มาของค่าลดหย่อน(payload') >= 0,
    'โค้ดในโหนดไม่ได้เรียกด่านตรวจที่มาเลย ค่าลดหย่อนที่แบบจำลองเติมเองจะหลุดเข้าไป'
  );
  assert.ok(
    โค้ด.indexOf('เป็นคำถามต่อเนื่อง') >= 0,
    'โค้ดในโหนดไม่ได้ข้ามด่านเมื่อเป็นคำถามต่อเนื่อง คำถามต่อเนื่องจะถูกตัดค่าเดิมทิ้ง'
  );
  assert.ok(
    โค้ด.indexOf("$('Extract LINE Data')") >= 0,
    'โค้ดในโหนดไม่ได้อ่านข้อความผู้ใช้ ด่านจะไม่มีอะไรให้เทียบแล้วปล่อยผ่านทุกครั้ง'
  );

  // ตัวดักคำถามต่อเนื่องต้องเป็นชุดเดียวกับ n8n/intent-rules.json
  const กฎ = JSON.parse(
    fs.readFileSync(path.join(__dirname, '..', 'n8n', 'intent-rules.json'), 'utf8')
  );
  for (const คำ of กฎ.followupMarkers) {
    assert.ok(
      โค้ด.indexOf(JSON.stringify(คำ).slice(1, -1)) >= 0,
      `ตัวดักคำถามต่อเนื่อง "${คำ}" ไม่ได้ถูกฝังในโหนดเครื่องคำนวณ`
    );
  }
});

test('TC-60 เครื่องคำนวณค่าปรับต้องไม่มีด่านนี้ เพราะไม่มีช่องค่าลดหย่อนให้เติม', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wf = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', 'n8n', 'workflows', 'tax-advisor-workflow.json'),
      'utf8'
    )
  );
  const โค้ด = wf.nodes.find((n) => n.name === 'Late Penalty Tool').parameters.jsCode;
  assert.ok(
    โค้ด.indexOf('ตรวจที่มาของค่าลดหย่อน(payload') < 0,
    'เครื่องคำนวณค่าปรับรับแค่ยอดภาษีค้างกับระยะเวลา ไม่ควรมีด่านนี้มาเพิ่มความซับซ้อน'
  );
});

// ---- ด่านความสอดคล้องของประเภทเงินได้ และการแนะนำช่องที่ถูก ----
// เช่น ระบุ professionType medical แต่ใส่เงินช่อง business แทน profession
// ต้องจับได้ แต่ห้ามเตือนค่าปริยายที่ไม่มีผลต่อการคำนวณ

test('TC-61 ต้องเตือนเมื่อระบุ medical แต่ไม่ได้ใส่เงินได้ในช่อง profession', () => {
  const ที่แบบจำลองส่งจริง = {
    income: { salary: 360000, business: 500000 },
    options: { professionType: 'medical' },
  };
  const คำเตือน = ตรวจความสอดคล้องของประเภทเงินได้(ที่แบบจำลองส่งจริง);
  assert.strictEqual(คำเตือน.length, 1, 'ต้องเตือนหนึ่งข้อ');
  assert.ok(คำเตือน[0].indexOf('profession') >= 0, 'คำเตือนต้องบอกชื่อช่องที่ควรใช้');
  assert.ok(คำเตือน[0].indexOf('business') >= 0, 'คำเตือนต้องบอกด้วยว่าตอนนี้เงินอยู่ช่องไหน');
});

test('TC-62 ต้องไม่เตือนเมื่อจัดประเภทถูกต้องแล้ว', () => {
  const ถูกต้อง = {
    income: { salary: 360000, profession: 500000 },
    options: { professionType: 'medical' },
  };
  assert.deepStrictEqual(ตรวจความสอดคล้องของประเภทเงินได้(ถูกต้อง), []);
});

test('TC-63 ค่าปริยาย other ที่ไม่มีผลต่อการคำนวณ ต้องไม่ถูกเตือน', () => {
  // แบบจำลองบางตัวใส่ professionType/rentType other มาแทบทุกครั้ง ถ้าเตือนด้วยจะกลบคำเตือนจริง
  const กรณีที่ต้องเงียบ = [
    { income: { salary: 480000 }, options: { professionType: 'other', rentType: 'other' } },
    { income: { hire: 800000 }, options: { professionType: 'other', rentType: 'other' } },
    { income: { business: 1000000 }, options: { professionType: 'other' } },
    { income: { salary: 480000 } },
    { income: {}, options: { professionType: 'medical' } },
  ];
  const ที่เตือนผิด = กรณีที่ต้องเงียบ.filter(
    (p) => ตรวจความสอดคล้องของประเภทเงินได้(p).length > 0
  );
  assert.deepStrictEqual(
    ที่เตือนผิด.map((p) => JSON.stringify(p)),
    [],
    'กรณีเหล่านี้ไม่เป็นอันตราย ต้องไม่เตือน'
  );
});

test('TC-64 ข้อ Q119 เป็นข้อที่แยกแยะไม่ได้จริง ต้องมีข้อที่แยกแยะได้ในชุดคำถาม', () => {
  // อัตราสองช่องเท่ากันจริง จึงเป็นเหตุที่ Q119 ผ่านโดยบังเอิญ
  const เป็นวิชาชีพแพทย์ = calculateThaiPIT({
    income: { salary: 360000, profession: 500000 },
    options: { professionType: 'medical' },
  })['สรุป']['ภาษีที่ต้องชำระ'];
  const จัดผิดเป็นธุรกิจ = calculateThaiPIT({
    income: { salary: 360000, business: 500000 },
  })['สรุป']['ภาษีที่ต้องชำระ'];
  assert.strictEqual(
    เป็นวิชาชีพแพทย์,
    จัดผิดเป็นธุรกิจ,
    'ถ้าสองค่านี้ไม่เท่ากันแล้ว แปลว่าอัตราเปลี่ยนไป ให้ทบทวนคำอธิบายของข้อ Q119 ใหม่'
  );

  // วิชาชีพอิสระอื่น (หัก 30%) ต้องให้ผลต่างจากธุรกิจ ชุดคำถามจึงต้องมีข้อแบบนี้
  const ทนายถูกต้อง = calculateThaiPIT({
    income: { profession: 900000 },
    options: { professionType: 'other' },
  })['สรุป']['ภาษีที่ต้องชำระ'];
  const ทนายจัดผิด = calculateThaiPIT({ income: { business: 900000 } })['สรุป']['ภาษีที่ต้องชำระ'];
  assert.notStrictEqual(
    ทนายถูกต้อง,
    ทนายจัดผิด,
    'วิชาชีพอิสระที่ไม่ใช่แพทย์ ต้องให้ผลต่างจากธุรกิจ ไม่งั้นข้อนั้นก็แยกแยะไม่ได้เหมือนกัน'
  );

  const ชุดคำถาม = require(
    require('node:path').join(__dirname, '..', 'evaluation', 'test-questions-official.json')
  );
  const มีข้อแยกแยะ = ชุดคำถาม.questions.some(
    (q) => /ทนายความ|วิศวกร/.test(q.question) && q.check === 'exactNumber'
  );
  assert.ok(
    มีข้อแยกแยะ,
    'ชุดคำถามต้องมีข้อวิชาชีพอิสระที่หักร้อยละ 30 เพื่อจับการจัดประเภทเงินได้ผิด'
  );
});

test('TC-65 เมื่อใส่ผิดช่อง ด่านต้องบอกช่องที่ถูกกลับไป ไม่ใช่ตัดทิ้งเฉย ๆ', () => {
  // ผู้ใช้บอกกองทุนสำรองเลี้ยงชีพ แต่แบบจำลองใส่ช่อง rmf ถ้าตัดทิ้งเฉย ๆ ค่าลดหย่อนจะหายทั้งก้อน
  const คำถาม = 'เงินเดือน 55,000 บาทต่อเดือน ประกันสังคม 9,000 บาท กองทุนสำรองเลี้ยงชีพ 66,000 บาท ภาษีเท่าไหร่';
  const ผล = ตรวจที่มาของค่าลดหย่อน(
    { income: { salary: 660000 }, allowances: { rmf: 66000, socialSecurity: 9000 } },
    คำถาม
  );
  assert.strictEqual(ผล['ตัดออก'].length, 1);
  assert.ok(
    ผล['ตัดออก'][0]['ช่องที่น่าจะถูก'].indexOf('pvd') === 0,
    'ต้องแนะนำช่อง pvd เป็นอันดับแรก เพราะคำว่ากองทุนสำรองเลี้ยงชีพเจาะจงที่สุด'
  );

  const ข้อความ = ผนวกผลด่าน({}, ผล['ตัดออก'])['เหตุผลที่ไม่ได้นำมาคิด'];
  assert.ok(ข้อความ.indexOf('ใส่ผิดช่อง') >= 0, 'ข้อความต้องบอกว่าน่าจะใส่ผิดช่อง');
  assert.ok(ข้อความ.indexOf('pvd') >= 0, 'ข้อความต้องบอกชื่อช่องที่ควรย้ายไป');
});

test('TC-66 คำกว้างที่มาจากช่องซึ่งจัดถูกอยู่แล้ว ต้องไม่ถูกนำไปแนะนำ', () => {
  // "ประกัน" ในรายการคำของประกันชีวิตไปตรงกับ "ประกันสังคม" ถ้าไม่กรอง
  // จะแนะนำให้ย้าย rmf ที่เติมเองไปเป็นประกันชีวิต ซึ่งเท่ากับชี้ทางให้แต่งตัวเลข
  const ผล = ตรวจที่มาของค่าลดหย่อน(
    { income: { salary: 600000 }, allowances: { rmf: 100000, socialSecurity: 9000 } },
    'เงินเดือน 50,000 บาทต่อเดือน จ่ายประกันสังคม 9,000 บาท ต้องเสียภาษีเท่าไหร่'
  );
  assert.deepStrictEqual(
    ผล['ตัดออก'][0]['ช่องที่น่าจะถูก'],
    [],
    'ไม่ควรแนะนำช่องใดเลย เพราะผู้ใช้ไม่ได้เอ่ยถึงเรื่องอื่นนอกจากประกันสังคมที่จัดถูกแล้ว'
  );
  const ข้อความ = ผนวกผลด่าน({}, ผล['ตัดออก'])['เหตุผลที่ไม่ได้นำมาคิด'];
  assert.ok(ข้อความ.indexOf('ห้ามนำตัวเลขเหล่านี้ไปใส่ในคำตอบ') >= 0);
});

// ---- ประเภทเงินได้ขัดแย้ง ต้องปฏิเสธ ไม่ใช่แค่เตือน ----
// ถ้ายังส่งตัวเลขกลับไป แบบจำลองจะหยิบไปตอบโดยไม่เรียกเครื่องมือใหม่ จึงต้องไม่มีตัวเลขเลย

test('TC-67 ผลปฏิเสธต้องไม่มีตัวเลขภาษีติดไปด้วยเลย', () => {
  const คำเตือน = ตรวจความสอดคล้องของประเภทเงินได้({
    income: { salary: 360000, business: 500000 },
    options: { professionType: 'medical' },
  });
  const ผล = ปฏิเสธเพราะประเภทเงินได้ขัดแย้ง(คำเตือน);

  assert.strictEqual(ผล['สำเร็จ'], false, 'ต้องบอกชัดว่าไม่สำเร็จ');
  assert.ok(ผล['สิ่งที่ต้องทำ'].indexOf('เรียกเครื่องมือนี้ใหม่') >= 0, 'ต้องบอกวิธีแก้ให้ชัด');

  // สำคัญที่สุด: ห้ามมีตัวเลขหลุดไปแม้ช่องเดียว
  const ทั้งก้อน = JSON.stringify(ผล);
  const ช่องต้องห้าม = [
    'ภาษีที่ต้องชำระ',
    'เงินได้สุทธิ',
    'หักค่าใช้จ่าย',
    'หักค่าลดหย่อน',
    'สรุป',
  ];
  const หลุด = ช่องต้องห้าม.filter((k) => ทั้งก้อน.indexOf(k) >= 0);
  assert.deepStrictEqual(หลุด, [], 'ผลปฏิเสธต้องไม่มีช่องผลการคำนวณติดไปด้วย\n  ' + หลุด.join(', '));
});

test('TC-68 โหนดเครื่องคำนวณต้องปฏิเสธจริง ไม่ใช่แค่แนบคำเตือน', () => {
  // ตรวจโค้ดในโหนดจริง เพราะการปฏิเสธอยู่ที่ผู้เรียก ไม่ใช่ที่ตัวตรวจ
  const fs = require('node:fs');
  const path = require('node:path');
  const wf = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', 'n8n', 'workflows', 'tax-advisor-workflow.json'),
      'utf8'
    )
  );
  const โค้ด = wf.nodes.find((n) => n.name === 'Tax Calculator Tool').parameters.jsCode;

  assert.ok(
    /คำเตือนประเภทเงินได้\.length > 0[\s\S]{0,200}return JSON\.stringify\(ปฏิเสธเพราะประเภทเงินได้ขัดแย้ง/.test(
      โค้ด
    ),
    'โค้ดในโหนดต้อง return ทันทีเมื่อพบความขัดแย้ง ไม่ใช่คำนวณต่อแล้วแนบคำเตือน'
  );
});

test('TC-69 กรณีที่จัดประเภทถูกต้อง ต้องคำนวณให้ตามปกติ', () => {
  // คู่กับ TC-67 กันไม่ให้การปฏิเสธลามไปโดนกรณีปกติ
  const ปกติ = [
    { income: { salary: 360000, profession: 500000 }, options: { professionType: 'medical' } },
    { income: { profession: 900000 }, options: { professionType: 'other' } },
    { income: { salary: 480000 }, options: { professionType: 'other', rentType: 'other' } },
    { income: { business: 1000000 } },
  ];
  const ถูกปฏิเสธผิด = ปกติ.filter(
    (p) => ตรวจความสอดคล้องของประเภทเงินได้(p).length > 0
  );
  assert.deepStrictEqual(
    ถูกปฏิเสธผิด.map((p) => JSON.stringify(p)),
    [],
    'กรณีเหล่านี้ไม่ขัดแย้ง ต้องคำนวณให้ตามปกติ'
  );
  // และต้องคำนวณได้จริง ไม่ใช่แค่ไม่ถูกปฏิเสธ
  for (const p of ปกติ) {
    const s = calculateThaiPIT(p)['สรุป'];
    assert.strictEqual(typeof s['ภาษีที่ต้องชำระ'], 'number');
  }
});

// ---- ด่านตรวจคีย์ที่วางผิดชั้น ----
// เช่น spouse/children อยู่ชั้นบนสุดแทน allowances เครื่องคำนวณจะเมินทิ้งเงียบ ๆ
// ข้อมูลนำเข้าในกลุ่มนี้คัดลอกจากผลวัดจริง (ข้อ Q05, Q39)

test('TC-70 Q05 ข้อมูลนำเข้าจริงที่ตกสามรอบ ต้องถูกด่านจับได้', () => {
  const ที่แบบจำลองส่งจริง = {
    income: { business: 2000000 },
    spouse: true,
    children: 2,
  };
  const พบ = ตรวจคีย์วางผิดชั้น(ที่แบบจำลองส่งจริง);
  const ช่อง = พบ.map((x) => x['ช่อง']).sort();
  assert.deepStrictEqual(ช่อง, ['children', 'spouse']);
  assert.ok(
    พบ.every((x) => x['ชั้นที่ถูก'] === 'allowances'),
    'ต้องบอกได้ว่าช่องเหล่านี้ต้องอยู่ใน allowances'
  );
});

test('TC-71 ความเสียหายที่ด่านนี้กันไว้ ต้องวัดเป็นตัวเงินได้จริง', () => {
  // ถ้าไม่มีด่าน ภาษีจะสูงเกินจริงโดยไม่มีอะไรผิดสังเกต
  const ผิดชั้น = calculateThaiPIT({
    income: { business: 2000000 },
    spouse: true,
    children: 2,
  });
  const ถูกชั้น = calculateThaiPIT({
    income: { business: 2000000 },
    allowances: { spouse: true, children: 2 },
  });
  assert.strictEqual(ผิดชั้น['สรุป']['ภาษีที่ต้องชำระ'], 63500);
  assert.strictEqual(ถูกชั้น['สรุป']['ภาษีที่ต้องชำระ'], 45500);
  assert.ok(
    ผิดชั้น['สรุป']['ภาษีที่ต้องชำระ'] > ถูกชั้น['สรุป']['ภาษีที่ต้องชำระ'],
    'ค่าลดหย่อนที่หายไปต้องทำให้ภาษีสูงเกินจริง ไม่ใช่ต่ำเกินจริง'
  );
});

test('TC-72 Q39 ข้อมูลนำเข้าจริง ที่ย้ายถูกบางช่องแต่ยังผิดบางช่อง', () => {
  // lifeInsurance อยู่ถูกชั้นแล้ว แต่ spouse กับ children ยังอยู่ชั้นบนสุด
  const พบ = ตรวจคีย์วางผิดชั้น({
    income: { salary: 960000 },
    allowances: { lifeInsurance: 50000, rmf: 100000, socialSecurity: 9000 },
    spouse: true,
    children: 1,
  });
  assert.deepStrictEqual(พบ.map((x) => x['ช่อง']).sort(), ['children', 'spouse']);
});

test('TC-73 ผลปฏิเสธต้องไม่มีตัวเลขผลการคำนวณติดไปด้วยเลย', () => {
  const พบ = ตรวจคีย์วางผิดชั้น({
    income: { business: 2000000 },
    spouse: true,
    children: 2,
  });
  const ผล = ปฏิเสธเพราะคีย์วางผิดชั้น(พบ);

  assert.strictEqual(ผล['สำเร็จ'], false);
  assert.ok(ผล['สิ่งที่ต้องทำ'].indexOf('เรียกเครื่องมือนี้ใหม่') >= 0);

  // เหตุผลเดียวกับ TC-67: ห้ามมีตัวเลขหลุดไป
  const ทั้งก้อน = JSON.stringify(ผล);
  const ช่องต้องห้าม = [
    'ภาษีที่ต้องชำระ',
    'เงินได้สุทธิ',
    'หักค่าใช้จ่าย',
    'หักค่าลดหย่อน',
    'สรุป',
  ];
  const หลุด = ช่องต้องห้าม.filter((k) => ทั้งก้อน.indexOf(k) >= 0);
  assert.deepStrictEqual(หลุด, [], 'ผลปฏิเสธต้องไม่มีช่องผลการคำนวณติดไปด้วย');
});

test('TC-74 ผลปฏิเสธต้องบอกรูปแบบที่ถูกต้อง เพื่อให้แก้ได้ในการเรียกครั้งเดียว', () => {
  const พบ = ตรวจคีย์วางผิดชั้น({
    income: { business: 2000000 },
    spouse: true,
    children: 2,
  });
  const ผล = ปฏิเสธเพราะคีย์วางผิดชั้น(พบ);
  assert.deepStrictEqual(ผล['ต้องย้ายไปเป็น'], {
    allowances: { spouse: true, children: 2 },
  });
});

test('TC-75 ข้อมูลนำเข้าที่ถูกต้องอยู่แล้ว ต้องไม่ถูกดัก', () => {
  const ปกติ = [
    { income: { salary: 600000 } },
    { income: { business: 2000000 }, allowances: { spouse: true, children: 2 } },
    { income: { salary: 960000 }, allowances: { rmf: 100000, socialSecurity: 9000 } },
    { income: { profession: 900000 }, options: { professionType: 'other' } },
    { income: { salary: 600000 }, withholdingTax: 5000 },
    { income: { rent: 400000 }, options: { rentType: 'building' } },
  ];
  const ถูกดักผิด = ปกติ.filter((p) => ตรวจคีย์วางผิดชั้น(p).length > 0);
  assert.deepStrictEqual(
    ถูกดักผิด.map((p) => JSON.stringify(p)),
    [],
    'กรณีเหล่านี้วางถูกชั้นแล้ว ต้องคำนวณให้ตามปกติ'
  );
});

test('TC-76 ค่าที่ย้ายแล้วผลไม่เปลี่ยน ต้องไม่ดัก เพราะปฏิเสธไปก็ไม่ได้อะไร', () => {
  // ค่าปริยายพวกนี้ถูกส่งมาบ่อย ถ้าดักด้วยจะกลบสัญญาณจริง
  const ไม่ควรดัก = [
    { income: { salary: 600000 }, children: 0 },
    { income: { salary: 600000 }, spouse: false },
    { income: { salary: 600000 }, professionType: 'other' },
    { income: { salary: 600000 }, rentType: '' },
    { income: { salary: 600000 }, rmf: 0 },
  ];
  const ดักผิด = ไม่ควรดัก.filter((p) => ตรวจคีย์วางผิดชั้น(p).length > 0);
  assert.deepStrictEqual(ดักผิด.map((p) => JSON.stringify(p)), []);
});

test('TC-77 คีย์ที่เครื่องคำนวณไม่รู้จักเลย ต้องปล่อยผ่าน', () => {
  // ดักเฉพาะคีย์ที่รู้จักแต่วางผิดที่ คีย์แปลกปลอมไม่มีผลต่อการคำนวณ
  const พบ = ตรวจคีย์วางผิดชั้น({
    income: { salary: 600000 },
    หมายเหตุ: 'ข้อความอะไรสักอย่าง',
    foo: 123,
  });
  assert.deepStrictEqual(พบ, []);
});

test('TC-78 คีย์ที่ไปอยู่ผิดกล่อง ไม่ใช่แค่ชั้นบนสุด ก็ต้องจับได้', () => {
  const พบ = ตรวจคีย์วางผิดชั้น({
    income: { salary: 600000, rmf: 100000 },
    allowances: { business: 500000 },
  });
  const ช่อง = พบ.map((x) => x['ช่อง'] + ':' + x['อยู่ที่'] + '→' + x['ชั้นที่ถูก']).sort();
  assert.deepStrictEqual(ช่อง, ['business:allowances→income', 'rmf:income→allowances']);
});

test('TC-79 โหนดเครื่องคำนวณต้องปฏิเสธจริง และต้องตรวจก่อนด่านอื่น', () => {
  // อ่านโค้ดที่รันจริงจากเวิร์กโฟลว์ เหมือน TC-68
  const fs = require('node:fs');
  const path = require('node:path');
  const wf = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', 'n8n', 'workflows', 'tax-advisor-workflow.json'),
      'utf8'
    )
  );
  const โค้ด = wf.nodes.find((n) => n.name === 'Tax Calculator Tool').parameters.jsCode;

  assert.ok(
    /คีย์ผิดชั้น\.length > 0[\s\S]{0,200}return JSON\.stringify\(ปฏิเสธเพราะคีย์วางผิดชั้น/.test(โค้ด),
    'โค้ดในโหนดต้อง return ทันทีเมื่อพบคีย์วางผิดชั้น'
  );

  // ต้องตรวจก่อนด่านอื่น ไม่งั้นด่านอื่นจะอ่านกล่องที่ว่างแล้วสรุปผิด
  const ตำแหน่งคีย์ผิดชั้น = โค้ด.indexOf('ตรวจคีย์วางผิดชั้น(payload)');
  const ตำแหน่งที่มา = โค้ด.indexOf('ตรวจที่มาของค่าลดหย่อน(payload');
  const ตำแหน่งประเภท = โค้ด.indexOf('ตรวจความสอดคล้องของประเภทเงินได้(payload)');
  assert.ok(ตำแหน่งคีย์ผิดชั้น > 0, 'ต้องมีการเรียกด่านนี้ในโหนด');
  assert.ok(
    ตำแหน่งคีย์ผิดชั้น < ตำแหน่งที่มา && ตำแหน่งคีย์ผิดชั้น < ตำแหน่งประเภท,
    'ด่านตรวจคีย์วางผิดชั้นต้องทำงานก่อนด่านอื่นทั้งหมด'
  );
});

test('TC-80 ตัววัดผลต้องจำลองด่านนี้ด้วย ไม่งั้นผลวัดจะไม่ใช่ระบบที่ผู้ใช้เจอ', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const src = fs.readFileSync(
    path.join(__dirname, '..', 'evaluation', 'run-accuracy-test.js'),
    'utf8'
  );
  assert.ok(
    src.indexOf('ตรวจคีย์วางผิดชั้น(ข้อมูลนำเข้า)') >= 0,
    'evaluation/run-accuracy-test.js ต้องเรียกด่านนี้ด้วย'
  );
  assert.ok(
    src.indexOf('ปฏิเสธเพราะคีย์วางผิดชั้น(คีย์ผิดชั้น)') >= 0,
    'และต้องปฏิเสธแบบเดียวกับโหนดจริง'
  );
});

test('TC-81 รายชื่อคีย์ในด่าน ต้องครบตามที่เครื่องคำนวณอ่านจริง', () => {
  // กันลืมเพิ่มค่าลดหย่อนใหม่ลงรายชื่อของด่าน ซึ่งจะทำให้คีย์นั้นหลุดผ่านเงียบ ๆ
  const ทดสอบ = {};
  for (const ช่อง of ชั้นที่ถูกของคีย์.allowances) ทดสอบ[ช่อง] = 1;
  const ผลมีค่าลดหย่อน = calculateThaiPIT({
    income: { salary: 600000 },
    allowances: ทดสอบ,
  });
  const ผลไม่มี = calculateThaiPIT({ income: { salary: 600000 } });
  assert.ok(
    ผลมีค่าลดหย่อน['สรุป']['หักค่าลดหย่อน'] > ผลไม่มี['สรุป']['หักค่าลดหย่อน'],
    'ทุกช่องในรายชื่อต้องเป็นช่องที่เครื่องคำนวณอ่านจริง'
  );
});

// ---- ด่านตรวจค่าผิดชนิด ----
// เช่น income.profession เป็นข้อความ 'medical' แทนจำนวนเงิน (ข้อ Q119)
// Number('medical') ได้ NaN เครื่องคำนวณอ่านเป็น 0 เงียบ ๆ รายได้ส่วนนั้นจึงหายไป

test('TC-82 Q119 ข้อมูลนำเข้าจริงที่ตกสามรอบ ต้องถูกด่านนี้จับได้', () => {
  // คัดลอกจากผลวัดจริง
  const ข้อมูลจริง = {
    income: { profession: 'medical', salary: 360000 },
    spouse: false,
    socialSecurity: 0,
    children: 0,
  };

  // ด่านคีย์วางผิดชั้นจับไม่ได้: profession อยู่ถูกกล่อง และค่าที่วางผิดชั้นเป็น 0/false ทั้งหมด
  assert.strictEqual(
    ตรวจคีย์วางผิดชั้น(ข้อมูลจริง).length,
    0,
    'ถ้าข้อนี้ล้มเหลว แปลว่าด่านเดิมจับได้อยู่แล้ว และด่านใหม่ไม่จำเป็น'
  );

  const พบ = ตรวจค่าผิดชนิด(ข้อมูลจริง);
  assert.strictEqual(พบ.length, 1, 'ต้องจับได้หนึ่งช่อง');
  assert.strictEqual(พบ[0]['ช่อง'], 'profession');
  assert.strictEqual(พบ[0]['ค่า'], 'medical');
  assert.strictEqual(พบ[0]['ชนิดที่ต้องการ'], 'ตัวเลข');
});

test('TC-83 ข้อความที่เป็นตัวเลขล้วน ต้องปล่อยผ่าน เพราะเครื่องคำนวณอ่านได้', () => {
  // เกณฑ์ของด่านต้องตรงกับที่ num() ทำจริง
  assert.strictEqual(ตรวจค่าผิดชนิด({ income: { salary: '360000' } }).length, 0);
  const ผล = calculateThaiPIT({ income: { salary: '360000' } });
  assert.strictEqual(
    ผล['สรุป']['เงินได้พึงประเมินรวม'],
    360000,
    'เครื่องคำนวณต้องอ่านข้อความตัวเลขได้จริง ด่านจึงต้องปล่อยผ่าน'
  );
});

test('TC-84 ตัวเลขที่มีลูกน้ำ ต้องไม่ปล่อยผ่าน เพราะเครื่องคำนวณอ่านไม่ได้', () => {
  // ห้ามตัดลูกน้ำก่อนตรวจ เพราะเครื่องคำนวณอ่านไม่ออก จะกลายเป็นผ่านเงียบ ๆ
  assert.strictEqual(ตรวจค่าผิดชนิด({ income: { business: '1,500,000' } }).length, 1);

  // กรณีอันตราย: มีช่องอื่นอ่านได้ ช่องนี้กลายเป็น 0 แต่ผลยังบอกว่าสำเร็จ
  const ปนกัน = { income: { salary: 360000, business: '1,500,000' } };
  assert.strictEqual(ตรวจค่าผิดชนิด(ปนกัน).length, 1, 'ต้องจับช่องที่อ่านไม่ได้');

  const ผล = calculateThaiPIT(ปนกัน);
  assert.strictEqual(ผล['สำเร็จ'], true, 'ยืนยันว่าเครื่องคำนวณไม่ได้ฟ้องอะไรเลย');
  assert.strictEqual(
    ผล['สรุป']['เงินได้พึงประเมินรวม'],
    360000,
    'ยืนยันว่ารายได้ 1,500,000 หายไปเงียบ ๆ จริง ด่านจึงต้องจับก่อนถึงขั้นนี้'
  );
});

test('TC-85 ค่าตรรกะในช่องจำนวนเงิน ต้องจับได้ แม้ Number(true) จะได้ 1', () => {
  const พบ = ตรวจค่าผิดชนิด({ income: { salary: true } });
  assert.strictEqual(พบ.length, 1, 'เงินเดือน 1 บาทคือความผิดพลาดเงียบ ไม่ใช่ค่าที่ใช้ได้');
});

test('TC-86 spouse ต้องเป็นใช่หรือไม่ใช่ ส่งเลขมาต้องจับได้', () => {
  // ส่งเลข 1 มาเครื่องคำนวณจะถือว่าไม่มีคู่สมรส ลดหย่อนหายเงียบ ๆ
  assert.strictEqual(ตรวจค่าผิดชนิด({ allowances: { spouse: 1 } }).length, 1);
  assert.strictEqual(ตรวจค่าผิดชนิด({ allowances: { spouse: true } }).length, 0);
  assert.strictEqual(ตรวจค่าผิดชนิด({ allowances: { spouse: 'true' } }).length, 0);
  assert.strictEqual(ตรวจค่าผิดชนิด({ allowances: { spouse: false } }).length, 0);
});

test('TC-87 ช่องที่ไม่ได้ส่งมา และช่องที่ไม่รู้จัก ต้องปล่อยผ่านทั้งคู่', () => {
  assert.strictEqual(ตรวจค่าผิดชนิด({ income: { salary: undefined } }).length, 0);
  assert.strictEqual(ตรวจค่าผิดชนิด({ income: { salary: null } }).length, 0);
  assert.strictEqual(ตรวจค่าผิดชนิด({ income: { ช่องที่ไม่มีจริง: 'อะไรก็ได้' } }).length, 0);
  assert.strictEqual(ตรวจค่าผิดชนิด({}).length, 0);
  assert.strictEqual(ตรวจค่าผิดชนิด(null).length, 0);
});

test('TC-88 คำปฏิเสธต้องไม่มีตัวเลขผลลัพธ์ และต้องบอกทางแก้ให้ตรงจุด', () => {
  const คำตอบ = ปฏิเสธเพราะค่าผิดชนิด(
    ตรวจค่าผิดชนิด({ income: { profession: 'medical', salary: 360000 } })
  );
  assert.strictEqual(คำตอบ['สำเร็จ'], false);
  assert.ok(!('สรุป' in คำตอบ), 'ห้ามส่งตัวเลขกลับไปเลยแม้ช่องเดียว');
  assert.ok(
    /options\.professionType/.test(คำตอบ['สิ่งที่ต้องทำ']),
    'กรณีเอาชื่อวิชาชีพไปใส่ช่องเงินได้ ต้องบอกว่าที่ถูกต้องอยู่ตรงไหน'
  );
  assert.ok(
    /ต่ำกว่าความจริง/.test(คำตอบ['สิ่งที่ต้องทำ']),
    'ต้องบอกทิศทางความเสียหายให้ตรง ด่านนี้ทำให้ภาษีต่ำเกินจริง ไม่ใช่สูงเกินจริง'
  );
});

test('TC-89 โหนดจริงและตัววัดผล ต้องเรียกด่านนี้ถัดจากด่านคีย์วางผิดชั้น', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const wf = JSON.parse(
    fs.readFileSync(
      path.join(__dirname, '..', 'n8n', 'workflows', 'tax-advisor-workflow.json'),
      'utf8'
    )
  );
  const โค้ด = wf.nodes.find((n) => n.name === 'Tax Calculator Tool').parameters.jsCode;

  assert.ok(
    /ค่าผิดชนิด\.length > 0[\s\S]{0,200}return JSON\.stringify\(ปฏิเสธเพราะค่าผิดชนิด/.test(โค้ด),
    'โค้ดในโหนดต้อง return ทันทีเมื่อพบค่าผิดชนิด'
  );

  const ตำแหน่งผิดชั้น = โค้ด.indexOf('ตรวจคีย์วางผิดชั้น(payload)');
  const ตำแหน่งผิดชนิด = โค้ด.indexOf('ตรวจค่าผิดชนิด(payload)');
  const ตำแหน่งประเภท = โค้ด.indexOf('ตรวจความสอดคล้องของประเภทเงินได้(payload)');
  assert.ok(ตำแหน่งผิดชนิด > 0, 'ต้องมีการเรียกด่านนี้ในโหนด');
  assert.ok(
    ตำแหน่งผิดชั้น < ตำแหน่งผิดชนิด && ตำแหน่งผิดชนิด < ตำแหน่งประเภท,
    'ลำดับต้องเป็น ผิดชั้น แล้วผิดชนิด แล้วจึงด่านที่เหลือ'
  );

  const src = fs.readFileSync(
    path.join(__dirname, '..', 'evaluation', 'run-accuracy-test.js'),
    'utf8'
  );
  assert.ok(
    src.indexOf('ตรวจค่าผิดชนิด(ข้อมูลนำเข้า)') >= 0 &&
      src.indexOf('ปฏิเสธเพราะค่าผิดชนิด(ค่าผิดชนิด)') >= 0,
    'ตัววัดผลต้องจำลองด่านนี้ด้วย ไม่งั้นเลขที่วัดได้จะไม่ใช่ระบบที่ผู้ใช้เจอ'
  );
});

test('TC-90 ทุกช่องที่เครื่องคำนวณอ่าน ต้องมีชนิดกำกับไว้ในด่าน', () => {
  // กันลืมกำกับชนิดให้ช่องใหม่ ซึ่งจะทำให้ด่านปล่อยผ่านเงียบ ๆ
  const ทุกช่อง = []
    .concat(ชั้นที่ถูกของคีย์.income)
    .concat(ชั้นที่ถูกของคีย์.allowances)
    .concat(ชั้นที่ถูกของคีย์.options);
  for (const ช่อง of ทุกช่อง) {
    assert.ok(ชนิดที่ถูกของช่อง[ช่อง], `ช่อง ${ช่อง} ยังไม่มีชนิดกำกับไว้ในด่าน`);
  }
  assert.strictEqual(ชนิดที่ถูกของช่อง.spouse, 'ใช่หรือไม่ใช่');
  assert.strictEqual(ชนิดที่ถูกของช่อง.professionType, 'ข้อความ');
  assert.strictEqual(ชนิดที่ถูกของช่อง.salary, 'ตัวเลข');
});

// ---- ด่านตรวจที่มา กับคำว่า "ประกัน" ที่ขึ้นต้นประกันหลายชนิด ----
// เอ่ยถึงประกันชนิดหนึ่ง ต้องไม่ทำให้ด่านรับประกันชนิดอื่นที่แบบจำลองเติมเอง
test('TC-91 ผู้ใช้เอ่ยถึงประกันบำนาญ ต้องไม่รับเบี้ยประกันชีวิตที่แบบจำลองเติมเอง', () => {
  const คำถาม =
    'เงินเดือนปีละ 1,500,000 บาท ซื้อ RMF 300,000 บาท และประกันบำนาญอีก 300,000 บาท โสด ภาษีเท่าไหร่';
  const ผล = ตรวจที่มาของค่าลดหย่อน(
    { income: { salary: 1500000 }, allowances: { rmf: 300000, pensionInsurance: 300000, lifeInsurance: 200000 } },
    คำถาม
  );
  assert.deepStrictEqual(
    ผล.ตัดออก.map((r) => r.ช่อง),
    ['lifeInsurance'],
    'ต้องตัดเฉพาะเบี้ยประกันชีวิตที่ผู้ใช้ไม่ได้เอ่ยถึง'
  );
  assert.strictEqual(ผล.ข้อมูล.allowances.rmf, 300000, 'ห้ามแตะยอด RMF ที่ผู้ใช้บอกมาจริง');
  assert.strictEqual(
    ผล.ข้อมูล.allowances.pensionInsurance,
    300000,
    'ประกันบำนาญผู้ใช้เอ่ยถึงจริง ห้ามตัด'
  );
});

test('TC-92 ผู้ใช้เอ่ยถึงประกันชีวิตตรง ๆ ต้องไม่ถูกตัด', () => {
  const ผล = ตรวจที่มาของค่าลดหย่อน(
    { income: { salary: 600000 }, allowances: { lifeInsurance: 100000, socialSecurity: 9000 } },
    'เงินเดือนปีละ 600,000 บาท ประกันสังคม 9,000 บาท จ่ายเบี้ยประกันชีวิต 100,000 บาท ภาษีเท่าไหร่'
  );
  assert.deepStrictEqual(ผล.ตัดออก, [], 'ทั้งสองรายการผู้ใช้เอ่ยถึงจริง ห้ามตัด');
});

test('TC-93 ผู้ใช้พูดว่าประกันเฉย ๆ ไม่ระบุชนิด ต้องยังรับได้', () => {
  // ด่านมีไว้กันตัวเลขที่เติมเอง ไม่ใช่ลงโทษผู้ใช้ที่พิมพ์ไม่ละเอียด (ตัดค่าจริงทิ้งเสียหายกว่า)
  const ผล = ตรวจที่มาของค่าลดหย่อน(
    { income: { salary: 600000 }, allowances: { lifeInsurance: 50000 } },
    'เงินเดือนปีละ 600,000 บาท ซื้อประกัน 50,000 บาท ภาษีเท่าไหร่'
  );
  assert.deepStrictEqual(ผล.ตัดออก, [], 'ผู้ใช้พูดถึงประกันจริง แม้ไม่ระบุชนิด');
});

test('TC-94 ผู้ใช้เอ่ยถึงประกันสังคมอย่างเดียว ต้องไม่รับประกันชนิดอื่นที่เติมเข้ามา', () => {
  const ผล = ตรวจที่มาของค่าลดหย่อน(
    { income: { salary: 600000 }, allowances: { socialSecurity: 9000, healthInsurance: 25000 } },
    'เงินเดือนปีละ 600,000 บาท จ่ายประกันสังคม 9,000 บาท ภาษีเท่าไหร่'
  );
  assert.deepStrictEqual(
    ผล.ตัดออก.map((r) => r.ช่อง),
    ['healthInsurance'],
    'ประกันสุขภาพผู้ใช้ไม่ได้เอ่ยถึง ต้องถูกตัด'
  );
});
