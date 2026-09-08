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

/* =========================
   DATABASE
========================= */

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

CREATE TABLE IF NOT EXISTS closed_days(
  date TEXT PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS closed_slots(
  date TEXT,
  time TEXT,
  PRIMARY KEY(date,time)
);

CREATE UNIQUE INDEX IF NOT EXISTS slot
ON bookings(service,date,time)
WHERE status!='cancelled';
`);

/* =========================
   SETTINGS
========================= */

const slots = [
  "09:00",
  "10:00",
  "11:00",
  "12:00",
  "13:00",
  "14:00",
  "15:00",
  "16:00",
  "17:00"
];

const services = [
  "Маникюр",
  "Стрижки"
];

/* =========================
   PUSH
========================= */

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

/* =========================
   ADMIN
========================= */

const admin = (q,s,next) => {

  if (
    process.env.ADMIN_KEY &&
    q.headers["x-admin-key"] === process.env.ADMIN_KEY
  ) {
    return next();
  }

  return s.status(401).json({
    error: "Невірний ключ адміністратора"
  });
};

/* =========================
   EMAIL
========================= */

async function email(subject,text) {

  if (
    !process.env.SMTP_USER ||
    !process.env.SMTP_PASS
  ) {
    console.log("SMTP не налаштований");
    return;
  }

  const transporter =
    nodemailer.createTransport({
      host:
        process.env.SMTP_HOST ||
        "smtp.gmail.com",

      port:
        +(process.env.SMTP_PORT || 465),

      secure:
        process.env.SMTP_SECURE !== "false",

      auth:{
        user:process.env.SMTP_USER,
        pass:process.env.SMTP_PASS
      }
    });

  await transporter.sendMail({

    from:process.env.SMTP_USER,

    to:
      process.env.OWNER_EMAIL ||
      "labahkaterina79@gmail.com",

    subject,

    text
  });
}

/* =========================
   CONFIG
========================= */

app.get("/api/config",(q,s)=>{

  s.json({
    vapidPublicKey:
      process.env.VAPID_PUBLIC_KEY || ""
  });

});

/* =========================
   AVAILABILITY
========================= */

app.get("/api/availability",(q,s)=>{

  const service=q.query.service;
  const date=q.query.date;

  if(
    !services.includes(service) ||
    !date
  ){
    return s.status(400).json({
      error:"Невірні параметри"
    });
  }

  const closedDay =
    db.prepare(
      "SELECT date FROM closed_days WHERE date=?"
    ).get(date);

  if(closedDay){

    return s.json({
      slots:slots.map(time=>({
        time,
        available:false
      }))
    });

  }

  const closedSlots =
    new Set(
      db.prepare(
        "SELECT time FROM closed_slots WHERE date=?"
      )
      .all(date)
      .map(x=>x.time)
    );

  const bookings =
    db.prepare(`
      SELECT time
      FROM bookings
      WHERE service=?
      AND date=?
      AND status!='cancelled'
    `)
    .all(service,date);

  const busy=new Set();

  for(const booking of bookings){

    const index =
      slots.indexOf(booking.time);

    if(index>=0){

      busy.add(
        slots[index]
      );

      if(slots[index+1]){
        busy.add(
          slots[index+1]
        );
      }

    }

  }

  const result =
    slots.map(time=>{

      const index =
        slots.indexOf(time);

      const secondHour =
        slots[index+1];

      const available =
        !busy.has(time) &&
        !closedSlots.has(time) &&
        secondHour &&
        !closedSlots.has(secondHour) &&
        !busy.has(secondHour);

      return {
        time,
        available
      };

    });

  s.json({
    slots:result
  });

});

/* =========================
   CLIENT BOOKING
========================= */

app.post(
  "/api/bookings",
  async(q,s)=>{

    const b=q.body || {};

    if(
      !services.includes(b.service) ||
      !b.name ||
      !b.phone ||
      !b.instagram ||
      !b.date ||
      !slots.includes(b.time)
    ){

      return s.status(400).json({
        error:"Заповніть усі обов'язкові поля"
      });

    }

    const closedDay =
      db.prepare(
        "SELECT date FROM closed_days WHERE date=?"
      ).get(b.date);

    if(closedDay){

      return s.status(409).json({
        error:"Цей день закритий для запису"
      });

    }

    const index =
      slots.indexOf(b.time);

    const secondHour =
      slots[index+1];

    if(!secondHour){

      return s.status(400).json({
        error:"На цей час запис неможливий"
      });

    }

    const closed =
      db.prepare(`
        SELECT *
        FROM closed_slots
        WHERE date=?
        AND time IN (?,?)
      `)
      .all(
        b.date,
        b.time,
        secondHour
      );

    if(closed.length){

      return s.status(409).json({
        error:"Оберіть інший час"
      });

    }

    try{

      const busy =
        db.prepare(`
          SELECT time
          FROM bookings
          WHERE service=?
          AND date=?
          AND status!='cancelled'
          AND time IN (?,?)
        `)
        .all(
          b.service,
          b.date,
          b.time,
          secondHour
        );

      if(busy.length){

        return s.status(409).json({
          error:"Цей час уже зайнятий"
        });

      }

      const r =
        db.prepare(`
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
        `)
        .run(
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
        "KATENAILS — нова заявка",
`Нова заявка KATENAILS

Послуга: ${b.service}
Клієнт: ${b.name}
Телефон: ${b.phone}
Instagram: ${b.instagram}
Дата: ${b.date}
Час: ${b.time}
Тривалість: 2 години
Коментар: ${b.comment || "—"}

ID: ${r.lastInsertRowid}`
      );

      s.json({
        ok:true,
        status:"pending"
      });

    }catch(e){

      s.status(
        String(e.message).includes("UNIQUE")
          ? 409
          : 500
      ).json({
        error:
          String(e.message).includes("UNIQUE")
            ? "Цей час уже зайнятий"
            : "Помилка сервера"
      });

    }

  }
);

/* =========================
   GET BOOKINGS
========================= */

app.get(
  "/api/bookings",
  admin,
  (q,s)=>{

    s.json(
      db.prepare(`
        SELECT *
        FROM bookings
        ORDER BY date,time,id DESC
      `).all()
    );

  }
);

/* =========================
   MANUAL BOOKING
========================= */

app.post(
  "/api/admin/bookings",
  admin,
  async(q,s)=>{

    const b=q.body || {};

    if(
      !services.includes(b.service) ||
      !b.name ||
      !b.phone ||
      !b.instagram ||
      !b.date ||
      !slots.includes(b.time)
    ){

      return s.status(400).json({
        error:"Заповніть усі обов'язкові поля"
      });

    }

    const index =
      slots.indexOf(b.time);

    const secondHour =
      slots[index+1];

    if(!secondHour){

      return s.status(400).json({
        error:"На цей час запис неможливий"
      });

    }

    const closedDay =
      db.prepare(
        "SELECT date FROM closed_days WHERE date=?"
      ).get(b.date);

    if(closedDay){

      return s.status(409).json({
        error:"Цей день закритий"
      });

    }

    try{

      const busy =
        db.prepare(`
          SELECT time
          FROM bookings
          WHERE service=?
          AND date=?
          AND status!='cancelled'
          AND time IN (?,?)
        `)
        .all(
          b.service,
          b.date,
          b.time,
          secondHour
        );

      if(busy.length){

        return s.status(409).json({
          error:"Цей час уже зайнятий"
        });

      }

      const closed =
        db.prepare(`
          SELECT *
          FROM closed_slots
          WHERE date=?
          AND time IN (?,?)
        `)
        .all(
          b.date,
          b.time,
          secondHour
        );

      if(closed.length){

        return s.status(409).json({
          error:"Цей час закритий"
        });

      }

      const r =
        db.prepare(`
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
        `)
        .run(
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
        "KATENAILS — ручний запис",
`Додано ручний запис

Послуга: ${b.service}
Клієнт: ${b.name}
Телефон: ${b.phone}
Instagram: ${b.instagram}
Дата: ${b.date}
Час: ${b.time}
Тривалість: 2 години
Коментар: ${b.comment || "—"}

ID: ${r.lastInsertRowid}`
      );

      s.json({
        ok:true
      });

    }catch(e){

      s.status(500).json({
        error:"Помилка сервера"
      });

    }

  }
);

/* =========================
   CONFIRM / CANCEL
========================= */

app.patch(
  "/api/bookings/:id",
  admin,
  async(q,s)=>{

    const b =
      db.prepare(
        "SELECT * FROM bookings WHERE id=?"
      ).get(+q.params.id);

    if(!b){

      return s.status(404).json({
        error:"Запис не знайдено"
      });

    }

    if(
      !["confirmed","cancelled"]
      .includes(q.body.status)
    ){

      return s.status(400).json({
        error:"Невірний статус"
      });

    }

    db.prepare(`
      UPDATE bookings
      SET status=?
      WHERE id=?
    `)
    .run(
      q.body.status,
      b.id
    );

    if(
      b.subscription &&
      process.env.VAPID_PUBLIC_KEY &&
      process.env.VAPID_PRIVATE_KEY
    ){

      try{

        await webpush.sendNotification(
          JSON.parse(b.subscription),
          JSON.stringify({

            title:
              q.body.status === "confirmed"
                ? "KATENAILS — запис підтверджено"
                : "KATENAILS — запис скасовано",

            body:
              `${b.service}: ${b.date} о ${b.time}`

          })
        );

      }catch(e){

        console.log(
          "Push не доставлено"
        );

      }

    }

    s.json({
      ok:true,
      status:q.body.status
    });

  }
);

/* =========================
   CLOSED DAYS
========================= */

app.get(
  "/api/admin/closed-days",
  admin,
  (q,s)=>{

    s.json(
      db.prepare(
        "SELECT date FROM closed_days ORDER BY date"
      ).all()
    );

  }
);

app.post(
  "/api/admin/closed-days",
  admin,
  (q,s)=>{

    if(!q.body.date){

      return s.status(400).json({
        error:"Вкажіть дату"
      });

    }

    db.prepare(`
      INSERT OR IGNORE INTO closed_days(date)
      VALUES(?)
    `).run(q.body.date);

    s.json({
      ok:true
    });

  }
);

app.delete(
  "/api/admin/closed-days/:date",
  admin,
  (q,s)=>{

    db.prepare(
      "DELETE FROM closed_days WHERE date=?"
    ).run(q.params.date);

    s.json({
      ok:true
    });

  }
);

/* =========================
   CLOSED HOURS
========================= */

app.get(
  "/api/admin/closed-slots",
  admin,
  (q,s)=>{

    s.json(
      db.prepare(`
        SELECT date,time
        FROM closed_slots
        ORDER BY date,time
      `).all()
    );

  }
);

app.post(
  "/api/admin/closed-slots",
  admin,
  (q,s)=>{

    if(
      !q.body.date ||
      !slots.includes(q.body.time)
    ){

      return s.status(400).json({
        error:"Вкажіть дату та час"
      });

    }

    db.prepare(`
      INSERT OR IGNORE INTO closed_slots(date,time)
      VALUES(?,?)
    `)
    .run(
      q.body.date,
      q.body.time
    );

    s.json({
      ok:true
    });

  }
);

app.delete(
  "/api/admin/closed-slots/:date/:time",
  admin,
  (q,s)=>{

    db.prepare(`
      DELETE FROM closed_slots
      WHERE date=? AND time=?
    `)
    .run(
      q.params.date,
      q.params.time
    );

    s.json({
      ok:true
    });

  }
);

/* =========================
   SITE
========================= */

app.get("*",(q,s)=>
  s.sendFile(
    path.join(
      __dirname,
      "index.html"
    )
  )
);

/* =========================
   START
========================= */

app.listen(
  +(process.env.PORT || 3000),
  ()=>{
    console.log(
      "KATENAILS server started"
    );
  }
);
