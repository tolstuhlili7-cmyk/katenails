KATENAILS FINAL
Адрес: м. Біла Церква, вул. Водопійна, 25
Телефон: +380 68 518 56 02
Email владельца: labahkaterina79@gmail.com

Это серверная версия. Нужен Node.js-хостинг, а не статический ZIP.
Установка:
npm install
cp .env.example .env
npx web-push generate-vapid-keys
npm start

Настройте SMTP_USER/SMTP_PASS для email.
Настройте VAPID_PUBLIC_KEY/VAPID_PRIVATE_KEY для Push.
Админка: /admin.html
