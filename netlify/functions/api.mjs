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

export default async (req) => {
  // Три окремі "шухляди" для даних
  const users = getStore("users");
  const sessions = getStore("sessions");
  const comments = getStore("comments");

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
      const password = String(body.password || "");

      if (!/^[\p{L}\p{N}_.-]{3,20}$/u.test(username)) {
        return json({ error: "Ім'я: 3–20 символів (літери, цифри, _ . -)" }, 400);
      }
      if (password.length < 6) {
        return json({ error: "Пароль має бути щонайменше 6 символів" }, 400);
      }
      const key = username.toLowerCase();
      if (await users.get(key)) {
        return json({ error: "Таке ім'я вже зайняте" }, 409);
      }
      // НІКОЛИ не зберігайте пароль у відкритому вигляді — лише хеш!
      await users.setJSON(key, {
        username,
        passwordHash: bcrypt.hashSync(password, 10),
        createdAt: new Date().toISOString(),
      });
      const token = await createSession(sessions, username);
      return json({ token, username });
    }

    // ---------- Вхід ----------
    if (route === "login" && method === "POST") {
      const body = await readBody(req);
      const username = String(body.username || "").trim();
      const password = String(body.password || "");
      const user = await users.get(username.toLowerCase(), { type: "json" });

      if (!user || !bcrypt.compareSync(password, user.passwordHash)) {
        return json({ error: "Неправильне ім'я або пароль" }, 401);
      }
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

    return json({ error: "Не знайдено" }, 404);
  } catch (err) {
    console.error(err);
    return json({ error: "Помилка сервера" }, 500);
  }
};

// Ця функція відповідає на всі адреси, що починаються з /api/
export const config = { path: "/api/*" };
