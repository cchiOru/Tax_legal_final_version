-- Migration 005: ตารางและสิทธิ์สำหรับหน้าหลังบ้าน โดยผู้ดูแลต้องอ่านประวัติแชทไม่ได้
-- เพิ่ม knowledge_gaps, answer_feedback, view สรุปการใช้งาน และ role tax_admin_readonly ที่อ่านข้อความผู้ใช้ไม่ได้
-- ต้องมีตาราง revenue_code_current ก่อน ไม่งั้น GRANT ล้มและทั้งไฟล์ถูกยกเลิก (อยู่ใน BEGIN/COMMIT)
-- รันซ้ำได้ไม่เสียข้อมูล แต่ REVOKE ALL จะล้างสิทธิ์ที่ migration 010 ให้ไว้ ต้องรัน 010 ซ้ำตาม

BEGIN;

-- ---- 1) knowledge_gaps: คำสำคัญที่ค้นไม่เจอ ----
-- เก็บแค่คำสำคัญกับหมวด ตั้งใจไม่มี user_id/conversation_id เพื่อไม่ให้โยงกลับไปหาบทสนทนาได้
CREATE TABLE IF NOT EXISTS knowledge_gaps (
    id            SERIAL PRIMARY KEY,

    -- คำเดี่ยวที่ค้นไม่เจอ ไม่ใช่ประโยค เช่น บุตรบุญธรรม
    keyword       VARCHAR(100) NOT NULL,

    -- หมวดที่จำแนกได้ตอนนั้น ใช้ดูว่าช่องว่างกระจุกอยู่หมวดไหน
    category      VARCHAR(100),

    -- นับรวมแทนการเก็บรายครั้ง จึงโยงกลับไปหาเหตุการณ์รายครั้งไม่ได้
    hit_count     INTEGER NOT NULL DEFAULT 1,

    first_seen_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    last_seen_at  TIMESTAMPTZ NOT NULL DEFAULT now(),

    -- open ยังไม่เติมความรู้ / done เติมแล้ว / wontfix ไม่ทำ (เขียนเหตุผลใน note)
    status        VARCHAR(16) NOT NULL DEFAULT 'open'
                  CHECK (status IN ('open', 'done', 'wontfix')),
    note          TEXT,
    resolved_at   TIMESTAMPTZ
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_knowledge_gaps_keyword
    ON knowledge_gaps (keyword);
CREATE INDEX IF NOT EXISTS idx_knowledge_gaps_open
    ON knowledge_gaps (status, hit_count DESC)
    WHERE status = 'open';

COMMENT ON TABLE knowledge_gaps IS
  'คำสำคัญที่ค้นในฐานข้อมูลไม่เจอ สกัดจากคำถามโดยระบบ ไม่มีข้อความของผู้ใช้';
COMMENT ON COLUMN knowledge_gaps.keyword IS
  'คำเดี่ยวที่ระบบดักได้ ไม่ใช่ประโยคของผู้ใช้ จึงไม่ถือเป็นข้อมูลส่วนบุคคล';
COMMENT ON COLUMN knowledge_gaps.hit_count IS
  'นับรวมแทนการเก็บรายครั้ง ทำให้ย้อนกลับไปหาเหตุการณ์รายบุคคลไม่ได้';


-- ---- 2) answer_feedback: คะแนนความพึงพอใจจากปุ่มใน LINE ----
-- เก็บแค่คะแนนกับหมวด ไม่เก็บคำตอบและไม่เก็บว่าใครกด (กันการสร้างโปรไฟล์รายบุคคลเกินที่ขอความยินยอมไว้)
CREATE TABLE IF NOT EXISTS answer_feedback (
    id           SERIAL PRIMARY KEY,

    -- true ตรงคำถาม / false ไม่ตรง (สองระดับเพราะบน LINE กดปุ่มเดียวจบ)
    is_helpful   BOOLEAN NOT NULL,

    -- หมวดของคำถาม ใช้ดูว่าหมวดไหนตอบดีหรือไม่ดี
    category     VARCHAR(100),

    -- จำนวนความรู้ที่ค้นเจอ ใช้ดูว่าค้นเจอน้อยทำให้ไม่พอใจหรือไม่
    knowledge_hits INTEGER,

    -- เวลาที่ใช้ตอบ ใช้ดูว่าตอบช้าทำให้ไม่พอใจหรือไม่
    response_time_ms INTEGER,

    created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_answer_feedback_created
    ON answer_feedback (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_answer_feedback_category
    ON answer_feedback (category, is_helpful);

COMMENT ON TABLE answer_feedback IS
  'คะแนนความพึงพอใจต่อคำตอบ ไม่เก็บว่าใครกดและไม่เก็บว่าคำตอบคืออะไร';
COMMENT ON COLUMN answer_feedback.is_helpful IS
  'true คือผู้ใช้กดว่าตรงคำถาม false คือกดว่าไม่ตรง';


-- ---- 3) view สรุปการใช้งานสำหรับแดชบอร์ด ----
-- คืนเฉพาะตัวเลขนับ ไม่มีคอลัมน์ message หน้าหลังบ้านจึงไม่ต้องแตะ conversations โดยตรง
CREATE OR REPLACE VIEW v_usage_daily AS
SELECT
    created_at::date                                    AS วันที่,
    count(*) FILTER (WHERE role = 'user')               AS จำนวนคำถาม,
    count(DISTINCT user_id)                             AS จำนวนผู้ใช้,
    round(avg(response_time_ms) FILTER (WHERE role = 'assistant'))
                                                        AS เวลาตอบเฉลี่ย_ms,
    count(*) FILTER (WHERE role = 'assistant' AND coalesce(knowledge_hits, 0) = 0)
                                                        AS ครั้งที่ค้นไม่เจอ
FROM conversations
GROUP BY 1;

COMMENT ON VIEW v_usage_daily IS
  'สรุปการใช้งานรายวัน คืนเฉพาะตัวเลขนับ ไม่มีข้อความของผู้ใช้ในผลลัพธ์';

CREATE OR REPLACE VIEW v_usage_monthly AS
SELECT
    to_char(created_at, 'YYYY-MM')                      AS เดือน,
    count(*) FILTER (WHERE role = 'user')               AS จำนวนคำถาม,
    count(DISTINCT user_id)                             AS จำนวนผู้ใช้,
    round(avg(response_time_ms) FILTER (WHERE role = 'assistant'))
                                                        AS เวลาตอบเฉลี่ย_ms
FROM conversations
GROUP BY 1;

CREATE OR REPLACE VIEW v_usage_yearly AS
SELECT
    to_char(created_at, 'YYYY')                         AS ปี,
    count(*) FILTER (WHERE role = 'user')               AS จำนวนคำถาม,
    count(DISTINCT user_id)                             AS จำนวนผู้ใช้
FROM conversations
GROUP BY 1;


-- ---- 4) role tax_admin_readonly สำหรับหน้าหลังบ้าน ----
-- บังคับที่สิทธิ์ฐานข้อมูล: อ่าน conversations, n8n_chat_histories, users ไม่ได้ แม้โค้ดเว็บจะเขียนผิด
-- ตั้งรหัสผ่านจริงด้วย ALTER ROLE tax_admin_readonly PASSWORD '...' ให้ตรงกับ ADMIN_DB_PASSWORD ใน .env
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tax_admin_readonly') THEN
        CREATE ROLE tax_admin_readonly LOGIN PASSWORD 'ต้องเปลี่ยนรหัสผ่านนี้ทันที';
    END IF;
END
$$;

-- เพิกถอนสิทธิ์ทั้งหมดก่อน แล้วค่อยให้เฉพาะที่จำเป็น
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM tax_admin_readonly;
GRANT USAGE ON SCHEMA public TO tax_admin_readonly;

-- แก้ฐานความรู้ได้ (หน้าที่หลักของผู้ดูแล)
GRANT SELECT, INSERT, UPDATE, DELETE ON tax_law_knowledge TO tax_admin_readonly;
GRANT USAGE, SELECT ON SEQUENCE tax_law_knowledge_id_seq TO tax_admin_readonly;

-- ตัวบทกฎหมายอ่านได้อย่างเดียว (ดึงจากเว็บกรมสรรพากร)
GRANT SELECT ON revenue_code_current TO tax_admin_readonly;

-- จัดการรายการช่องว่างความรู้และดูคะแนนความพึงพอใจได้
GRANT SELECT, INSERT, UPDATE ON knowledge_gaps TO tax_admin_readonly;
GRANT USAGE, SELECT ON SEQUENCE knowledge_gaps_id_seq TO tax_admin_readonly;
GRANT SELECT ON answer_feedback TO tax_admin_readonly;

-- ดูสรุปการใช้งานได้ผ่าน VIEW เท่านั้น
GRANT SELECT ON v_usage_daily, v_usage_monthly, v_usage_yearly TO tax_admin_readonly;

-- ย้ำว่าห้ามแตะตารางที่มีข้อความผู้ใช้ (ซ้ำกับ REVOKE ALL ข้างบนโดยตั้งใจ)
REVOKE ALL ON conversations FROM tax_admin_readonly;
REVOKE ALL ON n8n_chat_histories FROM tax_admin_readonly;
REVOKE ALL ON users FROM tax_admin_readonly;

COMMIT;

-- ---- ตรวจผล ----

-- ต้องไม่มีแถวคืนมา ถ้ามีแปลว่าสิทธิ์รั่ว
SELECT table_name, privilege_type
FROM information_schema.role_table_grants
WHERE grantee = 'tax_admin_readonly'
  AND table_name IN ('conversations', 'n8n_chat_histories', 'users');

-- รายการที่บัญชีนี้เข้าถึงได้จริง
SELECT table_name, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS สิทธิ์
FROM information_schema.role_table_grants
WHERE grantee = 'tax_admin_readonly'
GROUP BY table_name
ORDER BY table_name;
