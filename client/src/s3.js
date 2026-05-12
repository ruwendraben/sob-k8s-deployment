const path = require("path");
const crypto = require("crypto");
const { S3Client, PutObjectCommand } = require("@aws-sdk/client-s3");

function getClient() {
  const region = process.env.AWS_REGION;
  const bucketName = process.env.S3_BUCKET_NAME;

  if (!region || !bucketName) {
    throw new Error("AWS_REGION and S3_BUCKET_NAME are required.");
  }

  return new S3Client({ region });
}

function buildObjectUrl(key) {
  return `https://${process.env.S3_BUCKET_NAME}.s3.${process.env.AWS_REGION}.amazonaws.com/${key}`;
}

function makeObjectKey(originalName = "upload") {
  const extension = path.extname(originalName).toLowerCase() || ".jpg";
  const safeExtension = extension.length <= 6 ? extension : ".jpg";
  const randomPart = crypto.randomUUID();
  return `timeline/${Date.now()}-${randomPart}${safeExtension}`;
}

async function uploadImageToS3(file) {
  if (!file || !file.buffer) {
    throw new Error("No file provided for upload.");
  }

  const key = makeObjectKey(file.originalname);
  const client = getClient();

  await client.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype
    })
  );

  return {
    key,
    url: buildObjectUrl(key)
  };
}

function makeLogoKey(originalName = "logo") {
  const extension = path.extname(originalName).toLowerCase() || ".jpg";
  const safeExtension = extension.length <= 6 ? extension : ".jpg";
  return `uploads/${Date.now()}-${crypto.randomUUID()}${safeExtension}`;
}

async function uploadLogoToS3(file) {
  if (!file || !file.buffer) {
    throw new Error("No file provided for upload.");
  }

  const key = makeLogoKey(file.originalname);
  const client = getClient();

  await client.send(
    new PutObjectCommand({
      Bucket: process.env.S3_BUCKET_NAME,
      Key: key,
      Body: file.buffer,
      ContentType: file.mimetype
    })
  );

  return {
    key,
    url: buildObjectUrl(key)
  };
}

module.exports = {
  uploadImageToS3,
  uploadLogoToS3
};
