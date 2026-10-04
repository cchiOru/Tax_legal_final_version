'use strict';
/**
 * การเชื่อมต่อฐานข้อมูลของหน้าหลังบ้าน
 * - ใช้บัญชี tax_admin_readonly เท่านั้น ซึ่งฐานข้อมูลห้ามอ่านตารางแชทไว้แล้ว (migration 005)
 *   เป็นด่านที่สอง กันกรณีโค้ดพลาดไปดึงข้อความแชท
 * - ใช้คำสั่ง SQL แบบมีพารามิเตอร์เสมอ ห้ามต่อสตริงจากข้อมูลผู้ใช้
 */

const { Client } = require('pg');

/** อ่านค่าตั้งค่าจากตัวแปรสภาพแวดล้อม ไม่มีค่าเริ่มต้นสำหรับรหัสผ่าน */
function ค่าตั้งค่า() {
  const ที่ต้องมี = ['ADMIN_DB_PASSWORD'];
  const ขาด = ที่ต้องมี.filter((k) => !process.env[k]);
  if (ขาด.length) {
    throw new Error(
      `ไม่พบตัวแปรที่จำเป็น: ${ขาด.join(', ')}\n` +
        'กำหนดค่าในไฟล์ .env ก่อนเปิดบริการหน้าหลังบ้าน'
    );
  }
  return {
    host: process.env.ADMIN_DB_HOST || 'postgres',
    port: Number(process.env.ADMIN_DB_PORT || 5432),
    database: process.env.APP_DB_NAME || 'tax_advisor',
    // ห้ามเปลี่ยนเป็นบัญชีที่มีสิทธิ์มากกว่านี้ ไม่งั้นด่านกันอ่านแชทจะหายไป
    user: 'tax_admin_readonly',
    password: process.env.ADMIN_DB_PASSWORD,
  };
}

let ตัวเชื่อม = null;

async function เชื่อมต่อ() {
  if (ตัวเชื่อม) return ตัวเชื่อม;
  ตัวเชื่อม = new Client(ค่าตั้งค่า());
  await ตัวเชื่อม.connect();

  // ตั้งเขตเวลาเป็นเวลาไทย เพราะฐานข้อมูลใช้ UTC
  // ไม่งั้น created_at::date และ current_date จะนับวันผิดช่วงเที่ยงคืนถึงเจ็ดโมงเช้า
  await ตัวเชื่อม.query("SET TIME ZONE 'Asia/Bangkok'");
  // ตัดการเชื่อมต่อทิ้งเมื่อฐานข้อมูลปิด แล้วให้สร้างใหม่ในครั้งถัดไป
  ตัวเชื่อม.on('error', () => {
    ตัวเชื่อม = null;
  });
  return ตัวเชื่อม;
}

/**
 * รันคำสั่ง SQL แบบมีพารามิเตอร์
 * @param {string} sql   คำสั่งที่เขียนไว้ในโค้ดเท่านั้น ห้ามประกอบจากข้อมูลผู้ใช้
 * @param {Array}  ค่า   ค่าที่จะแทนใน $1 $2 ...
 */
async function query(sql, ค่า = []) {
  const c = await เชื่อมต่อ();
  const ผล = await c.query(sql, ค่า);
  return ผล.rows;
}

/**
 * ตรวจตอนเปิดบริการว่าบัญชีนี้ยังอ่านตารางต้องห้ามไม่ได้จริง
 * ถ้าอ่านได้ (สิทธิ์ถูกแก้) ให้หยุดบริการทันที
 */
async function ตรวจว่าอ่านแชทไม่ได้จริง() {
  const ตารางต้องห้าม = ['conversations', 'n8n_chat_histories', 'users'];
  const รั่ว = [];
  for (const ตาราง of ตารางต้องห้าม) {
    try {
      // ชื่อตารางมาจากรายการในโค้ด ไม่ได้มาจากผู้ใช้
      await query(`SELECT 1 FROM ${ตาราง} LIMIT 1`);
      รั่ว.push(ตาราง);
    } catch (e) {
      // โดนปฏิเสธสิทธิ์ = ด่านทำงานถูกต้อง
      if (!/permission denied|ไม่มีสิทธิ/i.test(String(e.message))) {
        // ตารางไม่มีอยู่ก็ถือว่าอ่านไม่ได้ ผ่าน
        if (!/does not exist/i.test(String(e.message))) throw e;
      }
    }
  }
  if (รั่ว.length) {
    throw new Error(
      'บัญชีหน้าหลังบ้านอ่านตารางที่ต้องห้ามได้: ' +
        รั่ว.join(', ') +
        '\nหยุดบริการเพื่อไม่ให้ละเมิดข้อกำหนดที่ว่าผู้ดูแลต้องดูประวัติแชทไม่ได้' +
        '\nรัน postgres/migrations/005-add-admin-support.sql ใหม่เพื่อคืนสิทธิ์ให้ถูกต้อง'
    );
  }
}

async function ปิดการเชื่อมต่อ() {
  if (ตัวเชื่อม) {
    await ตัวเชื่อม.end().catch(() => {});
    ตัวเชื่อม = null;
  }
}

module.exports = { query, ตรวจว่าอ่านแชทไม่ได้จริง, ปิดการเชื่อมต่อ };
