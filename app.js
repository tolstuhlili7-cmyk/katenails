const $ = x => document.getElementById(x);

let selected = "";
const d = $("date");

d.min = new Date().toISOString().slice(0, 10);
d.value = d.min;

async function times() {
  selected = "";

  const r = await fetch(
    `/api/availability?service=${encodeURIComponent($("service").value)}&date=${d.value}`
  );

  const j = await r.json();
  $("times").innerHTML = "";

  j.slots.forEach(x => {
    const b = document.createElement("button");

    b.type = "button";
    b.className = "time";
    b.textContent = x.time;
    b.disabled = !x.available;

    b.onclick = () => {
      document.querySelectorAll(".time").forEach(y =>
        y.classList.remove("selected")
      );

      b.classList.add("selected");
      selected = x.time;
    };

    $("times").appendChild(b);
  });
}

async function push() {
  try {
    const c = await (await fetch("/api/config")).json();

    if (!c.vapidPublicKey) return null;

    const r = await navigator.serviceWorker.register("/sw.js");

    if (await Notification.requestPermission() !== "granted") {
      return null;
    }

    let s = await r.pushManager.getSubscription();

    if (!s) {
      const raw = atob(
        c.vapidPublicKey
          .replace(/-/g, "+")
          .replace(/_/g, "/")
      );

      s = await r.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: Uint8Array.from(
          raw,
          x => x.charCodeAt(0)
        )
      });
    }

    return s.toJSON();

  } catch {
    return null;
  }
}

$("send").onclick = async () => {

  if (!selected) {
    $("msg").textContent = "Выберите время";
    return;
  }

  if (!$("name").value.trim() || !$("phone").value.trim()) {
    $("msg").textContent = "Введите имя и телефон";
    return;
  }

  const instagram = $("instagram").value.trim();

  if (!instagram) {
    $("msg").textContent = "Введите Instagram";
    return;
  }

  $("send").disabled = true;
  $("msg").textContent = "Отправляем заявку...";

  try {

    const r = await fetch("/api/bookings", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        service: $("service").value,
        date: d.value,
        time: selected,
        name: $("name").value.trim(),
        phone: $("phone").value.trim(),
        instagram: instagram,
        comment: $("comment").value.trim(),
        subscription: await push()
      })
    });

    const j = await r.json();

    if (r.ok) {
      $("msg").textContent =
        "Заявка отправлена! Ожидайте подтверждения.";

      $("name").value = "";
      $("phone").value = "";
      $("instagram").value = "";
      $("comment").value = "";

      await times();

    } else {
      $("msg").textContent = j.error || "Ошибка";
    }

  } catch {
    $("msg").textContent = "Ошибка соединения с сервером";
  }

  $("send").disabled = false;
};

d.onchange = times;
$("service").onchange = times;

times();
