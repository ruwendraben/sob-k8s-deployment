FROM node:24-alpine AS builder

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
# If you have a build step, uncomment the next line
# RUN npm run build

FROM node:24-alpine AS production
WORKDIR /app
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app .

ENV PORT=3001
EXPOSE 3001
CMD ["npm", "start"]
