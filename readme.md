# 📝 Pastry

This project is **inspired by rentry**, a simple and elegant pastebin service. It provides a clean interface for creating and sharing text pastes anonymously, with support for both **permanent (passcode-protected)** and **shared guest pastes**. Built with React and Neon Database, it offers a modern, responsive experience for quick text sharing. 🚀

To run the project, first ensure you have **Node.js** installed. Then, navigate to the project directory, install dependencies with `npm install`, and start the development server with `npm run dev`. The app will be available at `http://localhost:3000`.

To use it, visit the homepage and choose between:
- **Admin mode**: Enter a passcode for permanent pastes 🔒
- **Guest mode**: Shared editable paste for all users 👥
	- Guests can upload files too (stored separately from admin uploads), with a 1 GB total limit.

Create or edit pastes in the editor, save them, and share the generated URLs. Guests can view and edit the same shared paste collaboratively. 📤

## Configuration

Create a `.env` file in the project root (same folder as `package.json`) and set the following variables:

```
# Neon Postgres (required)
VITE_NEON_DATABASE_URL=postgres://user:pass@host/db

# Cloudflare R2 (client only needs optional external signer URL for local dev)
# Avoid putting secrets in VITE_ variables.
VITE_R2_SIGNER_URL= # optional, only for local dev fallback
```

Notes:
- Buckets are private by default on Cloudflare R2. Direct URLs like `https://<account>.r2.cloudflarestorage.com/<bucket>/<key>` will return XML errors (Authorization) unless they are presigned.
- This app never exposes R2 credentials. It requests short-lived presigned URLs from the Worker in `workers/r2-signer` for uploads (PUT), downloads (GET), and deletes (DELETE).

### Configure server-side signing on Vercel (recommended)

1. In your Vercel Project Settings, add Environment Variables (no VITE_ prefix):
	- `R2_ACCOUNT_ID`
	- `R2_BUCKET_NAME`
	- `R2_ACCESS_KEY_ID`
	- `R2_SECRET_ACCESS_KEY`
	- (optional) `R2_REGION` = `auto`
2. The frontend calls the built-in API route `/api/r2-sign`, which signs URLs on the server using those secrets.
3. For local development with `npm run dev`, you can either:
	- Run `vercel dev` in another terminal to serve API routes locally, or
	- Set `VITE_R2_SIGNER_URL` to a deployed signer (e.g., Cloudflare Worker) as a fallback.

### Common download issue

If you see an XML error like:

```
<Error>
	<Code>InvalidArgument</Code>
	<Message>Authorization</Message>
</Error>
```

It means you're using a raw R2 URL without a signature. Use the app's Download button, which fetches a presigned URL from the server.
