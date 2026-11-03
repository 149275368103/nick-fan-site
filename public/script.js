// ============================================================
//  ФРОНТЕНД: перемикання сторінок, вхід/реєстрація, коментарі
// ============================================================

const API = "/api";
let token = localStorage.getItem("token");   // збережений вхід
let currentUser = null;
let authMode = "login";                       // "login" або "register"

// ---------- Запити до бекенду ----------
async function api(path, options = {}) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = "Bearer " + token;
  const res = await fetch(API + path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || "Сервер недоступний");
  return data;
}

// ============================================================
//  1. ПЕРЕМИКАННЯ СТОРІНОК (односторінковий сайт)
// ============================================================
const pages = document.querySelectorAll(".page");
const blocks = document.querySelectorAll(".show-block");

function showPage() {
  const id = location.hash.slice(1) || "home";
  const target = document.getElementById(id) || document.getElementById("home");

  pages.forEach((p) => p.classList.toggle("hidden", p !== target));
  blocks.forEach((b) => b.classList.toggle("active", b.getAttribute("href") === "#" + target.id));
  window.scrollTo({ top: 0, behavior: "smooth" });

  // Якщо це сторінка мультсеріалу — завантажити коментарі
  if (target.dataset.show) loadComments(target);
}
window.addEventListener("hashchange", showPage);

// ============================================================
//  2. ВХІД ТА РЕЄСТРАЦІЯ
// ============================================================
const modal = document.getElementById("authModal");
const authForm = document.getElementById("authForm");
const authError = document.getElementById("authError");
const authSubmit = document.getElementById("authSubmit");

function openAuth() {
  modal.classList.remove("hidden");
  authError.textContent = "";
  authForm.username.focus();
}
function closeAuth() {
  modal.classList.add("hidden");
  authForm.reset();
}

document.getElementById("authBtn").addEventListener("click", openAuth);
modal.querySelector(".modal-close").addEventListener("click", closeAuth);
modal.addEventListener("click", (e) => { if (e.target === modal) closeAuth(); });
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAuth(); });

// Вкладки "Увійти / Зареєструватись"
document.querySelectorAll(".tab").forEach((tab) => {
  tab.addEventListener("click", () => {
    authMode = tab.dataset.mode;
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
    authSubmit.textContent = authMode === "login" ? "Увійти" : "Зареєструватись";
    authForm.password.autocomplete = authMode === "login" ? "current-password" : "new-password";
    authError.textContent = "";
  });
});

authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  authError.textContent = "";
  authSubmit.disabled = true;
  try {
    const data = await api("/" + authMode, {
      method: "POST",
      body: JSON.stringify({
        username: authForm.username.value,
        password: authForm.password.value,
      }),
    });
    token = data.token;
    localStorage.setItem("token", token);
    setUser(data.username);
    closeAuth();
  } catch (err) {
    authError.textContent = err.message;
  } finally {
    authSubmit.disabled = false;
  }
});

document.getElementById("logoutBtn").addEventListener("click", async () => {
  try { await api("/logout", { method: "POST" }); } catch {}
  token = null;
  localStorage.removeItem("token");
  setUser(null);
});

function setUser(username) {
  currentUser = username;
  document.getElementById("authBtn").classList.toggle("hidden", !!username);
  document.getElementById("userBox").classList.toggle("hidden", !username);
  document.getElementById("userName").textContent = username || "";
  // Оновити відкриту сторінку мультсеріалу (показати/сховати форму)
  const open = document.querySelector(".page:not(.hidden)[data-show]");
  if (open) loadComments(open);
}

// Перевірити, чи користувач уже входив раніше
async function checkLogin() {
  if (!token) return setUser(null);
  try {
    const data = await api("/me");
    setUser(data.username);
  } catch {
    token = null;
    localStorage.removeItem("token");
    setUser(null);
  }
}

// ============================================================
//  3. КОМЕНТАРІ
// ============================================================
const template = document.getElementById("commentsTemplate");

// Вставляємо блок коментарів у кожну сторінку мультсеріалу
document.querySelectorAll(".comments-slot").forEach((slot) => {
  const box = template.content.cloneNode(true);
  slot.appendChild(box);

  const show = slot.closest(".page").dataset.show;
  const form = slot.querySelector(".comment-form");
  const textarea = form.querySelector("textarea");
  const chars = form.querySelector(".chars");

  textarea.addEventListener("input", () => {
    chars.textContent = textarea.value.length + " / 500";
  });

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = form.querySelector("button");
    btn.disabled = true;
    try {
      await api("/comments/" + show, {
        method: "POST",
        body: JSON.stringify({ text: textarea.value }),
      });
      textarea.value = "";
      chars.textContent = "0 / 500";
      loadComments(slot.closest(".page"));
    } catch (err) {
      alert(err.message);
    } finally {
      btn.disabled = false;
    }
  });

  slot.querySelector(".open-auth").addEventListener("click", (e) => {
    e.preventDefault();
    openAuth();
  });
});

async function loadComments(page) {
  const show = page.dataset.show;
  const list = page.querySelector(".comment-list");
  const count = page.querySelector(".count");

  page.querySelector(".comment-form").classList.toggle("hidden", !currentUser);
  page.querySelector(".login-hint").classList.toggle("hidden", !!currentUser);

  try {
    const comments = await api("/comments/" + show);
    count.textContent = "(" + comments.length + ")";
    list.innerHTML = "";

    if (comments.length === 0) {
      list.innerHTML = '<li class="empty">Поки що немає коментарів. Будьте першим! 🎉</li>';
      return;
    }

    comments.forEach((c) => list.appendChild(renderComment(c, page)));
  } catch (err) {
    list.innerHTML = '<li class="empty">Не вдалося завантажити коментарі: ' + err.message + "</li>";
  }
}

function renderComment(c, page) {
  const li = document.createElement("li");
  li.className = "comment";

  const head = document.createElement("div");
  head.className = "comment-head";

  const avatar = document.createElement("span");
  avatar.className = "avatar";
  avatar.textContent = c.username[0].toUpperCase();

  const name = document.createElement("b");
  name.textContent = c.username;

  const date = document.createElement("span");
  date.className = "comment-date";
  date.textContent = new Date(c.createdAt).toLocaleString("uk-UA");

  head.append(avatar, name, date);

  // Кнопка "Видалити" — лише для власних коментарів
  if (currentUser && currentUser === c.username) {
    const del = document.createElement("button");
    del.className = "comment-del";
    del.textContent = "Видалити";
    del.addEventListener("click", async () => {
      if (!confirm("Видалити коментар?")) return;
      try {
        await api("/comments/" + page.dataset.show + "?id=" + c.id, { method: "DELETE" });
        loadComments(page);
      } catch (err) {
        alert(err.message);
      }
    });
    head.appendChild(del);
  }

  // textContent (а не innerHTML) захищає від шкідливого коду в коментарях
  const text = document.createElement("p");
  text.className = "comment-text";
  text.textContent = c.text;

  li.append(head, text);
  return li;
}

// ============================================================
//  4. КНОПКА "НАГОРУ"
// ============================================================
const toTop = document.getElementById("toTop");
window.addEventListener("scroll", () => toTop.classList.toggle("show", scrollY > 500));
toTop.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

// ---------- Старт ----------
checkLogin();
showPage();
