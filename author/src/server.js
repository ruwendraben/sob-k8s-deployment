const dotenv = require("dotenv");
dotenv.config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const {
  listPostsNewestFirst,
  deletePost,
  removeImageFromPost,
  listAllSellerApplications,
  updateSellerStatus,
  ensureStorage
} = require("./store");
const { deleteImageFromS3 } = require("./s3");
const { getParameter } = require("./ssm");

const port = Number(process.env.PORT || 3001);
const ADMIN_USERNAME = process.env.ADMIN_USERNAME || "";
const ADMIN_PASSWORD_HASH = process.env.ADMIN_PASSWORD_HASH || "";

function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  const attempt = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(attempt), Buffer.from(hash));
}

function safeCompare(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

// ── Start ─────────────────────────────────────────────────────────────────────

async function start() {
  await ensureStorage();

  const ssmPath = process.env.SSM_SESSION_SECRET_PATH;
  if (!ssmPath) {
    console.error("SSM_SESSION_SECRET_PATH must be set in .env");
    process.exit(1);
  }

  let SESSION_SECRET;
  try {
    SESSION_SECRET = await getParameter(ssmPath);
    console.log(`SESSION_SECRET loaded from SSM: ${ssmPath}`);
  } catch (err) {
    console.error(`Failed to load SESSION_SECRET from SSM (${ssmPath}):`, err.message);
    process.exit(1);
  }

  if (!ADMIN_USERNAME || !ADMIN_PASSWORD_HASH) {
    console.error("ADMIN_USERNAME and ADMIN_PASSWORD_HASH must be set in .env");
    process.exit(1);
  }

  const app = express();

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));
  app.set("trust proxy", 1);

  app.use(express.urlencoded({ extended: true }));
  app.use("/public", express.static(path.join(__dirname, "..", "public")));

  app.use(
    session({
      secret: SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: { httpOnly: true, sameSite: "lax" }
    })
  );

  function requireAuth(req, res, next) {
    if (req.session && req.session.admin) return next();
    res.redirect("/login");
  }

  // ── Auth ────────────────────────────────────────────────────────────────────

  app.get("/login", (req, res) => {
    if (req.session && req.session.admin) return res.redirect("/");
    res.render("login", { error: null });
  });

  app.post("/login", (req, res) => {
    const username = (req.body.username || "").trim();
    const password = req.body.password || "";

    if (safeCompare(username, ADMIN_USERNAME) && verifyPassword(password, ADMIN_PASSWORD_HASH)) {
      req.session.regenerate((err) => {
        if (err) return res.redirect("/login");
        req.session.admin = true;
        res.redirect("/");
      });
      return;
    }

    res.status(401).render("login", { error: "Invalid username or password." });
  });

  app.post("/logout", requireAuth, (req, res) => {
    req.session.destroy(() => res.redirect("/login"));
  });

  // ── Dashboard ────────────────────────────────────────────────────────────────

  app.get("/", requireAuth, async (req, res, next) => {
    try {
      const posts = await listPostsNewestFirst();
      const sellers = await listAllSellerApplications();
      res.render("dashboard", {
        posts,
        sellers,
        error: null,
        success: req.query.success || null
      });
    } catch (err) {
      next(err);
    }
  });

  // ── Delete entire post ────────────────────────────────────────────────────────

  app.post("/posts/:id/delete", requireAuth, async (req, res, next) => {
    try {
      const removed = await deletePost(req.params.id);
      const keys = (removed.images || []).map((i) => i.key).filter(Boolean);
      if (!keys.length && removed.imageKey) keys.push(removed.imageKey);
      await Promise.allSettled(keys.map((k) => deleteImageFromS3(k)));
      res.redirect("/?success=Post+deleted");
    } catch (err) {
      next(err);
    }
  });

  // ── Remove one image from a post ─────────────────────────────────────────────

  app.post("/posts/:id/images/:idx/remove", requireAuth, async (req, res, next) => {
    try {
      const removed = await removeImageFromPost(req.params.id, Number(req.params.idx));
      if (removed && removed.key) {
        await deleteImageFromS3(removed.key).catch(() => {});
      }
      res.redirect("/?success=Image+removed");
    } catch (err) {
      next(err);
    }
  });

  // ── Seller management ──────────────────────────────────────────────────────────

  app.post("/sellers/:id/approve", requireAuth, async (req, res, next) => {
    try {
      await updateSellerStatus(req.params.id, "approved");
      res.redirect("/?success=Seller+approved");
    } catch (err) {
      next(err);
    }
  });

  app.post("/sellers/:id/reject", requireAuth, async (req, res, next) => {
    try {
      await updateSellerStatus(req.params.id, "rejected");
      res.redirect("/?success=Seller+rejected");
    } catch (err) {
      next(err);
    }
  });

  // ── Error handler ─────────────────────────────────────────────────────────────

  app.use((err, _req, res, _next) => {
    if (res.headersSent) return;
    res.status(500).send(
      `<p style="font-family:sans-serif;color:#991b1b;padding:20px">Error: ${err.message || "Unexpected error."}</p><a href="/">Back</a>`
    );
  });

  app.listen(port, () => {
    console.log(`Admin server running at http://localhost:${port}`);
  });
}

start().catch((err) => {
  console.error("Startup failed:", err);
  process.exit(1);
});
