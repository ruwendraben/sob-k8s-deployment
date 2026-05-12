# Public Image Timeline (S3 + Docker)

Simple public timeline website where anyone can upload an image + caption and view all posts in newest-first order.

## Features

- Public timeline view (no login)
- Image + caption posting
- Server-side upload to AWS S3
- Like button per post
- Local Docker deployment
- Post metadata persistence via Docker volume (`/app/data/posts.json`)

## 1) AWS S3 setup

Create an S3 bucket in your AWS account, then make objects publicly readable.

### Bucket policy (public read)

Replace `YOUR_BUCKET_NAME` and apply this as bucket policy:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Sid": "PublicReadObjects",
      "Effect": "Allow",
      "Principal": "*",
      "Action": "s3:GetObject",
      "Resource": "arn:aws:s3:::YOUR_BUCKET_NAME/*"
    }
  ]
}
```

Also ensure your bucket-level public access settings allow this policy if you want fully public image URLs.

## 2) Configure environment

1. Copy `.env.example` to `.env`
2. Fill in your AWS values:

```env
AWS_REGION=us-east-1
S3_BUCKET_NAME=your-public-bucket-name
AWS_ACCESS_KEY_ID=...
AWS_SECRET_ACCESS_KEY=...
```

## 3) Run locally with Docker

```bash
docker compose up --build
```

Open: `http://localhost:3000`

## Local development without Docker

```bash
npm install
npm start
```

## Project structure

- `src/server.js` - routes and app server
- `src/s3.js` - S3 upload logic
- `src/store.js` - local JSON metadata store
- `src/views/index.ejs` - timeline UI
- `public/styles.css` - page styles


to reset the admin password use below comand. remember to install node first.
1. winget install OpenJS.NodeJS.LTS
2. node -e "const { randomBytes, scryptSync } = require('node:crypto'); const password = '<your-password>'; const salt = randomBytes(16).toString('hex'); const hash = scryptSync(password, salt, 64).toString('hex'); console.log(salt + ':' + hash);"