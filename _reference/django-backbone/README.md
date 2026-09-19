# Delicate Courier Quote Generator

A web application for generating cold-chain logistics quotes. The app calculates delivery routes, distances, costs, and generates quotes for courier services.

---

## Project Structure

This project has two parts:

- **Backend**: Django REST API (Python)
- **Frontend**: Next.js (React) - fully migrated from Vite

---

## Frontend ↔ Backend: Connected (Next.js rewrite configured)

---

## Prerequisites

Before you start, make sure you have:

- **Python 3.8 or higher** - [Download](https://www.python.org/downloads/)
- **Node.js 18 or higher** - [Download](https://nodejs.org/)
- **npm** (comes with Node.js)

---

## Backend Setup (Django)

1. Open a terminal/command prompt in the project folder:
   ```bash
   cd Qoute-Generator-App/backend
   ```

2. Create and activate a virtual environment (optional but recommended):
   ```bash
   python -m venv venv
   venv\Scripts\activate  # Windows
   # OR
   source venv/bin/activate  # Mac/Linux
   ```

3. Install required Python packages:
   ```bash
   pip install django djangorestframework django-cors-headers
   ```

4. Run database migrations:
   ```bash
   python manage.py migrate
   ```

5. Start the backend server:
   ```bash
   python manage.py runserver
   ```
   The backend will run at `http://localhost:8000`

---

## Frontend Setup (Next.js)

1. Open a new terminal/command prompt in the project folder:
   ```bash
   cd Qoute-Generator-App/frontend
   ```

2. Install Node.js dependencies:
   ```bash
   npm install
   ```

3. Start the development server:
   ```bash
   npm run dev
   ```
   The frontend will run at `http://localhost:3000`

4. Open your browser and go to `http://localhost:3000`

---

## Frontend ↔ Backend Connection

The frontend communicates with the backend API at `http://localhost:8000/api/quotes/`. CORS is configured to allow requests from `localhost:3000`.

---

## How to Use the Application

1. **Enter addresses** in this order:
   - Depot (starting point)
   - Bakery (pickup location)
   - Customer addresses (one or more)

2. Click **CALCULATE ROUTE** to get distances between stops.

3. Review the calculated total distance, cost (COGS), and revenue.

4. Click **DOWNLOAD QUOTE** to save the quote as a text file.

---

## Technologies Used

**Backend:**
- Django 6.0
- Django REST Framework
- SQLite database

**Frontend:**
- React 19
- Next.js 16
- Leaflet (maps)
- React-Leaflet
- Tailwind CSS

---

## Troubleshooting

**Backend won't start:**
- Make sure Python is installed and accessible from command line
- Ensure you're in the `backend` folder when running commands
- Check that port 8000 is not blocked

**Frontend won't start:**
- Make sure Node.js and npm are installed
- Run `npm install` to install all dependencies
- Check that port 3000 is not blocked

**Map not showing:**
- The app uses OpenStreetMap tiles which require internet connection

---

## Notes

- The app uses the OSRM routing service to calculate road distances
- Database file (`db.sqlite3`) is included in the project root
- The backend API expects requests at `http://localhost:8000/api/quotes/`
