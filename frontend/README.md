# React Barcode Scanner

This React app lives in `frontend/` and keeps your existing native JS scanner untouched.

## Local API

The frontend expects your FastAPI server at:

`http://127.0.0.1:7300`

It calls:

`GET /product/:barcode`

## Run

1. Start the backend:

   ```bash
   cd source
   python3 main.py
   ```

2. In another terminal, install frontend dependencies:

   ```bash
   cd frontend
   npm install
   ```

3. Start the React app:

   ```bash
   npm run dev
   ```

## Notes

- The scanner is restricted to EAN-13 barcodes.
- A manual barcode input is included so you can test the local GET endpoint without using the camera.
- Change the API base URL with `VITE_API_BASE_URL` if needed.
