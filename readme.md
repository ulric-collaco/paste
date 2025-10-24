# 📝 Pastry

This project is **inspired by rentry**, a simple and elegant pastebin service. It provides a clean interface for creating and sharing text pastes anonymously, with support for both **permanent (passcode-protected)** and **shared guest pastes**. Built with React and Neon Database, it offers a modern, responsive experience for quick text sharing. 🚀

To run the project, first ensure you have **Node.js** installed. Then, navigate to the project directory, install dependencies with `npm install`, and start the development server with `npm run dev`. The app will be available at `http://localhost:3000`.

To use it, visit the homepage and choose between:
- **Admin mode**: Enter a passcode for permanent pastes 🔒
- **Guest mode**: Shared editable paste for all users 👥

Create or edit pastes in the editor, save them, and share the generated URLs. Guests can view and edit the same shared paste collaboratively. 📤

## Configuration

Create a `.env` file in the project root (same folder as `package.json`) and set the following variables:

```
# Neon Postgres (required)
VITE_NEON_DATABASE_URL=postgres://user:pass@host/db

# Cloudflare R2 (required for file uploads/downloads)
VITE_R2_ACCOUNT_ID=xxxxxxxxxxxxxxxxxxxxxx
VITE_R2_BUCKET_NAME=pastry

# URL of your deployed R2 signer Worker (required)
# Example: https://r2-signer.your-domain.workers.dev
VITE_R2_SIGNER_URL=https://<your-worker-subdomain>.workers.dev
```

Notes:
- Buckets are private by default on Cloudflare R2. Direct URLs like `https://<account>.r2.cloudflarestorage.com/<bucket>/<key>` will return XML errors (Authorization) unless they are presigned.
- This app never exposes R2 credentials. It requests short-lived presigned URLs from the Worker in `workers/r2-signer` for uploads (PUT), downloads (GET), and deletes (DELETE).

### Deploy the R2 signer Worker

1. Install the Cloudflare CLI if you haven't: `npm i -g wrangler`
2. From `workers/r2-signer`, set the required secrets:
	 - `wrangler secret put R2_ACCOUNT_ID`
	 - `wrangler secret put R2_BUCKET_NAME`
	 - `wrangler secret put R2_ACCESS_KEY_ID`
	 - `wrangler secret put R2_SECRET_ACCESS_KEY`
	 - Optionally: `wrangler secret put R2_REGION` with value `auto`
3. Deploy: `wrangler deploy`
4. Copy the Worker URL and set it as `VITE_R2_SIGNER_URL` in your `.env`.

### Common download issue

If you see an XML error like:

```
<Error>
	<Code>InvalidArgument</Code>
	<Message>Authorization</Message>
</Error>
```

It means you're using a raw R2 URL without a signature. Use the app's Download button, which fetches a presigned URL from the signer. Ensure `VITE_R2_SIGNER_URL` is configured and your Worker is deployed.
