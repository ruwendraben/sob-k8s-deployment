const { S3Client, DeleteObjectCommand } = require("@aws-sdk/client-s3");

function getClient() {
  const region = process.env.AWS_REGION;
  const bucketName = process.env.S3_BUCKET_NAME;

  if (!region || !bucketName) {
    throw new Error("AWS_REGION and S3_BUCKET_NAME are required.");
  }
  return new S3Client({ region });
}

async function deleteImageFromS3(key) {
  if (!key) return;
  const client = getClient();
  await client.send(new DeleteObjectCommand({ Bucket: process.env.S3_BUCKET_NAME, Key: key }));
}

module.exports = { deleteImageFromS3 };
