-- ตรวจว่า SQL ของโหนด Log Knowledge Gap และ Save Feedback รันกับ PostgreSQL จริงได้
-- (ส่วนที่ tests/test-feedback-and-gaps.js ตรวจไม่ได้เพราะไม่มีฐานข้อมูล) ทุกอย่าง ROLLBACK ตอนจบ ไม่ทิ้งข้อมูลค้าง
-- รัน: docker cp postgres\ตรวจ-เส้นทางข้อมูลหลังบ้าน.sql tax-advisor-postgres:/tmp/check.sql
--      docker exec -it tax-advisor-postgres psql -U n8n_admin -d tax_advisor -f /tmp/check.sql
-- ผลที่ต้องได้: คอลัมน์ ผล ขึ้นว่า ผ่าน ทุกบรรทัด

BEGIN;

-- ---- 0) ตารางและดัชนีที่ต้องมีก่อน ----
SELECT 'โครงสร้าง' AS ขั้น,
       'ตาราง knowledge_gaps มีอยู่' AS สิ่งที่ตรวจ,
       CASE WHEN to_regclass('public.knowledge_gaps') IS NOT NULL
            THEN 'ผ่าน' ELSE 'ไม่ผ่าน ให้รัน migration 005 ก่อน' END AS ผล
UNION ALL
SELECT 'โครงสร้าง',
       'ตาราง answer_feedback มีอยู่',
       CASE WHEN to_regclass('public.answer_feedback') IS NOT NULL
            THEN 'ผ่าน' ELSE 'ไม่ผ่าน ให้รัน migration 005 ก่อน' END
UNION ALL
-- ไม่มีดัชนีไม่ซ้ำ ON CONFLICT (keyword) จะพังตอนรันจริง
SELECT 'โครงสร้าง',
       'มีดัชนีไม่ซ้ำบนคอลัมน์ keyword',
       CASE WHEN EXISTS (
                SELECT 1 FROM pg_indexes
                WHERE tablename = 'knowledge_gaps' AND indexdef ILIKE '%UNIQUE%(keyword)%'
            ) THEN 'ผ่าน' ELSE 'ไม่ผ่าน ON CONFLICT จะใช้ไม่ได้' END;


-- ---- 1) คำสั่งเดียวกับโหนด Log Knowledge Gap ----
-- ต้อง cast พารามิเตอร์ ($1::varchar) ไม่งั้นขึ้น could not determine data type of parameter
-- กรณี 1: คำที่ค้นไม่เจอ แทรกแถวใหม่ เจอซ้ำต้องเพิ่มตัวนับ
PREPARE บันทึกช่องว่าง (varchar, varchar) AS
INSERT INTO knowledge_gaps (keyword, category)
SELECT $1::varchar, $2::varchar
WHERE $1::varchar IS NOT NULL
ON CONFLICT (keyword) DO UPDATE SET
    hit_count    = knowledge_gaps.hit_count + 1,
    last_seen_at = now(),
    status       = CASE WHEN knowledge_gaps.status = 'done'
                       THEN 'open' ELSE knowledge_gaps.status END;

EXECUTE บันทึกช่องว่าง('คำทดสอบห้ามค้างไว้', 'กฎหมายภาษี');
EXECUTE บันทึกช่องว่าง('คำทดสอบห้ามค้างไว้', 'กฎหมายภาษี');
EXECUTE บันทึกช่องว่าง('คำทดสอบห้ามค้างไว้', 'กฎหมายภาษี');

SELECT 'บันทึกช่องว่าง' AS ขั้น,
       'เจอคำเดิมซ้ำ ต้องเพิ่มตัวนับ ไม่ใช่แทรกแถวใหม่' AS สิ่งที่ตรวจ,
       CASE WHEN (SELECT count(*) FROM knowledge_gaps
                  WHERE keyword = 'คำทดสอบห้ามค้างไว้') = 1
             AND (SELECT hit_count FROM knowledge_gaps
                  WHERE keyword = 'คำทดสอบห้ามค้างไว้') = 3
            THEN 'ผ่าน' ELSE 'ไม่ผ่าน' END AS ผล;

-- กรณี 2 (บ่อยสุด): ค้นเจอแล้ว keyword เป็น NULL ต้องไม่แทรกอะไร
EXECUTE บันทึกช่องว่าง(NULL, 'กฎหมายภาษี');

SELECT 'บันทึกช่องว่าง' AS ขั้น,
       'ไม่มีคำที่ค้นไม่เจอ ต้องไม่แทรกแถวว่าง' AS สิ่งที่ตรวจ,
       CASE WHEN (SELECT count(*) FROM knowledge_gaps WHERE keyword IS NULL) = 0
            THEN 'ผ่าน' ELSE 'ไม่ผ่าน มีแถวที่ไม่มีคำสำคัญหลุดเข้ามา' END AS ผล;

-- กรณี 3: เคยปิด (done) แต่ยังค้นไม่เจอ ต้องเปิดกลับเป็น open
UPDATE knowledge_gaps SET status = 'done'
WHERE keyword = 'คำทดสอบห้ามค้างไว้';
EXECUTE บันทึกช่องว่าง('คำทดสอบห้ามค้างไว้', 'กฎหมายภาษี');

SELECT 'บันทึกช่องว่าง' AS ขั้น,
       'เติมความรู้แล้วแต่ยังค้นไม่เจอ ต้องเปิดเรื่องกลับมา' AS สิ่งที่ตรวจ,
       CASE WHEN (SELECT status FROM knowledge_gaps
                  WHERE keyword = 'คำทดสอบห้ามค้างไว้') = 'open'
            THEN 'ผ่าน' ELSE 'ไม่ผ่าน' END AS ผล;

-- กรณี 4: wontfix เป็นการตัดสินใจของคน ต้องไม่ถูกเปิดกลับเอง
UPDATE knowledge_gaps SET status = 'wontfix'
WHERE keyword = 'คำทดสอบห้ามค้างไว้';
EXECUTE บันทึกช่องว่าง('คำทดสอบห้ามค้างไว้', 'กฎหมายภาษี');

SELECT 'บันทึกช่องว่าง' AS ขั้น,
       'เรื่องที่คนตัดสินใจว่าไม่ทำ ต้องไม่ถูกเปิดกลับเอง' AS สิ่งที่ตรวจ,
       CASE WHEN (SELECT status FROM knowledge_gaps
                  WHERE keyword = 'คำทดสอบห้ามค้างไว้') = 'wontfix'
            THEN 'ผ่าน' ELSE 'ไม่ผ่าน' END AS ผล;


-- ---- 2) คำสั่งเดียวกับโหนด Save Feedback ----
PREPARE บันทึกคะแนน (boolean, varchar, int, int) AS
INSERT INTO answer_feedback
    (is_helpful, category, knowledge_hits, response_time_ms)
VALUES ($1::boolean, $2::varchar, $3::int, $4::int);

EXECUTE บันทึกคะแนน(true,  'สิทธิ์ลดหย่อน', 3, 2100);
EXECUTE บันทึกคะแนน(false, 'คำนวณภาษี',    0, 8400);
-- ข้อมูลจากปุ่มผิดรูปจะได้ค่าว่าง ตารางต้องรับได้
EXECUTE บันทึกคะแนน(true,  NULL,           NULL, NULL);

SELECT 'บันทึกคะแนน' AS ขั้น,
       'บันทึกได้ทั้งกรณีข้อมูลครบและกรณีค่าว่าง' AS สิ่งที่ตรวจ,
       CASE WHEN (SELECT count(*) FROM answer_feedback) = 3
            THEN 'ผ่าน' ELSE 'ไม่ผ่าน' END AS ผล;

-- สัดส่วนที่หน้าความพึงพอใจแสดงต้องคำนวณได้จริง
SELECT 'บันทึกคะแนน' AS ขั้น,
       'หน้าหลังบ้านคำนวณสัดส่วนความพึงพอใจได้' AS สิ่งที่ตรวจ,
       CASE WHEN (SELECT round(100.0 * count(*) FILTER (WHERE is_helpful) / count(*))
                  FROM answer_feedback) = 67
            THEN 'ผ่าน' ELSE 'ไม่ผ่าน' END AS ผล;


-- ---- 3) ความเป็นส่วนตัว: สองตารางต้องไม่มีคอลัมน์ระบุตัวผู้ใช้หรือเก็บข้อความ ----
SELECT 'ความเป็นส่วนตัว' AS ขั้น,
       'ตารางทั้งสองไม่มีคอลัมน์ที่ระบุตัวผู้ใช้หรือเก็บข้อความ' AS สิ่งที่ตรวจ,
       CASE WHEN NOT EXISTS (
                SELECT 1 FROM information_schema.columns
                WHERE table_name IN ('knowledge_gaps', 'answer_feedback')
                  AND (column_name ILIKE '%user%'
                    OR column_name ILIKE '%message%'
                    OR column_name ILIKE '%answer%'
                    OR column_name ILIKE '%question%'
                    OR column_name ILIKE '%conversation%')
            ) THEN 'ผ่าน' ELSE 'ไม่ผ่าน มีคอลัมน์ที่ไม่ควรมี' END AS ผล;

DEALLOCATE บันทึกช่องว่าง;
DEALLOCATE บันทึกคะแนน;

-- ย้อนทุกอย่าง ไม่ให้ข้อมูลทดสอบค้าง
ROLLBACK;

-- ยืนยันหลังย้อนกลับแล้วว่าไม่มีอะไรค้าง ต้องได้ 0 ทั้งสองค่า
SELECT (SELECT count(*) FROM knowledge_gaps WHERE keyword = 'คำทดสอบห้ามค้างไว้')
         AS แถวทดสอบที่ค้างในตารางช่องว่าง,
       (SELECT count(*) FROM answer_feedback WHERE response_time_ms IN (2100, 8400))
         AS แถวทดสอบที่ค้างในตารางคะแนน;
