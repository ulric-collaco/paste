# Rentry Clone - Anonymous Pastebin

A modern, anonymous pastebin application built with React and Supabase. Features both permanent (passcode-protected) and temporary (guest) paste modes with file upload support.

## ✨ Features

### Core Functionality
- **Dual Mode System**: Passcode mode for permanent pastes, Guest mode for temporary (2-hour) pastes
- **Markdown Support**: Full markdown rendering with syntax highlighting
- **File Uploads**: Upload files up to 5MB with inline image previews
- **Clean URLs**: Beautiful `/slug` URLs for easy sharing
- **Dark Mode**: System-aware dark/light theme toggle

### Technical Features
- **React 18** with modern hooks and context
- **Supabase** for database and file storage
- **TailwindCSS** for responsive styling
- **React Router** for client-side routing
- **React Markdown** with syntax highlighting
- **Auto-expiration** for guest pastes

## 🚀 Quick Start

### Prerequisites
- Node.js 16+ and npm
- Supabase account and project

### 1. Clone and Install
```bash
cd "d:\Coding\Projects\React\paste"
npm install
```

### 2. Supabase Setup

#### Create Database Tables
Execute the SQL in `supabase-schema.md` in your Supabase SQL editor:

1. Create the `entries` table
2. Create the `files` table
3. Set up indexes and RLS policies
4. Create the cleanup function (optional)

#### Create Storage Bucket
1. Go to Storage in your Supabase dashboard
2. Create a new bucket named `uploads`
3. Make it public
4. Configure upload policies

### 3. Environment Configuration
```bash
cp .env.example .env
```

Update `.env` with your Supabase credentials:
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
```

### 4. Run Development Server
```bash
npm run dev
```

Visit `http://localhost:3000` to see your Rentry clone!

## 📁 Project Structure

```
src/
├── components/          # Reusable UI components
│   ├── Header.jsx      # Navigation header with theme toggle
│   └── ThemeToggle.jsx # Dark/light mode switcher
├── contexts/           # React context providers
│   ├── AppContext.jsx  # App state (mode, passcode)
│   └── ThemeContext.jsx # Theme state management
├── lib/
│   └── supabase.js     # Supabase client and database operations
├── pages/              # Main application pages
│   ├── Landing.jsx     # Home page with mode selection
│   ├── CreatePaste.jsx # Paste creation interface
│   └── ViewPaste.jsx   # Paste viewing with markdown rendering
├── App.jsx             # Main app component with routing
├── main.jsx           # React entry point
└── index.css          # Global styles and Tailwind imports
```

## 🔧 How It Works

### Landing Page Flow
1. User visits homepage
2. Choose between:
   - **Passcode Mode**: Enter a passcode for permanent pastes
   - **Guest Mode**: Create temporary pastes (auto-expire in 2 hours)

### Paste Creation
1. Write content in markdown editor
2. Upload files (optional, 5MB max each)
3. Submit to create unique `/slug` URL
4. Get shareable link with copy button

### Paste Viewing
- Clean URL: `yoursite.com/abc123`
- Renders markdown with syntax highlighting
- Shows file previews (images inline, others as download links)
- Copy link/content buttons
- Delete option (passcode mode only)

### Data Flow
```
Landing → Mode Selection → Create Editor → Save to Supabase → Redirect to Paste View
```

## 🗄️ Database Schema

### entries table
- `id`: UUID primary key
- `slug`: Unique 8-character identifier
- `content`: Markdown text content
- `is_guest`: Boolean flag for guest vs passcode mode
- `created_at`: Timestamp
- `expires_at`: Expiration time (guest mode only)

### files table
- `id`: UUID primary key
- `entry_id`: Foreign key to entries
- `file_url`: Supabase storage URL
- `file_name`: Original filename
- `uploaded_at`: Timestamp

## 🎨 Styling

- **TailwindCSS**: Utility-first CSS framework
- **Custom Dark Theme**: Extended color palette for dark mode
- **Responsive Design**: Mobile-first approach
- **Smooth Transitions**: Enhanced UX with CSS transitions

## 🔒 Security Considerations

- No user authentication required
- RLS policies allow public access (suitable for anonymous pastebin)
- File uploads restricted to 5MB
- Auto-expiration prevents database bloat
- No sensitive data storage

## 🚀 Deployment

### Vercel (Recommended)
```bash
npm run build
# Deploy the dist/ folder to Vercel
```

### Netlify
```bash
npm run build
# Deploy the dist/ folder to Netlify
```

### Environment Variables
Don't forget to set your environment variables in your deployment platform:
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

## 🔧 Customization

### Extending Expiration Times
Edit the expiration logic in `src/pages/CreatePaste.jsx`:
```javascript
const expiresAt = mode === 'guest' 
  ? new Date(now.getTime() + 24 * 60 * 60 * 1000) // Change to 24 hours
  : null
```

### File Size Limits
Modify the max file size in `src/pages/CreatePaste.jsx`:
```javascript
const maxSize = 10 * 1024 * 1024 // Change to 10MB
```

### Styling Themes
Customize colors in `tailwind.config.js`:
```javascript
theme: {
  extend: {
    colors: {
      dark: {
        // Your custom dark theme colors
      }
    }
  }
}
```

## 📝 Todo / Future Enhancements

- [ ] Password-protected pastes
- [ ] Paste editing (with passcode)
- [ ] View count tracking
- [ ] Paste categories/tags
- [ ] API endpoints
- [ ] Bulk file uploads
- [ ] Custom expiration times

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Submit a pull request

## 📄 License

MIT License - feel free to use this project for your own pastebin service!
