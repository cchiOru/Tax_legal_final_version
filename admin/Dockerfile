# หน้าเว็บหลังบ้านสำหรับผู้ดูแลระบบ
# ตรึงเวอร์ชันอิมเมจและไลบรารีไว้ เพื่อให้ build ซ้ำได้ผลเหมือนเดิม
FROM node:20.18-alpine

WORKDIR /app

# คัดลอก package.json ก่อน เพื่อให้ใช้ cache ชั้นติดตั้งไลบรารีซ้ำได้
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund

COPY . .

# รันด้วยผู้ใช้ที่ไม่ใช่ root เพื่อจำกัดความเสียหายถ้ามีช่องโหว่
USER node

EXPOSE 8080
CMD ["node", "server.js"]
