require("dotenv").config();

const express = require("express");
const Database = require("better-sqlite3");
const nodemailer = require("nodemailer");
const webpush = require("web-push");
const path = require("path");

const app = express();
const db = new Database("katenails.db");

app.use(express.json());
app.use(express.static("."));

db.exec(`
CREATE TABLE IF NOT EXISTS bookings(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  service TEXT,
  name TEXT,
  phone TEXT,
  instagram TEXT,
  date TEXT,
  time TEXT,
  comment TEXT,
  status TEXT DEFAULT 'pending',
  subscription TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS slot
ON bookings(service,date,time)
WHERE status!='cancelled';
`);

const slots = [
  "09:00","10:00","11:00","12:00",
  "13:00","14:00","15:00","16:00",
  "17:00","18:00","19:00"
];

const services = ["Маникюр","Стрижки"];

if (
  process.env.VAPID_PUBLIC_KEY &&
  process.env.VAPID_PRIVATE_KEY
) {
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT ||
      "mailto:labahkaterina79@gmail.com",
    process.env.VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY
  );
}

const admin = (q, s, n) =>
  q.headers["x-admin-key"] === process.env.ADMIN_KEY
    ? n()
    : s.status(401).json({ error: "Неверный ключ" });

async function email(text) {

  if (
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASS
  ) {
    return;
  }

  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.gmail.com",
    port: +(process.env.SMTP_PORT || 465),
    secure: process.env.SMTP_SECURE !== "false",
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    }
  });

  await transporter.sendMail({
    from: process.env.SMTP_USER,
    to:
      process.env.OWNER_EMAIL ||
      "labahkaterina79@gmail.com",
    subject: "KATENAILS — новая запись",
    text
  });
}

app.get("/api/config", (q, s) => {
  s.json({
    vapidPublicKey:
      process.env.VAPID_PUBLIC_KEY || ""
  });
});

app.get("/api/availability", (q, s) => {

  if (
    !services.includes(q.query.service) ||
    !q.query.date
  ) {
    return s.status(400).json({
      error: "Неверные параметры"
    });
  }

  const busy = new Set(
    db.prepare(`
      SELECT time
      FROM bookings
      WHERE service=?
      AND date=?
      AND status!='cancelled'
    `)
    .all(q.query.service, q.query.date)
    .map(x => x.time)
  );

  s.json({
    slots: slots.map(time => ({
      time,
      available: !busy.has(time)
    }))
  });
});

app.post("/api/bookings", async (q, s) => {

  const b = q.body || {};

  if (
    !services.includes(b.service) ||
    !b.name ||
    !b.phone ||
    !b.instagram ||
    !b.date ||
    !slots.includes(b.time)
  ) {
    return s.status(400).json({
      error: "Заполните обязательные поля"
    });
  }

  try {

    const r = db.prepare(`
      INSERT INTO bookings(
        service,
        name,
        phone,
        instagram,
        date,
        time,
        comment,
        subscription
      )
      VALUES(?,?,?,?,?,?,?,?)
    `).run(
      b.service,
      b.name.trim(),
      b.phone.trim(),
      b.instagram.trim(),
      b.date,
      b.time,
      (b.comment || "").trim(),
      b.subscription
        ? JSON.stringify(b.subscription)
        : null
    );

    await email(
`Новая запись KATENAILS

Услуга: ${b.service}
Клиент: ${b.name}
Телефон: ${b.phone}
Instagram: ${b.instagram}
Дата: ${b.date}
Время: ${b.time}
Комментарий: ${b.comment || "—"}

ID: ${r.lastInsertRowid}`
    );

    s.json({
      ok: true,
      status: "pending"
    });

  } catch (e) {

    s.status(
      String(e.message).includes("UNIQUE")
        ? 409
        : 500
    ).json({
      error:
        String(e.message).includes("UNIQUE")
          ? "Время уже занято"
          : "Ошибка сервера"
    });
  }
});

app.get(
  "/api/bookings",
  admin,
  (q, s) => {
    s.json(
      db.prepare(`
        SELECT *
        FROM bookings
        ORDER BY date,time,id DESC
      `).all()
    );
  }
);

app.post(
  "/api/admin/bookings",
  admin,
  async (q, s) => {

    const b = q.body || {};

    if (
      !services.includes(b.service) ||
      !b.name ||
      !b.phone ||
      !b.instagram ||
      !b.date ||
      !slots.includes(b.time)
    ) {
      return s.status(400).json({
        error: "Заполните обязательные поля"
      });
    }

    try {

      const r = db.prepare(`
        INSERT INTO bookings(
          service,
          name,
          phone,
          instagram,
          date,
          time,
          comment,
          status
        )
        VALUES(?,?,?,?,?,?,?,?)
      `).run(
        b.service,
        b.name.trim(),
        b.phone.trim(),
        b.instagram.trim(),
        b.date,
        b.time,
        (b.comment || "").trim(),
        "confirmed"
      );

      await email(
`KATENAILS — добавлена запись вручную

Услуга: ${b.service}
Клиент: ${b.name}
Телефон: ${b.phone}
Instagram: ${b.instagram}
Дата: ${b.date}
Время: ${b.time}
Комментарий: ${b.comment || "—"}

ID: ${r.lastInsertRowid}`
      );

      s.json({ ok: true });

    } catch (e) {

      s.status(
        String(e.message).includes("UNIQUE")
          ? 409
          : 500
      ).json({
        error:
          String(e.message).includes("UNIQUE")
            ? "Время уже занято"
            : "Ошибка сервера"
      });
    }
  }
);

app.patch(
  "/api/bookings/:id",
  admin,
  async (q, s) => {

    const b = db.prepare(
      "SELECT * FROM bookings WHERE id=?"
    ).get(+q.params.id);

    if (!b) {
      return s.status(404).json({
        error: "Запись не найдена"
      });
    }

    if (
      !["confirmed", "cancelled"]
        .includes(q.body.status)
    ) {
      return s.status(400).json({
        error: "Неверный статус"
      });
    }

    db.prepare(`
      UPDATE bookings
      SET status=?
      WHERE id=?
    `).run(
      q.body.status,
      b.id
    );

    if (
      b.subscription &&
      process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY
    ) {
      try {

        await webpush.sendNotification(
          JSON.parse(b.subscription),
          JSON.stringify({
            title:
              q.body.status === "confirmed"
                ? "KATENAILS — запись подтверждена"
                : "KATENAILS — запись отменена",
            body:
              `${b.service}: ${b.date} в ${b.time}`
          })
        );

      } catch (e) {}
    }

    s.json({ ok: true });
  }
);

app.get("*", (q, s) =>
  s.sendFile(
    path.join(__dirname, "index.html")
  )
);

app.listen(
  +(process.env.PORT || 3000),
  () => console.log("KATENAILS server started")
);
