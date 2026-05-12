const { Pool } = require("pg");

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
}

async function listPostsNewestFirst() {
  const query = `
    SELECT id, caption, images, image_url as "imageUrl", image_key as "imageKey", likes, seller_subdomain as "sellerSubdomain", created_at as "createdAt"
    FROM posts
    ORDER BY created_at DESC
  `;

  const result = await pool.query(query);
  return result.rows.map(row => ({
    ...row,
    images: normalizeImages(row.images)
  }));
}

async function deletePost(id) {
  const query = `
    DELETE FROM posts
    WHERE id = $1
    RETURNING id, caption, images, image_url as "imageUrl", image_key as "imageKey", likes, seller_subdomain as "sellerSubdomain", created_at as "createdAt"
  `;

  const result = await pool.query(query, [id]);

  if (result.rows.length === 0) {
    throw new Error("Post not found.");
  }

  const row = result.rows[0];
  return {
    ...row,
    images: normalizeImages(row.images)
  };
}

async function removeImageFromPost(id, imageIndex) {
  // Get the post
  const selectQuery = `
    SELECT id, caption, images, image_url as "imageUrl", image_key as "imageKey", likes, seller_subdomain as "sellerSubdomain", created_at as "createdAt"
    FROM posts
    WHERE id = $1
  `;

  const selectResult = await pool.query(selectQuery, [id]);

  if (selectResult.rows.length === 0) {
    throw new Error("Post not found.");
  }

  const post = selectResult.rows[0];
  const images = normalizeImages(post.images);

  if (images.length <= 1) {
    throw new Error("Cannot remove the only image. Delete the post instead.");
  }

  if (imageIndex < 0 || imageIndex >= images.length) {
    throw new Error("Image index out of range.");
  }

  const [removed] = images.splice(imageIndex, 1);
  const updatedImages = JSON.stringify(images);
  const newImageUrl = images[0]?.url || null;
  const newImageKey = images[0]?.key || null;

  // Update the post
  const updateQuery = `
    UPDATE posts
    SET images = $2, image_url = $3, image_key = $4
    WHERE id = $1
    RETURNING id, caption, images, image_url as "imageUrl", image_key as "imageKey", likes, seller_subdomain as "sellerSubdomain", created_at as "createdAt"
  `;

  const updateResult = await pool.query(updateQuery, [id, updatedImages, newImageUrl, newImageKey]);
  return removed;
}

// ── Sellers ──────────────────────────────────────────────────────────────────

async function listAllSellerApplications() {
  const query = `
    SELECT id, user_id as "userId", email, subdomain, shop_name as "shopName", brand_name as "brandName", address, tel, brand_logo_url as "brandLogoUrl", brand_logo_key as "brandLogoKey", status, motto, employee_count as "employeeCount", employee_of_year as "employeeOfYear", created_at as "createdAt"
    FROM sellers
    ORDER BY created_at DESC
  `;

  const result = await pool.query(query);
  return result.rows;
}

async function updateSellerStatus(id, status) {
  const query = `
    UPDATE sellers
    SET status = $2
    WHERE id = $1
    RETURNING id, user_id as "userId", email, subdomain, shop_name as "shopName", brand_name as "brandName", address, tel, brand_logo_url as "brandLogoUrl", brand_logo_key as "brandLogoKey", status, motto, employee_count as "employeeCount", employee_of_year as "employeeOfYear", created_at as "createdAt"
  `;

  const result = await pool.query(query, [id, status]);

  if (result.rows.length === 0) {
    throw new Error("Seller not found.");
  }

  return result.rows[0];
}

module.exports = {
  ensureStorage,
  listPostsNewestFirst,
  deletePost,
  removeImageFromPost,
  listAllSellerApplications,
  updateSellerStatus
};
