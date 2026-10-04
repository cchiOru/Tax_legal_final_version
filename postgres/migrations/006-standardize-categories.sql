-- Migration 006: จัดหมวด tax_law_knowledge ใหม่ตามประมวลรัษฎากร หมวด 3 ส่วน 2 (หมวดเดิมเก็บใน category_legacy)
-- และเพิ่ม needs_calculation (ตัวเลขต้องเอาไปคำนวณต่อไหม) กับ calc_verified (ผู้ดูแลยืนยันแล้วหรือยัง)
-- ชื่อหมวดถูกส่งให้ AI อ่านด้วย หลังรันควรวัดผลใหม่ ถ้าแย่ลงย้อนกลับได้ (ดูท้ายไฟล์)

BEGIN;

-- ---- 1) เก็บหมวดเดิมไว้ย้อนกลับ ----
ALTER TABLE tax_law_knowledge
    ADD COLUMN IF NOT EXISTS category_legacy VARCHAR(100);

-- คัดลอกเฉพาะครั้งแรก รันซ้ำจะไม่ทับค่าเดิม
UPDATE tax_law_knowledge
SET category_legacy = category
WHERE category_legacy IS NULL;

COMMENT ON COLUMN tax_law_knowledge.category_legacy IS
  'หมวดเดิมก่อนจัดใหม่ตามประมวลรัษฎากร เก็บไว้เพื่อย้อนกลับได้ถ้าผลวัดแย่ลง';


-- ---- 2) needs_calculation: ตัวเลขในรายการต้องเอาไปคำนวณต่อหรือไม่ ----
-- ใช้แนบคำเตือนให้ AI ห้ามคิดเลขเอง ไม่ได้ใช้ตัดสินว่าคำถามต้องเรียกเครื่องคำนวณ (อันนั้นดูจากคำถาม)
ALTER TABLE tax_law_knowledge
    ADD COLUMN IF NOT EXISTS needs_calculation BOOLEAN;

ALTER TABLE tax_law_knowledge
    ADD COLUMN IF NOT EXISTS calc_verified BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN tax_law_knowledge.needs_calculation IS
  'true คือตัวเลขในรายการนี้เป็นเพดานหรืออัตราที่ต้องเอาไปคำนวณกับรายได้ของผู้ใช้';
COMMENT ON COLUMN tax_law_knowledge.calc_verified IS
  'true คือผู้ดูแลตรวจยืนยันค่า needs_calculation แล้ว false คือยังเป็นค่าที่ระบบเดาให้';


-- ---- 3) ย้ายหมวดเดิมเข้าหมวดใหม่ (หมวด : มาตราที่รองรับ) ----
-- ผู้มีหน้าที่เสียภาษี ม.56 | ประเภทเงินได้พึงประเมิน ม.40 | เงินได้ที่ได้รับยกเว้น ม.42 | การหักค่าใช้จ่าย ม.42 ทวิ-46
-- การหักลดหย่อน ม.47 | การคำนวณภาษี ม.48 | การยื่นแบบและชำระภาษี ม.56-57 | การขอคืนภาษี ม.63
-- เบี้ยปรับ เงินเพิ่ม และโทษ ม.22, 27, 35 | การอุทธรณ์ ม.30 | ภาษีอื่นที่เกี่ยวข้อง = นอกขอบเขต แต่ผู้ใช้ถามถึง
UPDATE tax_law_knowledge SET category = CASE category_legacy
    WHEN 'ค่าลดหย่อนภาษี'          THEN 'การหักลดหย่อน'
    WHEN 'สิทธิ์ลดหย่อน'            THEN 'การหักลดหย่อน'
    WHEN 'เคล็ดลับประหยัดภาษี'      THEN 'การหักลดหย่อน'

    WHEN 'คำนวณภาษี'              THEN 'การคำนวณภาษี'
    WHEN 'การคำนวณภาษี'            THEN 'การคำนวณภาษี'
    -- เงินก้อนออกจากงานคำนวณแยกตาม ม.48(5) จึงอยู่หมวดคำนวณ
    WHEN 'ออกจากงานและเกษียณ'      THEN 'การคำนวณภาษี'

    WHEN 'ประเภทเงินได้'           THEN 'ประเภทเงินได้พึงประเมิน'
    WHEN 'เงินได้เฉพาะกรณี'         THEN 'ประเภทเงินได้พึงประเมิน'

    WHEN 'เงินได้ยกเว้นภาษี'         THEN 'เงินได้ที่ได้รับยกเว้น'

    WHEN 'กำหนดการยื่นภาษี'         THEN 'การยื่นแบบและชำระภาษี'
    WHEN 'แบบแสดงรายการภาษี'       THEN 'การยื่นแบบและชำระภาษี'
    WHEN 'ขั้นตอนปฏิบัติ'            THEN 'การยื่นแบบและชำระภาษี'
    WHEN 'ภาษีหัก ณ ที่จ่าย'         THEN 'การยื่นแบบและชำระภาษี'

    WHEN 'การคืนภาษี'              THEN 'การขอคืนภาษี'
    WHEN 'โทษและเบี้ยปรับ'          THEN 'เบี้ยปรับ เงินเพิ่ม และโทษ'
    WHEN 'แก้ไขและโต้แย้ง'          THEN 'การอุทธรณ์'

    WHEN 'ภาษีเงินได้บุคคลธรรมดา'    THEN 'ผู้มีหน้าที่เสียภาษี'
    WHEN 'สถานการณ์เฉพาะบุคคล'      THEN 'ผู้มีหน้าที่เสียภาษี'

    -- ที่เหลือคือภาษีประเภทอื่นนอกขอบเขต แต่ยังเก็บไว้ตอบได้
    ELSE 'ภาษีอื่นที่เกี่ยวข้อง'
END;


-- ---- 4) เดาค่าตั้งต้นของ needs_calculation ----
-- true เมื่ออยู่หมวดที่เกี่ยวกับเงิน และเนื้อหามีจำนวนเงิน (x,xxx บาท) หรือร้อยละ
-- เป็นค่าเดา ให้ผู้ดูแลยืนยันทีหลัง (calc_verified บอกว่ารายการไหนยังเป็นค่าเดา)
UPDATE tax_law_knowledge
SET needs_calculation = (
    category IN ('การหักลดหย่อน', 'การคำนวณภาษี', 'การหักค่าใช้จ่าย',
                 'ประเภทเงินได้พึงประเมิน', 'เบี้ยปรับ เงินเพิ่ม และโทษ')
    AND (content ~ '[0-9],[0-9]{3}\s*บาท' OR content ~ 'ร้อยละ\s*[0-9]' OR content ~ '[0-9]+%')
)
WHERE needs_calculation IS NULL;

-- ที่ยังเป็น NULL ถือว่าไม่ต้องคำนวณต่อ
UPDATE tax_law_knowledge SET needs_calculation = false WHERE needs_calculation IS NULL;

ALTER TABLE tax_law_knowledge ALTER COLUMN needs_calculation SET NOT NULL;
ALTER TABLE tax_law_knowledge ALTER COLUMN needs_calculation SET DEFAULT false;


-- ---- 5) ดัชนีสำหรับหน้าหลังบ้าน ----
CREATE INDEX IF NOT EXISTS idx_tax_law_knowledge_category
    ON tax_law_knowledge (category);
CREATE INDEX IF NOT EXISTS idx_tax_law_knowledge_unverified
    ON tax_law_knowledge (calc_verified) WHERE calc_verified = false;

-- ให้บัญชีของหน้าหลังบ้านแก้คอลัมน์ใหม่ได้
GRANT SELECT, INSERT, UPDATE, DELETE ON tax_law_knowledge TO tax_admin_readonly;

COMMIT;


-- ---- ตรวจผล ----

SELECT category AS หมวดใหม่,
       count(*) AS จำนวน,
       count(*) FILTER (WHERE needs_calculation) AS ต้องคำนวณต่อ,
       count(*) FILTER (WHERE NOT calc_verified) AS ยังไม่ได้ตรวจ
FROM tax_law_knowledge
GROUP BY 1
ORDER BY 2 DESC;

-- ต้องได้ 0 แถว ถ้ามีแปลว่าย้ายหมวดไม่สำเร็จ (รายการหมวดนี้ต้องตรงกับ dropdown ใน admin/knowledge.js)
SELECT id, category, category_legacy
FROM tax_law_knowledge
WHERE category NOT IN (
  'ผู้มีหน้าที่เสียภาษี', 'ประเภทเงินได้พึงประเมิน', 'เงินได้ที่ได้รับยกเว้น',
  'การหักค่าใช้จ่าย', 'การหักลดหย่อน', 'การคำนวณภาษี',
  'การยื่นแบบและชำระภาษี', 'การขอคืนภาษี', 'เบี้ยปรับ เงินเพิ่ม และโทษ',
  'การอุทธรณ์', 'ภาษีอื่นที่เกี่ยวข้อง'
);


-- ---- ย้อนกลับ (คืนหมวดเดิมทุกรายการ คอลัมน์ใหม่ไม่ต้องลบ) ----
--    UPDATE tax_law_knowledge SET category = category_legacy
--    WHERE category_legacy IS NOT NULL;
