-- Migration 003: เพิ่ม conversations.question_category (ประเภทคำถาม/intent) และคอลัมน์โปรไฟล์ LINE ใน users
-- พร้อม view v_intent_stats (สัดส่วนประเภทคำถาม) และ v_user_stats (สรุปรายผู้ใช้)

BEGIN;

-- ---- 1) ประเภทคำถาม ----
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS question_category VARCHAR(50);

COMMENT ON COLUMN conversations.question_category IS
  'ประเภทคำถามที่ระบบจำแนกได้ ใช้วิเคราะห์พฤติกรรมการใช้งานและความต้องการของผู้ใช้';

-- ---- 2) โปรไฟล์ผู้ใช้จาก LINE Profile API ----
ALTER TABLE users ADD COLUMN IF NOT EXISTS picture_url TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS status_message TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ DEFAULT now();

COMMENT ON COLUMN users.display_name IS 'ชื่อที่ผู้ใช้ตั้งไว้ใน LINE ดึงมาจาก LINE Profile API';
COMMENT ON COLUMN users.first_seen_at IS 'เวลาที่ผู้ใช้ทักเข้ามาครั้งแรก ใช้แยกผู้ใช้ใหม่กับผู้ใช้เดิม';

-- ---- 3) view สัดส่วนประเภทคำถาม ----
CREATE OR REPLACE VIEW v_intent_stats AS
SELECT
    COALESCE(question_category, 'ไม่ระบุ')                        AS ประเภทคำถาม,
    COUNT(*)                                                       AS จำนวนครั้ง,
    ROUND(100.0 * COUNT(*) / NULLIF(SUM(COUNT(*)) OVER (), 0), 2)  AS ร้อยละ,
    ROUND(AVG(response_time_ms)::numeric, 0)                       AS เวลาเฉลี่ย_ms,
    ROUND(AVG(knowledge_hits)::numeric, 2)                         AS ความรู้เฉลี่ย
FROM conversations
WHERE role = 'assistant'
GROUP BY question_category
ORDER BY COUNT(*) DESC;

COMMENT ON VIEW v_intent_stats IS
  'สัดส่วนประเภทคำถามที่ผู้ใช้ถาม ใช้ตอบว่าผู้ใช้ต้องการอะไรจากระบบมากที่สุด';

-- ---- 4) view สรุปการใช้งานรายผู้ใช้ ----
CREATE OR REPLACE VIEW v_user_stats AS
SELECT
    u.id,
    u.display_name                                            AS ชื่อผู้ใช้,
    COUNT(*) FILTER (WHERE c.role = 'user')                   AS จำนวนคำถาม,
    MIN(c.created_at)                                         AS ใช้งานครั้งแรก,
    MAX(c.created_at)                                         AS ใช้งานล่าสุด,
    ROUND(AVG(c.response_time_ms) FILTER (WHERE c.role = 'assistant')::numeric, 0)
                                                              AS เวลาตอบสนองเฉลี่ย_ms
FROM users u
LEFT JOIN conversations c ON c.user_id = u.id
GROUP BY u.id, u.display_name
ORDER BY COUNT(*) FILTER (WHERE c.role = 'user') DESC;

COMMENT ON VIEW v_user_stats IS
  'สรุปการใช้งานรายบุคคล ใช้อธิบายลักษณะกลุ่มตัวอย่างที่ทดสอบระบบ';

COMMIT;

-- ตรวจผล
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'conversations'
ORDER BY ordinal_position;

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'users'
ORDER BY ordinal_position;
