-- Migration 008: ถามความพึงพอใจเป็นครั้งคราวแทนทุกคำตอบ โดยนับคำตอบรายคนแล้วถามเมื่อครบรอบที่สุ่ม 10-30
-- (นับรอบแทนสุ่มล้วน เพื่อไม่ให้ขึ้นติดกันหรือไม่ขึ้นเลย) ผู้ใช้ใหม่จะถูกถามในคำตอบแรกเสมอ เพื่อให้รู้ว่ามีปุ่ม
-- ตัวนับอยู่ใน users ไม่ได้เพิ่มการเก็บข้อความ และ answer_feedback ยังไม่ระบุตัวผู้ใช้

BEGIN;

-- ---- ตัวนับและรอบของแต่ละคน ----
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS msgs_since_feedback INTEGER NOT NULL DEFAULT 0;

-- รอบสุ่มตอนสร้างแถว: 10 + floor(random() * 21) ได้ 10 ถึง 30
ALTER TABLE users
    ADD COLUMN IF NOT EXISTS feedback_after INTEGER NOT NULL
    DEFAULT (10 + floor(random() * 21)::int);

COMMENT ON COLUMN users.msgs_since_feedback IS
  'จำนวนคำตอบที่ผ่านไปนับจากครั้งล่าสุดที่ถามความเห็น';
COMMENT ON COLUMN users.feedback_after IS
  'ครบกี่คำตอบจึงจะถามความเห็นอีกครั้ง สุ่มใหม่ทุกครั้งที่ถาม ช่วง 10 ถึง 30';

-- ผู้ใช้เดิม: ตั้งตัวนับให้ครบรอบ จะได้ถูกถามในคำตอบถัดไปหนึ่งครั้ง (ถ้าเป็น 0 จะไม่เห็นปุ่มอีก 10-30 ข้อ)
UPDATE users SET msgs_since_feedback = feedback_after;

COMMIT;


-- ---- ตรวจผล ----

SELECT id, display_name, msgs_since_feedback, feedback_after,
       (msgs_since_feedback >= feedback_after) AS จะถูกถามในข้อถัดไป
FROM users
ORDER BY id;


-- ---- บังคับให้ปุ่มขึ้นในคำตอบถัดไป (ใช้ตอนสาธิต) ----
--  UPDATE users SET msgs_since_feedback = feedback_after
--  WHERE line_user_id = 'ใส่รหัสผู้ใช้ LINE ของเครื่องที่ใช้สาธิต';
--  หารหัส (แถวที่ updated_at ใหม่สุด):
--  SELECT line_user_id, display_name, updated_at FROM users ORDER BY updated_at DESC LIMIT 5;


-- ---- ย้อนกลับ (แล้วนำเข้าเวิร์กโฟลว์รุ่นก่อนที่ถามทุกคำตอบ) ----
--  ALTER TABLE users DROP COLUMN IF EXISTS msgs_since_feedback;
--  ALTER TABLE users DROP COLUMN IF EXISTS feedback_after;
