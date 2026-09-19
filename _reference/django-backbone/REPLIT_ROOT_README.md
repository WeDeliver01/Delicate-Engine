# Delicate Courier Quote Generator

A web application for generating cold-chain logistics quotes. The app calculates delivery routes, distances, costs, and generates quotes for courier services.

## Project Structure

- **Backend**: Django REST API (Python) - `backend/`
- **Frontend**: Next.js (React) - `frontend/`

## Frontend ↔ Backend: Connected (Next.js fully configured)

The frontend is fully migrated to Next.js with the following configuration:

- **Frontend dev server**: `http://localhost:3000`
- **Backend API**: `http://localhost:8000/api/quotes/`
- **CORS**: Configured in `backend/backend/settings.py` to allow `localhost:3000`

## Quick Start

### Backend
```bash
cd backend
python manage.py runserver
```

### Frontend
```bash
cd frontend
npm run dev
```

## Migration Notes

The frontend has been fully migrated from Vite to Next.js:
- No Vite configuration files present
- Uses Next.js 16 with React 19
- API proxy or direct calls to Django backend on port 8000
- CORS headers configured for cross-origin requests

See `backend/README.md` for detailed setup instructions.