const dotenv = require("dotenv");
dotenv.config();

const path = require("path");
const crypto = require("crypto");
const express = require("express");
const session = require("express-session");
const multer = require("multer");
const {
  createPost,
  listPostsNewestFirst,
  likePost,
  ensureStorage,
  createUser,
  findUserByEmail,
  createSellerApplication,
  findSellerByUserId,
  findSellerBySubdomain,
  updateSellerProfile
} = require("./store");
const { uploadImageToS3, uploadLogoToS3 } = require("./s3");
const { getParameter } = require("./ssm");

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString("hex");
  const hash = crypto.scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = storedHash.split(":");
  if (!salt || !hash) return false;
  const attempt = crypto.scryptSync(password, salt, 64).toString("hex");
  return crypto.timingSafeEqual(Buffer.from(attempt), Buffer.from(hash));
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

async function start() {
  await ensureStorage();

  const maxFileSizeMb = Number(process.env.MAX_FILE_SIZE_MB || 10);
  const port = Number(process.env.PORT || 3000);

  const ssmPath = process.env.SSM_SESSION_SECRET_PATH;
  if (!ssmPath) {
    console.error("SSM_SESSION_SECRET_PATH must be set in .env");
    process.exit(1);
  }
  let sessionSecret;
  try {
    sessionSecret = await getParameter(ssmPath);
    console.log(`SESSION_SECRET loaded from SSM: ${ssmPath}`);
  } catch (err) {
    console.error(`Failed to load SESSION_SECRET from SSM (${ssmPath}):`, err.message);
    process.exit(1);
  }

  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileSizeMb * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
      if (!file.mimetype || !file.mimetype.startsWith("image/")) {
        callback(new Error("Only image uploads are allowed."));
        return;
      }
      callback(null, true);
    }
  });

  const uploadLogo = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxFileSizeMb * 1024 * 1024 },
    fileFilter: (_req, file, callback) => {
      if (!file.mimetype || !file.mimetype.startsWith("image/")) {
        callback(new Error("Only image uploads are allowed."));
        return;
      }
      callback(null, true);
    }
  });

  const app = express();

  app.set("view engine", "ejs");
  app.set("views", path.join(__dirname, "views"));

  app.use(express.urlencoded({ extended: true }));
  app.use("/public", express.static(path.join(__dirname, "..", "public")));
  app.use(session({
    secret: sessionSecret,
    resave: false,
    saveUninitialized: false,
    cookie: { httpOnly: true, sameSite: "lax" }
  }));

  // ── Timeline ─────────────────────────────────────────────────────────────────

  app.get("/", async (req, res, next) => {
    try {
      const posts = await listPostsNewestFirst(req.session.user ? req.session.user.id : null);
      let seller = null;
      if (req.session.user) {
        seller = await findSellerByUserId(req.session.user.id);
      }
      res.render("index", {
        posts,
        error: null,
        success: req.query.success || null,
        maxFileSizeMb,
        user: req.session.user || null,
        seller
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/posts", (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    next();
  }, upload.array("images", 20), async (req, res) => {
    try {
      const caption = (req.body.caption || "").trim();

      if (!req.files || req.files.length === 0) {
        const posts = await listPostsNewestFirst(req.session.user ? req.session.user.id : null);
        return res.status(400).render("index", {
          posts,
          error: "Please choose at least one image to upload.",
          success: null,
          maxFileSizeMb,
          user: req.session.user || null,
          seller: null
        });
      }

      const uploaded = await Promise.all(req.files.map((f) => uploadImageToS3(f)));
      const images = uploaded.map(({ key, url }) => ({ url, key }));

      let sellerSubdomain = null;
      const sellerRecord = await findSellerByUserId(req.session.user.id);
      if (sellerRecord && sellerRecord.status === "approved") {
        sellerSubdomain = sellerRecord.subdomain;
      }

      await createPost({ caption, images, sellerSubdomain });
      res.redirect("/?success=Post+published");
    } catch (error) {
      const posts = await listPostsNewestFirst(req.session.user ? req.session.user.id : null);
      res.status(400).render("index", {
        posts,
        error: error.message || "Upload failed. Please try again.",
        success: null,
        maxFileSizeMb,
        user: req.session.user || null,
        seller: null
      });
    }
  });

  app.post("/posts/:id/like", (req, res, next) => {
    if (!req.session.user) {
      return res.status(401).json({ error: "Please sign in to like posts." });
    }
    next();
  }, async (req, res, next) => {
    try {
      const result = await likePost(req.params.id, req.session.user.id);
      res.json({ likes: result.post.likes, likedByUser: result.likedByUser });
    } catch (error) {
      next(error);
    }
  });

  // ── Auth ──────────────────────────────────────────────────────────────────────

  app.get("/signup", (req, res) => {
    if (req.session.user) return res.redirect("/");
    res.render("signup", { error: null });
  });

  app.post("/signup", async (req, res, next) => {
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";
    const confirm = req.body.confirm || "";
    if (!isValidEmail(email)) {
      return res.status(400).render("signup", { error: "Please enter a valid email address." });
    }
    if (password.length < 8) {
      return res.status(400).render("signup", { error: "Password must be at least 8 characters." });
    }
    if (password !== confirm) {
      return res.status(400).render("signup", { error: "Passwords do not match." });
    }
    try {
      const user = await createUser({ email, passwordHash: hashPassword(password) });
      req.session.regenerate((err) => {
        if (err) return next(err);
        req.session.user = { id: user.id, email: user.email };
        res.redirect("/");
      });
    } catch (err) {
      res.status(400).render("signup", { error: err.message });
    }
  });

  app.get("/login", (req, res) => {
    if (req.session.user) return res.redirect("/");
    res.render("login", { error: null });
  });

  app.post("/login", async (req, res) => {
    const email = (req.body.email || "").trim().toLowerCase();
    const password = req.body.password || "";
    const found = await findUserByEmail(email).catch(() => null);
    if (!found || !verifyPassword(password, found.passwordHash)) {
      return res.status(401).render("login", { error: "Invalid email or password." });
    }
    req.session.regenerate((err) => {
      if (err) return res.redirect("/login");
      req.session.user = { id: found.id, email: found.email };
      res.redirect("/");
    });
  });

  app.post("/logout", (req, res) => {
    req.session.destroy(() => res.redirect("/"));
  });

  // ── Seller registration ─────────────────────────────────────────────────────────

  app.get("/seller/register", (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    res.render("seller-register", { error: null });
  });

  app.post("/seller/register", (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    next();
  }, uploadLogo.single("brandLogo"), async (req, res) => {
    const subdomain = (req.body.subdomain || "").trim().toLowerCase();
    const shopName = (req.body.shopName || "").trim();
    const brandName = (req.body.brandName || "").trim();
    const address = (req.body.address || "").trim();
    const tel = (req.body.tel || "").trim();

    if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(subdomain)) {
      return res.status(400).render("seller-register", {
        error: "Subdomain must be 3–30 characters: lowercase letters, numbers, and hyphens (no start/end hyphen)."
      });
    }
    if (!shopName) {
      return res.status(400).render("seller-register", { error: "Shop name is required." });
    }
    if (!brandName) {
      return res.status(400).render("seller-register", { error: "Brand name is required." });
    }

    try {
      let brandLogoUrl = null;
      let brandLogoKey = null;
      if (req.file) {
        const result = await uploadLogoToS3(req.file);
        brandLogoUrl = result.url;
        brandLogoKey = result.key;
      }

      await createSellerApplication({
        userId: req.session.user.id,
        email: req.session.user.email,
        subdomain,
        shopName,
        brandName,
        address,
        tel,
        brandLogoUrl,
        brandLogoKey
      });

      res.redirect("/seller/status");
    } catch (err) {
      res.status(400).render("seller-register", { error: err.message });
    }
  });

  app.get("/seller/status", async (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    const seller = await findSellerByUserId(req.session.user.id);
    if (!seller) return res.redirect("/seller/register");
    res.render("seller-status", { seller });
  });

  app.get("/seller/edit", async (req, res) => {
    if (!req.session.user) return res.redirect("/login");
    const seller = await findSellerByUserId(req.session.user.id);
    if (!seller || seller.status !== "approved") return res.redirect("/seller/status");
    res.render("seller-edit", { seller, error: null, success: null });
  });

  app.post("/seller/edit", (req, res, next) => {
    if (!req.session.user) return res.redirect("/login");
    next();
  }, uploadLogo.single("brandLogo"), async (req, res) => {
    try {
      const seller = await findSellerByUserId(req.session.user.id);
      if (!seller || seller.status !== "approved") return res.redirect("/seller/status");

      const updates = {
        shopName: (req.body.shopName || "").trim() || seller.shopName,
        brandName: (req.body.brandName || "").trim() || seller.brandName,
        address: (req.body.address || "").trim(),
        tel: (req.body.tel || "").trim(),
        motto: (req.body.motto || "").trim(),
        employeeCount: (req.body.employeeCount || "").trim(),
        employeeOfYear: (req.body.employeeOfYear || "").trim()
      };

      if (req.file) {
        const result = await uploadLogoToS3(req.file);
        updates.brandLogoUrl = result.url;
        updates.brandLogoKey = result.key;
      }

      const updated = await updateSellerProfile(req.session.user.id, updates);
      res.render("seller-edit", { seller: updated, error: null, success: "Shop profile updated!" });
    } catch (err) {
      const seller = await findSellerByUserId(req.session.user.id);
      res.status(400).render("seller-edit", { seller, error: err.message, success: null });
    }
  });

  // ── Seller shop page (must be last — catches /:subdomain) ─────────────────

  app.get("/:subdomain", async (req, res, next) => {
    const subdomain = req.params.subdomain.toLowerCase();
    if (!/^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/.test(subdomain)) return next();
    const seller = await findSellerBySubdomain(subdomain);
    if (!seller || seller.status !== "approved") return next();
    res.render("shop", { seller });
  });

  // ── Error handler ─────────────────────────────────────────────────────────────

  app.use(async (error, req, res, _next) => {
    if (error instanceof multer.MulterError && error.code === "LIMIT_FILE_SIZE") {
      const posts = await listPostsNewestFirst(req.session.user ? req.session.user.id : null);
      return res.status(400).render("index", {
        posts,
        error: `Image is too large. Max size is ${maxFileSizeMb}MB.`,
        success: null,
        maxFileSizeMb,
        user: req.session.user || null,
        seller: null
      });
    }
    const posts = await listPostsNewestFirst(req.session.user ? req.session.user.id : null);
    res.status(500).render("index", {
      posts,
      error: error.message || "Unexpected error.",
      success: null,
      maxFileSizeMb,
      user: req.session.user || null,
      seller: null
    });
  });

  app.listen(port, () => {
    console.log(`Server running at http://localhost:${port}`);
  });
}

start().catch((error) => {
  console.error("Startup failed:", error);
  process.exit(1);
});
