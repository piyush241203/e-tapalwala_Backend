# E-Tapalwala Backend Service

This is the Express.js and TypeScript backend for the E-Tapalwala Government SaaS platform. It handles API logic, database interactions with MongoDB Atlas via Prisma, Cloudinary uploads, and Meta WhatsApp / Twilio messaging integrations.

## 🚀 Key Technologies
- **Node.js & Express:** RESTful API framework.
- **TypeScript:** Type-safe business logic.
- **Prisma:** Modern ORM tailored for our MongoDB cluster.
- **MongoDB Atlas:** Cloud NoSQL database.
- **Cloudinary:** Cloud storage for uploaded PDFs.

---

## 🛠 Setup & Installation

### 1. Install Dependencies
Ensure you have Node.js (v18+) installed.
```bash
npm install
```

### 2. Configure Environment Variables
Create a `.env` file in the root of the `backend` folder and populate it:
```env
PORT=4000
DATABASE_URL=mongodb+srv://<username>:<password>@<cluster-url>/<db-name>?retryWrites=true&w=majority
JWT_ACCESS_SECRET=your_super_secret_access_key
JWT_REFRESH_SECRET=your_super_secret_refresh_key

# Messaging APIs
META_ACCESS_TOKEN=your_meta_token
META_PHONE_NUMBER_ID=your_phone_id
META_WEBHOOK_VERIFY_TOKEN=your_verify_token
TWILIO_ACCOUNT_SID=ACxxxxxxxx
TWILIO_AUTH_TOKEN=your_auth_token
TWILIO_FROM_NUMBER=+1234567890
TWILIO_WHATSAPP_FROM=whatsapp:+14155238886

# Cloud Storage
CLOUDINARY_CLOUD_NAME=your_cloud_name
CLOUDINARY_API_KEY=your_api_key
CLOUDINARY_API_SECRET=your_api_secret

ALLOWED_ORIGINS=http://localhost:3000
```

### 3. Database Initialization (Important)
Because we are using **MongoDB**, Prisma migrations (`prisma migrate dev`) are **not supported**. 
If you change your `DATABASE_URL` or if you pull schema updates, you **MUST** run the following commands to push the schema and regenerate the client:

```bash
npx prisma generate --schema=src/prisma/schema.prisma
npx prisma db push --schema=src/prisma/schema.prisma
```
*(This ensures your local Prisma Client is instantly synced with your active MongoDB Atlas cluster).*

### 4. Running the Server

**Development Mode** (auto-restarts on save):
```bash
npm run dev
```

**Production Build:**
```bash
npm run build
npm start
```

---

## ☁️ Hosting & Deployment Requirements

To successfully host this backend in a production environment (e.g., Render, Railway, DigitalOcean, AWS):

1. **Persistent Execution Environment:** The backend expects a Node.js runtime environment (e.g., Docker container, PM2).
2. **Environment Variables Configuration:** You must copy all variables from your `.env` directly into your hosting provider's Secrets/Environment Variables tab.
3. **Build Command:** Your host's build command must be:
   ```bash
   npm install && npx prisma generate --schema=src/prisma/schema.prisma && npm run build
   ```
4. **Start Command:** Your host's start command must be:
   ```bash
   npm start
   ```
5. **Network Ports:** Ensure your hosting platform maps external traffic to the port specified in your `PORT` environment variable (typically 4000).
6. **MongoDB Network Access:** Make sure that your MongoDB Atlas cluster has its Network Access IP whitelist set to `0.0.0.0/0` (Allow Access from Anywhere) or specifically whitelisted to your hosting provider's static IPs.
