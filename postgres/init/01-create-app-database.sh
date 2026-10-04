#!/bin/bash
# สร้างฐานข้อมูลแอป (APP_DB_NAME) แยกจากฐานข้อมูลภายในของ n8n (POSTGRES_DB)
# รันอัตโนมัติครั้งแรกที่สร้าง container postgres (volume ว่าง)
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    CREATE DATABASE "${APP_DB_NAME}";
EOSQL

echo "Created database '${APP_DB_NAME}'"
