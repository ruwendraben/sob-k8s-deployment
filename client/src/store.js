const { Pool } = require("pg");
const crypto = require("crypto");

const pool = new Pool({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT, 10),
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : false
});

function normalizeImages(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

async function ensureStorage() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS posts (
      id TEXT PRIMARY KEY,
      caption TEXT,
      images TEXT,
      image_url TEXT,
      image_key TEXT,
      likes INTEGER NOT NULL DEFAULT 0,
      seller_subdomain TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS sellers (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      email TEXT NOT NULL,
      subdomain TEXT NOT NULL UNIQUE,
      shop_name TEXT,
      brand_name TEXT,
      address TEXT,
      tel TEXT,
      brand_logo_url TEXT,
      brand_logo_key TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      motto TEXT,
      employee_count TEXT,
      employee_of_year TEXT,
      created_at TIMESTAMP NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS post_likes (
      post_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT NOW(),
      PRIMARY KEY (post_id, user_id)
    )
  `);
}

async function createPost({ caption, images, sellerSubdomain }) {
  const id = crypto.randomUUID();
  const imageUrl = images[0]?.url || null;
  const imageKey = images[0]?.key || null;
  const imagesJson = JSON.stringify(images);

  const query = `
    INSERT INTO posts (id, caption, images, image_url, image_key, likes, seller_subdomain, created_at)
    VALUES ($1, $2, $3, $4, $5, 0, $6, NOW())
    RETURNING id, caption, images, image_url as "imageUrl", image_key as "imageKey", likes, seller_subdomain as "sellerSubdomain", created_at as "createdAt"
  `;

  const result = await pool.query(query, [id, caption || "", imagesJson, imageUrl, imageKey, sellerSubdomain || null]);
  const row = result.rows[0];
  return {
    ...row,
    images: normalizeImages(row.images)
  };
}

async function listPostsNewestFirst(userId = null) {
  const query = `
    SELECT
      p.id,
      p.caption,
      p.images,
      p.image_url as "imageUrl",
      p.image_key as "imageKey",
      p.likes,
      p.seller_subdomain as "sellerSubdomain",
      p.created_at as "createdAt",
      EXISTS (
        SELECT 1
        FROM post_likes pl
        WHERE pl.post_id = p.id AND pl.user_id = $1
      ) as "likedByUser"
    FROM posts p
    ORDER BY p.created_at DESC
  `;

  const result = await pool.query(query, [userId || ""]);
  return result.rows.map(row => ({
    ...row,
    images: normalizeImages(row.images)
  }));
}

async function likePost(id, userId) {
  if (!userId) {
    throw new Error("Login required.");
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const insertLike = await client.query(
      `
        INSERT INTO post_likes (post_id, user_id)
        VALUES ($1, $2)
        ON CONFLICT DO NOTHING
        RETURNING post_id
      `,
      [id, userId]
    );

    let result;
    let likedByUser = false;
    if (insertLike.rows.length > 0) {
      likedByUser = true;
      result = await client.query(
        `
          UPDATE posts
          SET likes = likes + 1
          WHERE id = $1
          RETURNING id, caption, images, image_url as "imageUrl", image_key as "imageKey", likes, seller_subdomain as "sellerSubdomain", created_at as "createdAt"
        `,
        [id]
      );
    } else {
      const deleteLike = await client.query(
        `
          DELETE FROM post_likes
          WHERE post_id = $1 AND user_id = $2
          RETURNING post_id
        `,
        [id, userId]
      );

      likedByUser = false;
      if (deleteLike.rows.length > 0) {
        result = await client.query(
          `
            UPDATE posts
            SET likes = GREATEST(likes - 1, 0)
            WHERE id = $1
            RETURNING id, caption, images, image_url as "imageUrl", image_key as "imageKey", likes, seller_subdomain as "sellerSubdomain", created_at as "createdAt"
          `,
          [id]
        );
      } else {
        result = await client.query(
        `
          SELECT id, caption, images, image_url as "imageUrl", image_key as "imageKey", likes, seller_subdomain as "sellerSubdomain", created_at as "createdAt"
          FROM posts
          WHERE id = $1
        `,
        [id]
      );
      }
    }

    if (result.rows.length === 0) {
      throw new Error("Post not found.");
    }

    await client.query("COMMIT");

    const row = result.rows[0];
    return {
      post: {
        ...row,
        images: normalizeImages(row.images)
      },
      likedByUser
    };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

// ── Users ────────────────────────────────────────────────────────────────────

async function createUser({ email, passwordHash }) {
  const id = crypto.randomUUID();

  const checkQuery = `SELECT id FROM users WHERE email = $1`;
  const checkResult = await pool.query(checkQuery, [email]);

  if (checkResult.rows.length > 0) {
    throw new Error("An account with this email already exists.");
  }

  const query = `
    INSERT INTO users (id, email, password_hash, created_at)
    VALUES ($1, $2, $3, NOW())
    RETURNING id, email, password_hash as "passwordHash", created_at as "createdAt"
  `;

  const result = await pool.query(query, [id, email, passwordHash]);
  return result.rows[0];
}

async function findUserByEmail(email) {
  const query = `
    SELECT id, email, password_hash as "passwordHash", created_at as "createdAt"
    FROM users
    WHERE email = $1
  `;

  const result = await pool.query(query, [email]);
  return result.rows[0] || null;
}

// ── Sellers ──────────────────────────────────────────────────────────────────

async function createSellerApplication({ userId, email, subdomain, shopName, brandName, address, tel, brandLogoUrl, brandLogoKey }) {
  const id = crypto.randomUUID();

  // Check if subdomain already exists
  const subdomainQuery = `SELECT id FROM sellers WHERE subdomain = $1`;
  const subdomainResult = await pool.query(subdomainQuery, [subdomain]);
  if (subdomainResult.rows.length > 0) {
    throw new Error("This subdomain is already taken.");
  }

  // Check if user already has a seller application
  const userQuery = `SELECT id FROM sellers WHERE user_id = $1`;
  const userResult = await pool.query(userQuery, [userId]);
  if (userResult.rows.length > 0) {
    throw new Error("You already have a seller application.");
  }

  const query = `
    INSERT INTO sellers (id, user_id, email, subdomain, shop_name, brand_name, address, tel, brand_logo_url, brand_logo_key, status, created_at)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'pending', NOW())
    RETURNING id, user_id as "userId", email, subdomain, shop_name as "shopName", brand_name as "brandName", address, tel, brand_logo_url as "brandLogoUrl", brand_logo_key as "brandLogoKey", status, created_at as "createdAt"
  `;

  const result = await pool.query(query, [id, userId, email, subdomain, shopName, brandName, address, tel, brandLogoUrl || null, brandLogoKey || null]);
  return result.rows[0];
}

async function findSellerByUserId(userId) {
  const query = `
    SELECT id, user_id as "userId", email, subdomain, shop_name as "shopName", brand_name as "brandName", address, tel, brand_logo_url as "brandLogoUrl", brand_logo_key as "brandLogoKey", status, motto, employee_count as "employeeCount", employee_of_year as "employeeOfYear", created_at as "createdAt"
    FROM sellers
    WHERE user_id = $1
  `;

  const result = await pool.query(query, [userId]);
  return result.rows[0] || null;
}

async function findSellerBySubdomain(subdomain) {
  const query = `
    SELECT id, user_id as "userId", email, subdomain, shop_name as "shopName", brand_name as "brandName", address, tel, brand_logo_url as "brandLogoUrl", brand_logo_key as "brandLogoKey", status, motto, employee_count as "employeeCount", employee_of_year as "employeeOfYear", created_at as "createdAt"
    FROM sellers
    WHERE subdomain = $1
  `;

  const result = await pool.query(query, [subdomain]);
  return result.rows[0] || null;
}

async function updateSellerProfile(userId, updates) {
  const allowed = ["shopName", "brandName", "address", "tel", "motto", "employeeCount", "employeeOfYear", "brandLogoUrl", "brandLogoKey"];

  // Build dynamic SET clause
  const setClauses = [];
  const values = [userId];
  let paramCount = 2;

  const columnMap = {
    shopName: "shop_name",
    brandName: "brand_name",
    address: "address",
    tel: "tel",
    motto: "motto",
    employeeCount: "employee_count",
    employeeOfYear: "employee_of_year",
    brandLogoUrl: "brand_logo_url",
    brandLogoKey: "brand_logo_key"
  };

  for (const key of allowed) {
    if (key in updates) {
      setClauses.push(`${columnMap[key]} = $${paramCount}`);
      values.push(updates[key]);
      paramCount++;
    }
  }

  if (setClauses.length === 0) {
    // No updates, just return the current seller
    const query = `
      SELECT id, user_id as "userId", email, subdomain, shop_name as "shopName", brand_name as "brandName", address, tel, brand_logo_url as "brandLogoUrl", brand_logo_key as "brandLogoKey", status, motto, employee_count as "employeeCount", employee_of_year as "employeeOfYear", created_at as "createdAt"
      FROM sellers
      WHERE user_id = $1
    `;
    const result = await pool.query(query, [userId]);
    if (result.rows.length === 0) throw new Error("Seller not found.");
    return result.rows[0];
  }

  const query = `
    UPDATE sellers
    SET ${setClauses.join(", ")}
    WHERE user_id = $1
    RETURNING id, user_id as "userId", email, subdomain, shop_name as "shopName", brand_name as "brandName", address, tel, brand_logo_url as "brandLogoUrl", brand_logo_key as "brandLogoKey", status, motto, employee_count as "employeeCount", employee_of_year as "employeeOfYear", created_at as "createdAt"
  `;

  const result = await pool.query(query, values);
  if (result.rows.length === 0) throw new Error("Seller not found.");
  return result.rows[0];
}

module.exports = {
  ensureStorage,
  createPost,
  listPostsNewestFirst,
  likePost,
  createUser,
  findUserByEmail,
  createSellerApplication,
  findSellerByUserId,
  findSellerBySubdomain,
  updateSellerProfile
};
