# 📝 Pastry

This project is **inspired by rentry**, a simple and elegant pastebin service. It provides a clean interface for creating and sharing text pastes anonymously, with support for both **permanent (passcode-protected)** and **shared guest pastes**. Built with React and Cloudflare D1 Database, it offers a modern, responsive experience for quick text sharing. 🚀

To run the project, first ensure you have **Node.js** installed. Then, navigate to the project directory, install dependencies with `npm install`, and start the development server with `npm run dev`. The app will be available at `http://localhost:3000`.

To use it, visit the homepage and choose between:
- **Admin mode**: Enter a passcode for permanent pastes 🔒
- **Guest mode**: Shared editable paste for all users 👥
	- Guests can upload files too (stored separately from admin uploads), with a 1 GB total limit.

Create or edit pastes in the editor, save them, and share the generated URLs. Guests can view and edit the same shared paste collaboratively. 📤

## Tech Stack & Architecture

This project uses a modern, serverless architecture designed for security and performance.

### Core Technologies

-   **Frontend**: [React](https://react.dev/) (with Vite) for a fast, responsive UI.
-   **Styling**: [Tailwind CSS](https://tailwindcss.com/) for rapid, utility-first styling.
-   **Database**: [Cloudflare D1](https://developers.cloudflare.com/d1/) Serverless SQLite for data storage.
-   **API**: [Cloudflare Workers](https://workers.cloudflare.com/) for backend logic and database access.
-   **File Storage**: [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) for private, S3-compatible object storage.

### Architecture Diagram

The application is designed to keep secrets and sensitive operations on the server-side, ensuring the frontend never handles API keys directly.

```mermaid
graph TD
    subgraph "User's Browser"
        A[React SPA]
    end

    subgraph "Cloudflare Platform"
        B[Worker API /api]
        C[D1 Database]
        E[R2 Bucket]
    end

    A -- "Calls API endpoints" --> B
    B -- "Queries data" --> C
    B -- "Returns JSON" --> A
    A -- "Uploads/downloads files" --> E
```

### How It Works

1.  The **React SPA** is served to the user.
2.  Text content is fetched by calling the **Cloudflare Worker API**.
3.  The API interacts with the **D1 Database** to retrieve or store entries.
4.  For file uploads, the client interacts with the R2 storage (via presigned URLs or worker proxy depending on configuration).


