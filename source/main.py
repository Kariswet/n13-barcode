from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import uvicorn

app = FastAPI()

products = {
        "8410564006257": {
            "name": "Indomie Goreng",
            "price": 3500
        },
        "8992761132013": {
            "name": "Aqua 600ml",
            "price": 4000
        },
        "1234567890123": {
            "name": "Tisu Indomaret",
            "price": 17000
        },
        "1234567890128": {
            "name": "Google Image Testing",
            "price": 900000
        }
    }

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/product/{barcode}")
def get_product(barcode):
    product = products.get(barcode)
    if not product:
        return {"error": "product not found"}
    
    return product

if __name__ == "__main__":
    uvicorn.run(app=app, host="127.0.0.1", port=7300)
