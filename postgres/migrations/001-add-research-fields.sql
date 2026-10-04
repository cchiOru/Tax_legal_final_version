-- Migration 001: เพิ่มคอลัมน์ข้อมูลวิจัยใน conversations (เวลาตอบ, ความรู้ที่ค้นเจอ, ชื่อโมเดล)
-- พร้อมตาราง tax_law_knowledge, n8n_chat_histories และ view สถิติ ถ้ายังไม่มี
-- ใช้กับฐานที่มีข้อมูลอยู่แล้วได้ (ไม่ต้อง reset) และรันซ้ำได้

BEGIN;

-- ---- 1) คอลัมน์ข้อมูลวิจัยใน conversations ----
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS response_time_ms  INTEGER;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS matched_knowledge TEXT;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS knowledge_hits    INTEGER;
ALTER TABLE conversations ADD COLUMN IF NOT EXISTS model_name        VARCHAR(50);

COMMENT ON COLUMN conversations.response_time_ms  IS 'เวลาตอบสนองของระบบตั้งแต่รับข้อความจนสร้างคำตอบเสร็จ (มิลลิวินาที) ใช้ในการทดสอบประสิทธิภาพ';
COMMENT ON COLUMN conversations.matched_knowledge IS 'ชื่อหัวข้อความรู้ที่ระบบค้นเจอและใช้ประกอบการตอบ ใช้วิเคราะห์คุณภาพการสืบค้น';
COMMENT ON COLUMN conversations.knowledge_hits    IS 'จำนวนรายการความรู้ที่ค้นเจอ ใช้คำนวณอัตราการสืบค้นสำเร็จ (retrieval hit rate)';
COMMENT ON COLUMN conversations.model_name        IS 'ชื่อแบบจำลองภาษาที่ใช้สร้างคำตอบ ใช้เปรียบเทียบผลระหว่างเวอร์ชัน';

-- ---- 2) ตารางฐานความรู้กฎหมาย (เผื่อฐานที่ติดตั้งก่อนมีตารางนี้) ----
CREATE TABLE IF NOT EXISTS tax_law_knowledge (
    id          SERIAL PRIMARY KEY,
    category    VARCHAR(100),
    title       TEXT,
    content     TEXT,
    source      VARCHAR(200),
    tax_year    INTEGER DEFAULT 2567,
    created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tax_law_knowledge_fts
    ON tax_law_knowledge USING GIN (
        to_tsvector('simple', coalesce(category,'') || ' ' || coalesce(title,'') || ' ' || coalesce(content,''))
    );

-- ---- 3) หน่วยความจำแชทของ n8n (n8n สร้างเองได้ แต่ประกาศไว้ให้ติดตั้งซ้ำได้) ----
CREATE TABLE IF NOT EXISTS n8n_chat_histories (
    id         SERIAL PRIMARY KEY,
    session_id VARCHAR(255) NOT NULL,
    message    JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_n8n_chat_histories_session ON n8n_chat_histories (session_id);

-- ---- 4) view สถิติสำหรับวิเคราะห์ผล ----

-- 4.1 สถิติเวลาตอบสนอง
CREATE OR REPLACE VIEW v_response_time_stats AS
SELECT
    COUNT(*)                                                              AS จำนวนคำตอบ,
    ROUND(AVG(response_time_ms)::numeric, 2)                              AS เฉลี่ย_ms,
    ROUND(STDDEV_SAMP(response_time_ms)::numeric, 2)                      AS ส่วนเบี่ยงเบนมาตรฐาน_ms,
    MIN(response_time_ms)                                                 AS ต่ำสุด_ms,
    MAX(response_time_ms)                                                 AS สูงสุด_ms,
    ROUND(PERCENTILE_CONT(0.5)  WITHIN GROUP (ORDER BY response_time_ms)::numeric, 2) AS มัธยฐาน_ms,
    ROUND(PERCENTILE_CONT(0.95) WITHIN GROUP (ORDER BY response_time_ms)::numeric, 2) AS เปอร์เซ็นไทล์ที่95_ms
FROM conversations
WHERE role = 'assistant' AND response_time_ms IS NOT NULL;

-- 4.2 อัตราค้นเจอ (retrieval hit rate)
CREATE OR REPLACE VIEW v_retrieval_stats AS
SELECT
    COUNT(*)                                                                       AS จำนวนคำถามทั้งหมด,
    COUNT(*) FILTER (WHERE knowledge_hits > 0)                                     AS ค้นเจอข้อมูลอ้างอิง,
    ROUND(100.0 * COUNT(*) FILTER (WHERE knowledge_hits > 0) / NULLIF(COUNT(*), 0), 2) AS อัตราค้นเจอ_ร้อยละ
FROM conversations
WHERE role = 'assistant';

-- 4.3 ปริมาณการใช้งานรายวัน
CREATE OR REPLACE VIEW v_daily_usage AS
SELECT
    DATE(created_at AT TIME ZONE 'Asia/Bangkok') AS วันที่,
    COUNT(*) FILTER (WHERE role = 'user')        AS จำนวนคำถาม,
    COUNT(DISTINCT user_id)                      AS จำนวนผู้ใช้,
    ROUND(AVG(response_time_ms) FILTER (WHERE role = 'assistant')::numeric, 2) AS เวลาตอบสนองเฉลี่ย_ms
FROM conversations
GROUP BY 1
ORDER BY 1 DESC;

COMMIT;

-- ตรวจผล
SELECT column_name, data_type
FROM information_schema.columns
WHERE table_name = 'conversations'
ORDER BY ordinal_position;
