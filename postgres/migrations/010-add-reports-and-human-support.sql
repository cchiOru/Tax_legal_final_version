-- Migration 010: รองรับปุ่มที่ 6 ของ Rich Menu คือรายงานปัญหาคำตอบ (answer_reports) และขอคุยกับแอดมิน (users.human_support_until)
-- ผู้ดูแลอ่านข้อความคำถามใน answer_reports ไม่ได้ บังคับด้วยสิทธิ์ฐานข้อมูล ให้อ่านได้แค่ view v_report_summary
-- (view ตรวจสิทธิ์ด้วยเจ้าของ view จึงอ่านสรุปได้โดยไม่ต้องมีสิทธิ์ในตารางต้นทาง แบบเดียวกับ v_usage_daily ใน 005)

BEGIN;

-- ---- ตารางรายงานปัญหาจากผู้ใช้ ----
CREATE TABLE IF NOT EXISTS answer_reports (
    id           SERIAL PRIMARY KEY,

    -- สาเหตุจากปุ่มที่กด: not_match ตอบไม่ตรง / cannot ระบบตอบไม่ได้ / wrong_info ข้อมูลผิด
    reason       VARCHAR(20) NOT NULL
                 CHECK (reason IN ('not_match', 'cannot', 'wrong_info')),

    -- หมวดของคำถามที่ถูกรายงาน
    category     VARCHAR(100),

    -- ข้อความคำถามล่าสุด เก็บไว้ปรับปรุงฐานความรู้ ผู้ดูแลอ่านไม่ได้ (ดูส่วนสิทธิ์)
    question     TEXT,

    -- จำนวนความรู้ที่ค้นเจอตอนตอบ ใช้ดูว่าค้นไม่เจอทำให้ถูกรายงานหรือไม่
    knowledge_hits INTEGER,

    -- open ยังไม่จัดการ / done จัดการแล้ว / wontfix ไม่แก้ (ผู้ดูแลกดปิดจากหน้าหลังบ้าน)
    status       VARCHAR(16) NOT NULL DEFAULT 'open'
                 CHECK (status IN ('open', 'done', 'wontfix')),

    created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
    resolved_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_answer_reports_created
    ON answer_reports (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_answer_reports_status
    ON answer_reports (status);

COMMENT ON TABLE answer_reports IS
    'รายงานปัญหาจากผู้ใช้ผ่านปุ่มใน Rich Menu '
    'คอลัมน์ question เป็นข้อความของผู้ใช้ ห้ามให้บัญชีผู้ดูแลระบบอ่าน';
COMMENT ON COLUMN answer_reports.question IS
    'ข้อความของผู้ใช้ เก็บไว้ให้ระบบนำไปปรับปรุงความรู้เท่านั้น '
    'บัญชี tax_admin_readonly ไม่มีสิทธิ์อ่านตารางนี้';

-- ---- view สรุปสำหรับหน้าหลังบ้าน ----
-- จงใจไม่มีคอลัมน์ question และ id รายแถว ผู้ดูแลเห็นแค่หมวด สาเหตุ จำนวน ช่วงเวลา
CREATE OR REPLACE VIEW v_report_summary AS
SELECT
    date_trunc('day', created_at)::date AS วันที่,
    coalesce(category, 'ไม่ระบุหมวด')   AS หมวด,
    reason                              AS สาเหตุ,
    status                              AS สถานะ,
    count(*)                            AS จำนวนครั้ง,
    round(avg(knowledge_hits)::numeric, 1) AS ค้นเจอเฉลี่ย,
    min(created_at)                     AS ครั้งแรก,
    max(created_at)                     AS ครั้งล่าสุด
FROM answer_reports
GROUP BY 1, 2, 3, 4;

COMMENT ON VIEW v_report_summary IS
    'สรุปรายงานปัญหาแบบไม่มีข้อความของผู้ใช้ ใช้แสดงในหน้าหลังบ้าน';

-- ---- โหมดคุยกับแอดมิน ----
-- ระหว่างนี้บอทหยุดตอบ ให้แอดมินตอบเองใน LINE Official Account Manager (กันคำตอบสองชุดขัดกัน)
-- ใช้เวลาสิ้นสุดแทน true/false เพื่อให้บอทกลับมาตอบเองแม้แอดมินลืมปิด
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS human_support_until TIMESTAMPTZ;

COMMENT ON COLUMN users.human_support_until IS
    'ถึงเวลานี้ให้บอทหยุดตอบ เพราะผู้ใช้กำลังคุยกับแอดมินอยู่ '
    'เลยเวลานี้แล้วบอทกลับมาตอบเองอัตโนมัติ';

CREATE INDEX IF NOT EXISTS idx_users_human_support
    ON users (human_support_until)
    WHERE human_support_until IS NOT NULL;

-- ---- สิทธิ์ (ส่วนสำคัญที่สุด) ----
DO $$
BEGIN
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'tax_admin_readonly') THEN
        -- ห้ามอ่านตารางต้นทาง เพราะมีข้อความผู้ใช้
        EXECUTE 'REVOKE ALL ON answer_reports FROM tax_admin_readonly';

        -- อ่านได้เฉพาะผลสรุป
        EXECUTE 'GRANT SELECT ON v_report_summary TO tax_admin_readonly';
    END IF;
END
$$;

COMMIT;

-- ---- ตรวจว่าด่านทำงาน (รันด้วยบัญชี tax_admin_readonly) ----
--    psql -U tax_admin_readonly -d tax_advisor -c "SELECT question FROM answer_reports LIMIT 1;"
--      ต้องได้ ERROR: permission denied ถ้าอ่านได้แปลว่าด่านพัง ต้องหยุดใช้หน้าหลังบ้านทันที
--    psql -U tax_admin_readonly -d tax_advisor -c "SELECT * FROM v_report_summary LIMIT 5;"
--      ต้องอ่านได้ตามปกติ
