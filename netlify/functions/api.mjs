// ============================================================
//  БЕКЕНД фан-сайту Nickelodeon (Netlify Function)
//  Цей файл Netlify запускає автоматично, коли браузер
//  звертається на адресу /api/...
//  Дані зберігаються в Netlify Blobs — простому сховищі
//  «ключ → значення», яке входить у безкоштовний план Netlify.
// ============================================================

import { getStore } from "@netlify/blobs";
import bcrypt from "bcryptjs";

// Дозволені мультсеріали
const SHOWS = ["spongebob", "tmnt", "fairly", "loud"];

// Допоміжна функція: відповісти у форматі JSON
function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}

// Хто робить запит? Шукаємо токен у заголовку Authorization
async function getUser(req, sessions, users) {
  const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
  if (!token) return null;
  const session = await sessions.get(token, { type: "json" });
  if (!session) return null;
  return await users.get(session.username.toLowerCase(), { type: "json" });
}

async function createSession(sessions, username) {
  const token = crypto.randomUUID() + crypto.randomUUID();
  await sessions.setJSON(token, { username, createdAt: new Date().toISOString() });
  return token;
}

async function readBody(req) {
  try { return await req.json(); } catch { return {}; }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default async (req) => {
  // Три окремі "шухляди" для даних
  const users = getStore("users");
  const sessions = getStore("sessions");
  const comments = getStore("comments");
  const emails = getStore("emails");   // пошта → логін
  const resets = getStore("resets");   // токени відновлення пароля
  const requests = getStore("requests"); // запити "Забули пароль?" для адміна

  const url = new URL(req.url);
  // "/api/comments/tmnt" → ["comments", "tmnt"]
  const parts = url.pathname.replace(/^\/api\/?/, "").split("/").filter(Boolean);
  const [route, param] = parts;
  const method = req.method;

  try {
    // ---------- Реєстрація ----------
    if (route === "register" && method === "POST") {
      const body = await readBody(req);
      const username = String(body.username || "").trim();
      const email = String(body.email || "").trim().toLowerCase();
      const password = String(body.password || "");

      if (!/^[\p{L}\p{N}_.-]{3,20}$/u.test(username)) {
        return json({ error: "Ім'я: 3–20 символів (літери, цифри, _ . -)" }, 400);
      }
      if (!EMAIL_RE.test(email)) {
        return json({ error: "Введіть правильну адресу пошти" }, 400);
      }
      if (password.length < 6) {
        return json({ error: "Пароль має бути щонайменше 6 символів" }, 400);
      }
      const key = username.toLowerCase();
      if (await users.get(key)) {
        return json({ error: "Таке ім'я вже зайняте" }, 409);
      }
      if (await emails.get(email)) {
        return json({ error: "Ця пошта вже використовується" }, 409);
      }
      // НІКОЛИ не зберігайте пароль у відкритому вигляді — лише хеш!
      await users.setJSON(key, {
        username,
        email,
        passwordHash: bcrypt.hashSync(password, 10),
        createdAt: new Date().toISOString(),
      });
      // Окрема "шухляда": пошта → логін (щоб знаходити користувача за поштою)
      await emails.setJSON(email, { username });
      const token = await createSession(sessions, username);
      return json({ token, username });
    }

    // ---------- Вхід (за логіном АБО поштою) ----------
    if (route === "login" && method === "POST") {
      const body = await readBody(req);
      const login = String(body.username || "").trim().toLowerCase();
      const password = String(body.password || "");

      let user = null;
      if (login.includes("@")) {
        const link = await emails.get(login, { type: "json" });
        if (link) user = await users.get(link.username.toLowerCase(), { type: "json" });
      } else {
        user = await users.get(login, { type: "json" });
      }

      if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
        return json({ error: "Неправильний логін або пароль" }, 401);
      }
      const token = await createSession(sessions, user.username);
      return json({ token, username: user.username });
    }

    // ---------- Забули пароль: запит адміністратору ----------
    if (route === "forgot" && method === "POST") {
      const body = await readBody(req);
      const email = String(body.email || "").trim().toLowerCase();
      const link = EMAIL_RE.test(email) ? await emails.get(email, { type: "json" }) : null;

      if (link) {
        // Зберігаємо запит — адміністратор побачить його в адмін-панелі
        await requests.setJSON(link.username.toLowerCase(), {
          username: link.username,
          email,
          requestedAt: new Date().toISOString(),
        });
      }
      // Відповідаємо однаково, навіть якщо такої пошти немає,
      // щоб сторонні не могли перевіряти, хто зареєстрований на сайті.
      return json({ ok: true });
    }

    // ---------- Новий пароль за посиланням з листа ----------
    if (route === "reset" && method === "POST") {
      const body = await readBody(req);
      const resetToken = String(body.token || "");
      const password = String(body.password || "");
      const reset = resetToken ? await resets.get(resetToken, { type: "json" }) : null;

      if (!reset || reset.expires < Date.now()) {
        if (reset) await resets.delete(resetToken);
        return json({ error: "Посилання недійсне або застаріло. Запросіть нове." }, 400);
      }
      if (password.length < 6) {
        return json({ error: "Пароль має бути щонайменше 6 символів" }, 400);
      }
      const key = reset.username.toLowerCase();
      const user = await users.get(key, { type: "json" });
      if (!user) return json({ error: "Користувача не знайдено" }, 404);

      user.passwordHash = bcrypt.hashSync(password, 10);
      await users.setJSON(key, user);
      await resets.delete(resetToken); // посилання одноразове
      const token = await createSession(sessions, user.username);
      return json({ token, username: user.username });
    }

    // ---------- Хто я? ----------
    if (route === "me" && method === "GET") {
      const user = await getUser(req, sessions, users);
      if (!user) return json({ error: "Не авторизовано" }, 401);
      return json({ username: user.username });
    }

    // ---------- Вихід ----------
    if (route === "logout" && method === "POST") {
      const token = (req.headers.get("authorization") || "").replace("Bearer ", "");
      if (token) await sessions.delete(token);
      return json({ ok: true });
    }

    // ---------- Коментарі ----------
    if (route === "comments" && SHOWS.includes(param)) {
      const list = (await comments.get(param, { type: "json" })) || [];

      // Отримати всі коментарі (нові — зверху)
      if (method === "GET") {
        return json(list);
      }

      const user = await getUser(req, sessions, users);
      if (!user) return json({ error: "Потрібно увійти в акаунт" }, 401);

      // Додати коментар
      if (method === "POST") {
        const body = await readBody(req);
        const text = String(body.text || "").trim();
        if (!text) return json({ error: "Коментар порожній" }, 400);
        if (text.length > 500) return json({ error: "Максимум 500 символів" }, 400);

        const comment = {
          id: crypto.randomUUID(),
          username: user.username,
          text,
          createdAt: new Date().toISOString(),
        };
        list.unshift(comment);
        await comments.setJSON(param, list);
        return json(comment);
      }

      // Видалити свій коментар:  DELETE /api/comments/<show>?id=...
      if (method === "DELETE") {
        const id = url.searchParams.get("id");
        const comment = list.find((c) => c.id === id);
        if (!comment) return json({ error: "Коментар не знайдено" }, 404);
        if (comment.username !== user.username) {
          return json({ error: "Можна видаляти лише власні коментарі" }, 403);
        }
        await comments.setJSON(param, list.filter((c) => c.id !== id));
        return json({ ok: true });
      }
    }

    // ---------- АДМІН-ПАНЕЛЬ ----------
    // Пароль адміністратора НЕ пишеться в коді (бо код публічний на GitHub),
    // а задається в налаштуваннях Netlify як змінна ADMIN_PASSWORD.
    if (route === "admin") {
      const adminPassword = process.env.ADMIN_PASSWORD;
      if (!adminPassword) {
        return json({ error: "ADMIN_PASSWORD не налаштовано в Netlify" }, 500);
      }
      if (req.headers.get("x-admin-password") !== adminPassword) {
        return json({ error: "Неправильний пароль адміністратора" }, 401);
      }

      // Список усіх користувачів (без паролів!)
      if (param === "users" && method === "GET") {
        const { blobs } = await users.list();
        const all = await Promise.all(blobs.map((b) => users.get(b.key, { type: "json" })));

        // Рахуємо коментарі кожного користувача
        const counts = {};
        for (const show of SHOWS) {
          const list = (await comments.get(show, { type: "json" })) || [];
          list.forEach((c) => { counts[c.username] = (counts[c.username] || 0) + 1; });
        }

        const result = all
          .filter(Boolean)
          .map((u) => ({ username: u.username, email: u.email || "—", createdAt: u.createdAt, comments: counts[u.username] || 0 }))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        return json(result);
      }

      // Список запитів "Забули пароль?"
      if (param === "requests" && method === "GET") {
        const { blobs } = await requests.list();
        const all = await Promise.all(blobs.map((b) => requests.get(b.key, { type: "json" })));
        return json(all.filter(Boolean).sort((a, b) => b.requestedAt.localeCompare(a.requestedAt)));
      }

      // Відхилити (прибрати) запит:  DELETE /api/admin/requests?username=...
      if (param === "requests" && method === "DELETE") {
        await requests.delete((url.searchParams.get("username") || "").toLowerCase());
        return json({ ok: true });
      }

      // Створити одноразове посилання для зміни пароля:  POST /api/admin/reset-link?username=...
      if (param === "reset-link" && method === "POST") {
        const key = (url.searchParams.get("username") || "").toLowerCase();
        const user = await users.get(key, { type: "json" });
        if (!user) return json({ error: "Користувача не знайдено" }, 404);

        const resetToken = crypto.randomUUID() + crypto.randomUUID();
        await resets.setJSON(resetToken, {
          username: user.username,
          expires: Date.now() + 24 * 60 * 60 * 1000, // посилання діє 24 години
        });
        await requests.delete(key); // запит виконано
        return json({ link: `${url.origin}/#reset=${resetToken}`, email: user.email || "", username: user.username });
      }

      // Видалити користувача разом з його коментарями:  DELETE /api/admin/users?username=...
      if (param === "users" && method === "DELETE") {
        const username = url.searchParams.get("username") || "";
        const deleted = await users.get(username.toLowerCase(), { type: "json" });
        if (deleted?.email) await emails.delete(deleted.email);
        await requests.delete(username.toLowerCase());
        await users.delete(username.toLowerCase());
        for (const show of SHOWS) {
          const list = (await comments.get(show, { type: "json" })) || [];
          const filtered = list.filter((c) => c.username !== username);
          if (filtered.length !== list.length) await comments.setJSON(show, filtered);
        }
        return json({ ok: true });
      }
    }

    return json({ error: "Не знайдено" }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: "Помилка сервера" }, 500);
  }
};

// Ця функція відповідає на всі адреси, що починаються з /api/
export const config = { path: "/api/*" };
