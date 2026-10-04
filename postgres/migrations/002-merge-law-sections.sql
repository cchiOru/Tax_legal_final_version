-- Migration 002: สร้าง view รวมย่อหน้าใน revenue_code_sections ที่ถูกแบ่งเป็นหลายแถว ให้กลับเป็นรายมาตรา
-- ต้องมีตาราง revenue_code_sections (ตัวบทชุดเก่าจาก Open Law Data Thailand) อยู่ก่อน ไม่งั้นจะ error

-- ---- view รวมย่อหน้าเป็นรายมาตรา ----
CREATE OR REPLACE VIEW v_law_sections AS
WITH runs AS (
    SELECT
        id,
        law_title,
        section_no,
        section_name,
        content,
        publish_date,
        reference_url,
        is_latest,
        -- gaps and islands: แถวที่เรียงติดกันได้ค่าเดียวกัน ใช้แยกออกจากมาตราอื่นที่เลขซ้ำ
        id - ROW_NUMBER() OVER (PARTITION BY law_title, section_no ORDER BY id) AS run_group
    FROM revenue_code_sections
    WHERE section_no IS NOT NULL AND section_no <> ''
)
SELECT
    MIN(id)                                   AS first_id,
    law_title,
    section_no,
    MIN(section_name)                         AS section_name,
    string_agg(content, ' ' ORDER BY id)      AS content,
    MIN(publish_date)                         AS publish_date,
    MIN(reference_url)                        AS reference_url,
    bool_or(is_latest)                        AS is_latest,
    COUNT(*)                                  AS fragment_count,
    LENGTH(string_agg(content, ' ' ORDER BY id)) AS content_length
FROM runs
GROUP BY law_title, section_no, run_group;

COMMENT ON VIEW v_law_sections IS
  'ตัวบทกฎหมายรายมาตราที่รวมย่อหน้าย่อยเข้าด้วยกันแล้ว ใช้สำหรับอ้างอิงเลขมาตราในคำตอบ';

-- ---- ประมวลรัษฎากร: เลือกฉบับที่ยาวที่สุดของแต่ละมาตรา (มักเป็นตัวบทเต็ม) ----
CREATE OR REPLACE VIEW v_revenue_code AS
SELECT DISTINCT ON (section_no)
    section_no,
    section_name,
    content,
    content_length,
    fragment_count,
    reference_url
FROM v_law_sections
WHERE law_title = 'ประมวลรัษฎากร'
ORDER BY section_no, content_length DESC;

COMMENT ON VIEW v_revenue_code IS
  'ประมวลรัษฎากรรายมาตรา เลือกเนื้อหาฉบับเต็มของแต่ละมาตรา';

-- ---- ตรวจผล ----

-- จำนวนมาตราหลังรวมย่อหน้า
SELECT 'มาตราทั้งหมดหลังรวมย่อหน้า: ' || COUNT(*) AS สรุป FROM v_law_sections;
SELECT 'ประมวลรัษฎากรมีทั้งหมด: ' || COUNT(*) || ' มาตรา' AS สรุป FROM v_revenue_code;

-- มาตราสำคัญที่ระบบใช้อ้างอิง
SELECT
    section_no AS มาตรา,
    fragment_count AS จำนวนย่อหน้าที่รวม,
    content_length AS ความยาวตัวอักษร,
    LEFT(content, 80) AS ตัวอย่างเนื้อหา
FROM v_revenue_code
WHERE section_no IN ('27', '35', '40', '42 ทวิ', '47', '48')
ORDER BY content_length DESC;
