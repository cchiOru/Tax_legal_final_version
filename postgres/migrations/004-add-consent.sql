-- Migration 004: เพิ่มสถานะความยินยอม PDPA ใน users (consent_status, consent_at, consent_version)
-- pending ยังไม่ตอบ (ยังไม่เก็บข้อความ) / granted ยินยอม (เก็บข้อความและใช้ความจำแชท)
-- denied ไม่ยินยอม (ยังตอบได้ปกติ แต่ไม่เก็บข้อความและไม่มีความจำ)

BEGIN;

-- ---- สถานะความยินยอม ----
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS consent_status  VARCHAR(16) NOT NULL DEFAULT 'pending',
    ADD COLUMN IF NOT EXISTS consent_at      TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS consent_version VARCHAR(16);

-- จำกัดค่าที่ใส่ได้ สถานะแปลกปลอมอาจทำให้เวิร์กโฟลว์เก็บข้อมูลคนที่ไม่ได้ยินยอม
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_consent_status_check'
    ) THEN
        ALTER TABLE users
            ADD CONSTRAINT users_consent_status_check
            CHECK (consent_status IN ('pending', 'granted', 'denied'));
    END IF;
END $$;

COMMENT ON COLUMN users.consent_status  IS 'pending ยังไม่ตอบ / granted ยินยอม / denied ไม่ยินยอม';
COMMENT ON COLUMN users.consent_at      IS 'เวลาที่ผู้ใช้กดตอบคำขอความยินยอม';
COMMENT ON COLUMN users.consent_version IS 'รุ่นของข้อความขอความยินยอมที่ผู้ใช้เห็นตอนกดตอบ';

CREATE INDEX IF NOT EXISTS idx_users_consent_status ON users (consent_status);

-- ผู้ใช้เดิมตั้งเป็น pending ห้ามเป็น granted เพราะยังไม่เคยถูกถาม ระบบจะถามเมื่อทักมาครั้งถัดไป
UPDATE users SET consent_status = 'pending' WHERE consent_status IS NULL;

COMMIT;

-- ตรวจผลหลังรัน
SELECT consent_status AS "สถานะความยินยอม", count(*) AS "จำนวนผู้ใช้"
FROM users GROUP BY consent_status ORDER BY 1;
