# Deployment Guide

This project consists of two parts that need to be deployed:
1.  **Backend API**: A Cloudflare Worker connected to D1 Database.
2.  **Frontend**: A React application (deployed on Vercel, Netlify, or Cloudflare Pages).

## 1. Deploying the Backend API (Cloudflare Workers)

The backend handles all database operations. You need to deploy this whenever you change code in `workers/api`.

1.  **Navigate to the worker directory:**
    ```bash
    cd workers/api
    ```

2.  **Deploy using Wrangler:**
    ```bash
    npx wrangler deploy
    ```

    *   This will output your worker's URL (e.g., `https://paste-api.your-name.workers.dev`).
    *   **Important:** Copy this URL. You will need it for the frontend configuration.

### Updating the Database Schema
If you modify `workers/api/schema.sql`, you need to apply changes to the remote D1 database:

```bash
cd workers/api
npx wrangler d1 execute paste-db --file=schema.sql --remote
```
*Note: This usually re-applies the whole schema. for complex migrations, you might need to run specific SQL commands instead.*

---

## 2. Deploying the Frontend

The frontend communicates with the backend via the `VITE_API_URL` environment variable.

### Option A: Vercel (Recommended)
1.  Push your code to GitHub/GitLab.
2.  Import the project into Vercel.
3.  **Environment Variables:**
    Go to **Settings > Environment Variables** and add:
    *   `VITE_API_URL`: The URL of your deployed Worker (from Step 1).
    *   `VITE_R2_SIGNER_URL`: (If using R2) The URL of your R2 signer worker.
    *   `VITE_R2_ACCOUNT_ID`, `VITE_R2_BUCKET_NAME`: Public R2 info if needed.

4.  **Deploy:** Vercel will automatically build and deploy.

### Option B: Cloudflare Pages
1.  Connect your repository to Cloudflare Pages.
2.  **Build Settings:**
    *   Framework: `Vite`
    *   Build command: `npm run build`
    *   Output directory: `dist`
3.  **Environment Variables:**
    Add `VITE_API_URL` in the Pages settings.

### Option C: Manual Build
To build the static files locally for any static host:
```bash
npm run build
```
The output will be in the `dist` folder.

## Summary of Environment Variables

| Variable | Description | Where to set |
| :--- | :--- | :--- |
| `VITE_API_URL` | URL of your Cloudflare Worker API | Frontend (Vercel/Pages) |
| `DB` | D1 Database Binding (Automatic in Wrangler) | `workers/api/wrangler.toml` |
